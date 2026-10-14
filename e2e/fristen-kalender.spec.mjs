// Frist direkt in der Karte setzen (Fahne): System-Kalender, Ersatzdialog, Rückgängig,
// Geräte, die nur „input“ melden (iPad/Safari), und Rad-Auswahl mit Fokus.
import { test, expect, COMPUTER, HANDY, IPAD } from './fixtures.mjs';
import { gehe, karte, iso } from './hilfen.mjs';

test.describe('Am Computer', () => {
  test.use(COMPUTER);

  test('Fahne setzt die Frist sofort, mit Rückgängig, auch nach Neuladen', async ({ page }) => {
    await gehe(page, 'test/#next');
    const z = karte(page, 'Altglas');
    await z.locator('button.due').click();
    await expect(page.locator('#modal'), 'Auswahl, nicht der Bearbeiten-Dialog').toBeHidden();
    await z.locator('.due-input').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(1));
    await expect(z.locator('button.due')).not.toHaveText(/^\s*$/);
    await expect(page.locator('#undo')).toContainText('Fällig am');
    await page.click('[data-action=undo]');
    await expect(z.locator('button.due')).toHaveText(/^\s*$/);
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(z.locator('button.due-none'), 'Rückgängig auch nach Neuladen').toHaveCount(1);
  });

  test('Ersatzdialog, wenn der Browser keinen Kalender öffnen kann; auch für Projekte', async ({ page }) => {
    await page.addInitScript(() => { HTMLInputElement.prototype.showPicker = () => { throw new Error('blockiert'); }; });
    await gehe(page, 'test/#next');
    const z = karte(page, 'Altglas');
    await z.locator('button.due').click();
    await page.click(`[data-action=due-quick][data-date="${iso(1)}"]`);
    await expect(z.locator('button.due'), 'Morgen gesetzt').not.toHaveText(/^\s*$/);
    await z.locator('button.due').click();
    await page.click('[data-action=due-clear]');
    await expect(z.locator('button.due-none'), 'Frist entfernt').toHaveCount(1);

    await gehe(page, 'test/#projects');
    const p = page.locator('#main .row').filter({ hasText: 'Ferien Tessin' });
    await p.locator('button.due').click();
    await page.click(`[data-action=due-quick][data-date="${iso(7)}"]`);
    await expect(p.locator('button.due'), 'Projekt-Frist direkt gesetzt').not.toHaveText(/^\s*$/);
  });
});

test.describe('Auf dem Handy', () => {
  test.use(HANDY);
  test.beforeEach(({ page }) => page.addInitScript(() => { HTMLInputElement.prototype.showPicker = function () { window.__picker = this; }; }));
  const waehle = async (page, titel, wert, ereignisse) => {
    await karte(page, titel).locator('[data-action=due-pick]').tap();
    await page.evaluate(([v, evs]) => { const el = window.__picker; el.value = v; for (const e of evs) el.dispatchEvent(new Event(e, { bubbles: true })); }, [wert, ereignisse]);
  };

  test('Datum beim ersten Mal übernommen, auch wenn das Gerät nur „input“ meldet', async ({ page }) => {
    await gehe(page, 'test/#next');
    await waehle(page, 'Altglas', iso(1), ['input']);
    await expect(karte(page, 'Altglas').locator('.due')).toContainText('.');
    await expect(page.locator('#undo')).toHaveClass(/show/);
  });

  test('„input“ und „change“ hintereinander speichern nur einmal', async ({ page }) => {
    await gehe(page, 'test/#next');
    const vorher = await page.evaluate(() => window.kopfFrei.eventCount());
    await waehle(page, 'Altglas', iso(4), ['input', 'change']);
    await expect(karte(page, 'Altglas').locator('.due')).toContainText('.');
    expect(await page.evaluate(() => window.kopfFrei.eventCount()) - vorher).toBe(1);
  });

  test('Rad-Auswahl (Feld hat Fokus): erst beim Verlassen übernehmen, nicht dazwischen neu zeichnen', async ({ page }) => {
    await gehe(page, 'test/#next');
    await karte(page, 'Altglas').locator('[data-action=due-pick]').tap();
    await page.evaluate((v) => { const el = window.__picker; el.style.pointerEvents = 'auto'; el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, iso(6));
    expect(await page.evaluate(() => document.activeElement === window.__picker && document.contains(window.__picker))).toBe(true);
    await page.evaluate(() => window.__picker.blur());
    await expect(karte(page, 'Altglas').locator('.due')).toHaveAttribute('aria-label', new RegExp(`${new Date(iso(6)).getDate()}\\.`));
  });
});

// iPad und iPhone (Safari/WebKit auf iOS): showPicker() gibt es, es tut aber nichts und meldet keinen Fehler
// (WebKit-Fehler 268114, 261703). Darum muss der Finger dort direkt das (durchsichtige) Datumsfeld treffen;
// iPadOS öffnet seine Datumsauswahl dann selbst. Nachgebildet: iPad-Kennung wie Safari auf dem iPad
// (meldet sich als Mac mit Touch) und showPicker() ohne Wirkung.
const WIE_IOS = (platform) => {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform });
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });
  window.__showPicker = 0;
  HTMLInputElement.prototype.showPicker = function () { window.__showPicker++; }; // wie iOS: kein Kalender, kein Fehler
  // Wo landet der Finger? (iPadOS öffnet seine Auswahl, wenn das Datumsfeld selbst angetippt wird)
  addEventListener('click', (e) => { window.__angetippt = e.target.classList?.contains('due-input') ? 'Datumsfeld' : e.target.closest?.('button') ? 'Knopf' : e.target.tagName; }, true);
};
/** Was der Finger in der Mitte des Elements trifft */
const getroffen = (loc) => loc.evaluate((el) => {
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit?.tagName === 'INPUT' ? `input[type=${hit.type}]` : hit?.closest('button') ? 'button' : hit?.tagName ?? 'nichts';
});

