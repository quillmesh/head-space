// Darstellung, die echtes CSS braucht: Farben, Grössen, Ausrichtung „auf einer Linie“, kompakte Handy-Karten,
// gleich hohe Felder im Dialog, Hell/Dunkel. (Welche Symbole erscheinen, prüft tests/unit/karten.test.ts.)
import { test, expect, COMPUTER, HANDY, IPAD } from './fixtures.mjs';
import { gehe, karte, iso, mitten, keinQuerScrollen } from './hilfen.mjs';

const ROT = 'rgb(220, 50, 47)';
const ORANGE = 'rgb(166, 86, 0)';
const naheBeieinander = (werte, toleranz = 1.5) => Math.max(...werte) - Math.min(...werte) <= toleranz;

test.describe('Handy', () => {
  test.use(HANDY);

  test('Nächste Schritte: Symbole statt „@“, Grösse 22 px, Abschnittstitel auf einer Linie', async ({ page }) => {
    await gehe(page, 'test/#next');
    await expect(page.locator('#main')).not.toContainText('@');
    const zahn = karte(page, 'Zahnarzt');
    await expect(zahn.locator('.ctx-badge svg.ico-telefon')).toHaveCount(1);
    await expect(zahn.locator('.ctx-badge')).toHaveAttribute('title', 'Telefon');
    await expect(karte(page, 'Altglas').locator('svg.ico-unterwegs')).toHaveCount(1);
    // 0.12: Zug hat das Zugsymbol, Unterwegs das Männchen, Einkaufen den Einkaufswagen
    await expect(karte(page, 'Reiseführer').locator('svg.ico-zug')).toHaveCount(1);
    await expect(karte(page, 'Abdeckband').locator('svg.ico-einkaufen')).toHaveCount(1);
    expect(await karte(page, 'Altglas').locator('svg.ico-unterwegs').innerHTML(), 'Unterwegs nicht mehr der Zug')
      .not.toBe(await karte(page, 'Reiseführer').locator('svg.ico-zug').innerHTML());
    const b = await zahn.locator('.ctx-badge svg').boundingBox();
    expect(b.width).toBeGreaterThanOrEqual(21); expect(b.width).toBeLessThanOrEqual(24);
    await expect(page.locator('.filter[data-ctx="@Computer"] svg.ico-computer')).toHaveCount(1);
    // 0.12: viele Kontext-Filter scrollen in ihrer Leiste; die Seite selbst wird nicht breiter (Screenreader-Namen blieben früher draussen)
    expect(await page.evaluate(() => document.querySelector('.filters').scrollWidth > document.querySelector('.filters').clientWidth), 'Leiste läuft über').toBe(true);
    expect(await keinQuerScrollen(page), 'kein Querscrollen der Seite').toBe(true);

    const h = page.locator('h2.section', { has: page.locator('.ico-computer') });
    await expect(h).toHaveText(/^\s*computer\s*$/i);
    const [ib, tb] = await Promise.all([h.locator('svg').boundingBox(), h.locator('.ctx-name').boundingBox()]);
    expect(Math.abs((ib.y + ib.height / 2) - (tb.y + tb.height / 2)), 'Symbol und Name auf einer Linie').toBeLessThanOrEqual(1.5);
    expect(Math.abs(ib.x + ib.width - tb.x), 'Name direkt neben dem Symbol').toBeLessThan(14);

    await page.locator('.filter[data-ctx="@Telefon"]').tap();
    await expect(page.locator('#main .row'), 'Filter per Tippen').toHaveCount(3);
  });

  test('Farben: heute rot, bald orange', async ({ page }) => {
    await gehe(page, 'test/#due');
    await expect(karte(page, 'Velomechaniker').locator('.due')).toHaveCSS('color', ORANGE);
    await expect(karte(page, 'Zahnarzt').locator('.due')).toHaveCSS('color', ROT);
  });

  test('kompakte Karten (Variante A): eine Zeile unter dem Titel, alles auf einer Linie', async ({ page }) => {
    await gehe(page, 'test/#next');
    const zahn = karte(page, 'Zahnarzt');
    const c1 = await mitten(zahn.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due'));
    expect(c1).toHaveLength(2);
    expect(naheBeieinander(c1), `Kontext und Frist auf einer Linie (${c1})`).toBe(true);
    expect((await zahn.boundingBox()).height, 'kompakte Karte').toBeLessThanOrEqual(80);
    await expect(karte(page, 'Altglas').locator('.due-none'), 'blasse Fahne bleibt').toBeVisible();
    await expect(page.locator('#main .cap'), 'keine Titel über den Daten').toHaveCount(0);
    await expect(karte(page, 'Kette ölen').locator('.note-ico'), 'Notiz als Symbol').toBeVisible();
    await expect(karte(page, 'Kette ölen').locator('.note-chip')).toBeHidden();

    await gehe(page, 'test/#waiting');
    const lisa = karte(page, 'Antwort von Lisa');
    await expect(lisa.locator('.ctx-wait .wait-who')).toHaveText('Lisa');
    await expect(lisa.locator('.wait-chip'), 'kein zusätzliches „wartet auf Lisa“').toBeHidden();
    const c2 = await mitten(lisa.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due, .row-meta .slot-rem .due'));
    expect(naheBeieinander(c2), 'Sanduhr, Fahne und Glocke auf einer Linie').toBe(true);

    await gehe(page, 'test/#tickler');
    await expect(page.locator('#main .due.rem.rem-defer').first(), '„Erst ab“ (Mond) in gleicher Box').toBeVisible();
    expect(await keinQuerScrollen(page)).toBe(true);
  });
});

test.describe('iPad', () => {
  test.use(IPAD);

  test('Daten-Boxen: Nachfassen gleich wie Frist, 6 px gerundet, mit Symbol auf einer Linie', async ({ page }) => {
    await gehe(page, 'test/#waiting');
    const lisa = karte(page, 'Antwort von Lisa');
    await expect(lisa.locator('.cap')).toHaveCount(0);
    await expect(lisa.locator('.slot-ctx .ctx-wait'), 'Sanduhr auch mit Kontext-Platz').toHaveCount(1);
    await lisa.locator('[data-action=due-pick]').tap();
    await page.evaluate((v) => { const el = document.querySelector('.due-input'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(3));
    await expect(page.locator('#main .slot-due .due-soon')).toHaveCount(1);
    const stil = (loc) => loc.evaluate((el) => { const c = getComputedStyle(el); return { rahmen: c.borderTopStyle, radius: c.borderTopLeftRadius, hoehe: c.height, gefuellt: c.backgroundColor !== 'rgba(0, 0, 0, 0)' }; });
    const frist = await stil(lisa.locator('.slot-due .due'));
    const nach = await stil(lisa.locator('.slot-rem .due.rem'));
    expect({ ...nach, gefuellt: undefined }).toEqual({ ...frist, gefuellt: undefined });
    expect(nach.gefuellt).toBe(true);
    expect(frist.radius).toBe('6px');
    const c = await mitten(lisa.locator('.row-meta .slot-ctx .ico, .row-meta .slot-due .due, .row-meta .slot-rem .due'));
    expect(c).toHaveLength(3);
    expect(naheBeieinander(c)).toBe(true);
  });

  test('Bearbeiten-Dialog: Felder gleich hoch, zwei gleich breite Spalten, Datumsfelder bleiben in der Spalte', async ({ page }) => {
    await gehe(page, 'test/#waiting');
    await karte(page, 'Antwort von Lisa').locator('.row-title').tap(); await page.locator('#e-due').waitFor();
    const felder = await page.locator('#modal .grid2 input, #modal .grid2 select').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    expect(felder).toHaveLength(6);
    expect(new Set(felder.map((f) => f[1])).size, `gleich hoch (${felder})`).toBe(1);
    expect(new Set(felder.map((f) => f[0])).size, `gleich breit (${felder})`).toBe(1);
    for (const id of ['#e-due', '#e-tickler']) {
      const [f, spalte] = await Promise.all([page.locator(id).boundingBox(), page.locator(id).locator('xpath=..').boundingBox()]);
      expect(f.x).toBeGreaterThanOrEqual(spalte.x - 0.5);
      expect(f.x + f.width).toBeLessThanOrEqual(spalte.x + spalte.width + 0.5);
    }
    expect(await page.locator('#e-due').evaluate((el) => getComputedStyle(el).webkitAppearance === 'none' || getComputedStyle(el).appearance === 'none'), 'ohne Safari-Eigenbreite').toBe(true);
    const hinweis = await page.locator('#modal .hint').first().innerText();
    expect(hinweis).toContain('Nachfassen am');
    expect(hinweis).not.toContain('Erst ab');
  });
});

test.describe('Computer', () => {
  test.use(COMPUTER);

  test('Plätze in allen Karten gleich ausgerichtet; Erinnerung im eigenen Platz', async ({ page }) => {
    await gehe(page, 'test/#next');
    await karte(page, 'Altglas').locator('.row-title').click();
    await page.fill('#e-tickler', iso(0)); await page.click('form[data-form=edit] button[type=submit]');
    await page.click('.filter[data-ctx="all"]');
    const x = async (t, sel) => (await karte(page, t).locator(sel).boundingBox()).x;
    for (const sel of ['.slot-ctx', '.slot-due', '.slot-rest']) expect(await x('Altglas', sel), sel).toBe(await x('Kette ölen', sel));
    await expect(karte(page, 'Altglas').locator('.slot-rem .due.rem')).toHaveCount(1);
  });

  test('Einstellungen: Kontexte ohne „@“, eigener Kontext mit Etikett', async ({ page }) => {
    await gehe(page, 'test/#settings');
    await expect(page.locator('.ctx-list')).not.toContainText('@');
    await expect(page.locator('.ctx-list svg.ico-besprechung')).toHaveCount(1);
    await expect(page.locator('.ctx-list svg.ico-zug'), 'neuer Standard-Kontext Zug').toHaveCount(1);
    await expect(page.locator('.ctx-list svg.ico-einkaufen'), 'neuer Standard-Kontext Einkaufen').toHaveCount(1);
    await page.fill('#ctx-input', 'Garten'); await page.keyboard.press('Enter');
    await expect(page.locator('.ctx-list svg.ico-tag')).toHaveCount(1);
    await expect(page.locator('.ctx-list')).toContainText('Garten');
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).click(); await page.locator('#step-input').waitFor();
    const optionen = await page.locator('#step-ctx option').allInnerTexts();
    expect(optionen, 'Auswahlfeld Kontext').toContain('Telefon');
    expect(optionen.join(' ')).not.toContain('@');
  });

  test('Hell, Dunkel (Solarized) und „Wie System“, bleibt nach Neuladen', async ({ page }) => {
    await gehe(page, '#settings');
    await page.click('[data-action=theme][data-value=dark]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 43, 54)');
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.click('[data-action=theme][data-value=light]');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(253, 246, 227)');
    await page.click('[data-action=theme][data-value=system]');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('Projektliste (0.13)', () => {
  test.use(HANDY);
  test('Ergebnis vollständig lesbar, ohne Box', async ({ page }) => {
    await gehe(page, 'test/#projects');
    const e = page.locator('#main .row', { hasText: 'Velo winterfit' }).locator('.proj-outcome');
    await expect(e).toHaveText('Service gemacht, Licht und Winterreifen montiert');
    expect(await e.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).whiteSpace !== 'nowrap'), 'nicht abgeschnitten').toBe(true);
    await expect(e).toHaveCSS('border-top-width', '0px');
    await expect(e).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });
});

test.describe('Inbox rot ab dem 8. Tag (0.14)', () => {
  test.use(HANDY);
  test('Variante C: ganze Karte rot hinterlegt, ohne weitere Angaben; jüngere normal', async ({ page }) => {
    await gehe(page, 'test/#inbox');
    const alt = karte(page, 'Geschenk für Mama');
    await expect(alt).toHaveClass(/is-stale/);
    await expect(alt.locator('.row-inner')).toHaveCSS('background-color', 'rgb(249, 223, 214)');
    await expect(alt, 'keine Zahl, kein „seit x Tagen“').not.toContainText(/Tag/);
    await expect(page.locator('.callout'), 'oben keine Angabe').not.toContainText(/7 Tag/);
    await expect(karte(page, 'Zeitschrift')).not.toHaveClass(/is-stale/);
  });
});