for (const [name, geraet, platform] of [['iPad', IPAD, 'MacIntel'], ['iPhone', HANDY, 'iPhone']]) {
  test.describe(`Fahne auf dem ${name} (showPicker ohne Wirkung)`, () => {
    test.use(geraet);
    test.beforeEach(({ page }) => page.addInitScript(WIE_IOS, platform));

    test('der Finger trifft das Datumsfeld selbst (Karte und neuer Projektschritt); gewähltes Datum wird gespeichert', async ({ page }) => {
      await gehe(page, 'test/#next');
      const z = karte(page, 'Altglas');
      const fahne = z.locator('button.due');
      expect(await getroffen(fahne), 'Tippen auf die Fahne landet im Datumsfeld').toBe('input[type=date]');
      const feld = z.locator('.due-input');
      expect(await feld.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 'mindestens 16 px, sonst zoomt iOS beim Antippen').toBeGreaterThanOrEqual(16);
      // nur die Fahne selbst reagiert, nicht der Platz daneben
      const daneben = await fahne.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.right + 3, r.top + r.height / 2)?.classList.contains('due-input'); });
      expect(daneben, 'neben der Fahne kein Datumsfeld').toBe(false);
      // Finger an der Stelle der Fahne (dort liegt das Datumsfeld)
      const b = await fahne.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await expect.poll(() => page.evaluate(() => window.__angetippt), 'der Fingertipp erreicht das Datumsfeld').toBe('Datumsfeld');
      expect(await page.evaluate(() => window.__showPicker), 'kein Verlass auf showPicker').toBe(0);
      await expect(page.locator('#modal'), 'öffnet nicht zusätzlich den Bearbeiten-Dialog').toBeHidden();
      await feld.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(2));
      await expect(z.locator('button.due')).toContainText('.');
      await expect(page.locator('#undo')).toContainText('Fällig am');

      await gehe(page, 'test/#projects');
      await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap();
      await page.locator('#step-input').waitFor();
      const sf = page.locator('[data-action=step-due-pick]');
      expect(await getroffen(sf), 'Fahne beim neuen Schritt ebenso').toBe('input[type=date]');
      const sb = await sf.boundingBox();
      await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.locator('.step-due-input').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(3));
      await expect(page.locator('.step-due-text'), 'gewählte Frist neben der Fahne').toContainText('.');
      await expect(page.locator('#modal')).toBeHidden();
    });
  });
}

test.describe('Fahne am Computer bleibt wie bisher', () => {
  test.use(COMPUTER);
  test('Kalender über showPicker, das Feld liegt nicht über der Fahne', async ({ page }) => {
    await page.addInitScript(() => { window.__showPicker = 0; HTMLInputElement.prototype.showPicker = function () { window.__showPicker++; }; });
    await gehe(page, 'test/#next');
    const fahne = karte(page, 'Altglas').locator('button.due');
    expect(await getroffen(fahne)).toBe('button');
    await fahne.click();
    expect(await page.evaluate(() => window.__showPicker)).toBe(1);
  });
});
