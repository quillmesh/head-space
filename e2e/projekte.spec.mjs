// Projekte: Schritte mit Frist hinzufügen, eigene Reihenfolge per Griff ⋮⋮ (Finger, Pfeiltasten),
// Warndreieck bei Frist-Konflikt, alle Schritte in „Nächste Schritte“, Fristen-Liste ohne Projekte.
import { test, expect, HANDY, IPAD } from './fixtures.mjs';
import { gehe, karte, iso, fingerZiehen, mitte, wischen, keinQuerScrollen } from './hilfen.mjs';

/** Datumsauswahl abfangen: das Feld merken statt den System-Kalender zu öffnen */
const kalenderAbfangen = (page) => page.addInitScript(() => { HTMLInputElement.prototype.showPicker = function () { window.__picker = this; }; });
const reihenfolge = async (page) => (await page.locator('[data-sortable] .row-title').allInnerTexts()).map((t) => t.split(' ')[0]);
const oeffneVelo = async (page) => { await gehe(page, 'test/#projects'); await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap(); await page.locator('#step-input').waitFor(); };

/** Schritt „Licht montieren“ mit Frist morgen hinzufügen (über die Fahne neben dem Eingabefeld) */
async function lichtMitFrist(page) {
  await page.fill('#step-input', 'Licht montieren');
  await page.locator('[data-action=step-due-pick]').tap();
  await page.evaluate((v) => { const el = window.__picker; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(1));
  await expect(page.locator('.step-due-text'), 'gewählte Frist neben der Fahne').toContainText('.');
  await page.locator('form[data-form=project-step] button[type=submit]').tap();
  await expect(karte(page, 'Licht montieren')).toHaveCount(1);
}

test.describe('Projekt auf dem iPad', () => {
  test.use(IPAD);
  test.beforeEach(({ page }) => kalenderAbfangen(page));

  test('neuer Schritt mit Frist (Fahne), nach Frist eingeordnet', async ({ page }) => {
    await oeffneVelo(page);
    await lichtMitFrist(page);
    await expect(karte(page, 'Licht montieren').locator('.slot-due .due')).toContainText('.');
    await expect(page.locator('.step-due-text'), 'Frist-Feld nach dem Hinzufügen leer').toHaveText('');
    expect(await reihenfolge(page)).toEqual(['Licht', 'Velomechaniker', 'Kette']);
    await expect(page.locator('.conflict-btn'), 'nach Frist sortiert: keine Warnung').toHaveCount(0);
  });

  test('Ziehen mit dem Finger: eigene Reihenfolge hat Vorrang, Warndreieck mit Erklärung', async ({ page }) => {
    await oeffneVelo(page);
    await lichtMitFrist(page);
    // Velomechaniker (später fällig) über Licht (früher fällig) ziehen
    const [x, y, griff] = await mitte(karte(page, 'Velomechaniker').locator('.drag-handle'));
    const oben = await karte(page, 'Licht montieren').boundingBox();
    await fingerZiehen(page, x, y, 0, oben.y - griff.y - 10);
    await expect.poll(() => reihenfolge(page)).toEqual(['Velomechaniker', 'Licht', 'Kette']);
    await expect(karte(page, 'Licht montieren').locator('.conflict-btn'), 'Warndreieck beim früher fälligen Schritt').toHaveCount(1);
    await expect(karte(page, 'Velomechaniker').locator('.conflict-btn')).toHaveCount(0);
    await expect(karte(page, 'Licht montieren').locator('.conflict-btn'), 'orange').toHaveCSS('color', 'rgb(166, 86, 0)');

    await page.reload(); await page.locator('[data-sortable]').waitFor();
    expect(await reihenfolge(page), 'bleibt nach Neuladen').toEqual(['Velomechaniker', 'Licht', 'Kette']);

    await karte(page, 'Licht montieren').locator('.conflict-btn').tap();
    await expect(page.locator('#modal .conflict-list')).toBeVisible();
    await expect(page.locator('#modal'), 'Erklärung nennt beide Schritte').toContainText('Licht montieren');
    await expect(page.locator('#modal')).toContainText('Velomechaniker');
    await page.locator('#modal [data-action=close].btn').tap();
    await expect(page.locator('#modal')).toBeHidden();
    expect((await reihenfolge(page))[0], 'eigene Reihenfolge bleibt').toBe('Velomechaniker');

    await karte(page, 'Velomechaniker').locator('.drag-handle').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => reihenfolge(page), 'Pfeiltaste verschiebt').toEqual(['Licht', 'Velomechaniker', 'Kette']);
  });

  test('Wischen auf der Karte öffnet „Löschen“, der Griff verschiebt nur', async ({ page }) => {
    await page.clock.install();
    await oeffneVelo(page);
    const [kx, ky] = await mitte(karte(page, 'Kette ölen').locator('.row-title'));
    await fingerZiehen(page, kx, ky, -150, 0);
    await expect(karte(page, 'Kette ölen')).toHaveClass(/swipe-open/);
    await page.waitForTimeout(350); // menschliche Pause, siehe loeschen-papierkorb.spec.mjs
    await page.locator('#main li.row.swipe-open .swipe-del').tap();
    await expect(karte(page, 'Kette ölen')).toHaveCount(0);
    await expect(page.locator('#undo')).toHaveClass(/show/);
    await page.locator('[data-action=undo]').tap();
    await expect(karte(page, 'Kette ölen'), 'Rückgängig holt den Schritt zurück').toHaveCount(1);

    const vorher = await reihenfolge(page);
    const [x, y, griff] = await mitte(karte(page, vorher[1]).locator('.drag-handle'));
    const oben = await karte(page, vorher[0]).boundingBox();
    await fingerZiehen(page, x, y, 0, oben.y - griff.y - 10);
    await expect.poll(async () => (await reihenfolge(page))[0], 'Griff verschiebt').toBe(vorher[1]);
    await expect(page.locator('#main li.row.swipe-open'), 'Ziehen am Griff öffnet kein „Löschen“').toHaveCount(0);
  });

  test('seit 0.10: keine Wahl „Alle / Nur die nächste“, alle Schritte in Nächste Schritte', async ({ page }) => {
    await oeffneVelo(page);
    await expect(page.locator('[data-action=project-seq], .up-next')).toHaveCount(0);
    await gehe(page, 'test/#next');
    for (const t of ['Velomechaniker', 'Kette ölen']) await expect(karte(page, t)).toHaveCount(1);
  });

  test('Fristen-Liste: nur Aufgaben, keine Projekte', async ({ page }) => {
    await gehe(page, 'test/#due');
    await expect(page.locator('#main .row-title', { hasText: 'Velo winterfit' })).toHaveCount(0);
    await expect(page.locator('#main .row-icon')).toHaveCount(0);
  });
});

test.describe('Projekt auf dem Handy', () => {
  test.use(HANDY);
  test.beforeEach(({ page }) => kalenderAbfangen(page));

  test('Schritte mit Frist zuerst; neu gewähltes Datum sortiert neu', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Wohnzimmer' }).tap(); await page.locator('#step-input').waitFor();
    const titel = await page.locator('#main .row .row-title').allInnerTexts();
    expect(titel[0]).toContain('Abdeckband');
    expect(titel[1]).toContain('Farbmuster');
    await karte(page, 'Farbmuster').locator('[data-action=due-pick]').tap();
    await page.evaluate((v) => { const el = window.__picker; el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, iso(1));
    await expect(page.locator('#main .row .row-title').first(), 'frühere Frist nach oben').toContainText('Farbmuster');
  });

  test('kein Querscrollen, Datum neben dem Griff nicht abgeschnitten', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap(); await page.locator('#step-input').waitFor();
    expect(await keinQuerScrollen(page)).toBe(true);
    const datum = karte(page, 'Velomechaniker').locator('.slot-due .due span');
    expect(await datum.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('Wischen auf einem Projekt in der Liste bewirkt nichts', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await wischen(page.locator('#main li.row').first());
    await expect(page.locator('#main li.row.swipe-open')).toHaveCount(0);
  });
});

// ---------- 0.12: Projektfarbe zeigen und wählen ----------
const farbe = (loc) => loc.evaluate((el) => getComputedStyle(el).color);

test.describe('Projektfarbe auf dem Handy (0.12)', () => {
  test.use(HANDY);

  test('Name in der Liste und Titel der Ansicht farbig; Farbe wählen, Ring zeigt benutzte, mehrfach erlaubt', async ({ page }) => {
    await gehe(page, 'test/#projects');
    const velo = page.locator('#main .row-title', { hasText: 'Velo winterfit' });
    const tinte = await farbe(page.locator('#main h1'));
    const inListe = await farbe(velo);
    expect(inListe, 'Projektname nicht in Textfarbe').not.toBe(tinte);
    expect(await farbe(page.locator('#main .row-title', { hasText: 'Ferien' })), 'Projekte verschieden gefärbt').not.toBe(inListe);
    await velo.tap();
    await expect(page.locator('#main h1.proj-title')).toHaveText('Velo winterfit machen');
    expect(await farbe(page.locator('#main h1')), 'Titel in derselben Farbe wie in der Liste').toBe(inListe);

    await page.locator('[data-action=pick-color]').tap();
    await expect(page.locator('#modal .swatch')).toHaveCount(20);
    await expect(page.locator('#modal .swatch.is-current'), 'heutige (automatische) Farbe mit Haken').toHaveAttribute('data-key', 'blau');
    await expect(page.locator('#modal .swatch.is-used'), 'Ring bei den Farben der 4 anderen Projekte').toHaveCount(4);
    await expect(page.locator('#modal .swatch[data-key=magenta]')).toHaveClass(/is-used/);
    await page.locator('#modal .swatch[data-key=wein]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await expect(page.locator('#main .view-head')).toHaveClass(/pc-wein/);
    await expect(page.locator('#main .swatch-dot')).toHaveCSS('background-color', 'rgb(156, 47, 91)');
    const neu = await farbe(page.locator('#main h1'));
    expect(neu).not.toBe(inListe);

    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(page.locator('#main .view-head'), 'bleibt nach Neuladen').toHaveClass(/pc-wein/);
    await gehe(page, 'test/#projects');
    expect(await farbe(velo), 'Liste zeigt die gewählte Farbe').toBe(neu);

    // dieselbe Farbe für ein zweites Projekt: erlaubt, mit Ring markiert
    await page.locator('#main .row-title', { hasText: 'Ferien' }).tap();
    await page.locator('[data-action=pick-color]').tap();
    await expect(page.locator('#modal .swatch[data-key=wein]')).toHaveClass(/is-used/);
    await page.locator('#modal .swatch[data-key=wein]').tap();
    await expect(page.locator('#main .view-head')).toHaveClass(/pc-wein/);
  });
});

// ---------- 0.12: Abschliessen, „Erledigt“ und Zurückholen ----------
test.describe('Abgeschlossene Projekte auf dem Handy (0.12)', () => {
  test.use(HANDY);

  test('Abschliessen fragt nach offenen Aufgaben; „Erledigt“ zeigt nur das Projekt; Zurückholen fragt', async ({ page }) => {
    await oeffneVelo(page);
    await page.locator('[data-action=close-project]').tap();
    await expect(page.locator('#modal')).toContainText('3 offene Aufgaben');
    await page.locator('#modal [data-action=close-project-go][data-with="1"]').tap();
    await expect(page.locator('#undo')).toContainText('3 Aufgaben erledigt');

    await gehe(page, 'test/#done');
    await expect(page.locator('#main h2.section', { hasText: 'Abgeschlossene Projekte' })).toHaveCount(1);
    await expect(page.locator('#main .row-title.proj-title', { hasText: 'Velo winterfit' })).toHaveCount(1);
    await expect(karte(page, 'Velomechaniker'), 'Aufgaben nicht einzeln').toHaveCount(0);

    await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap();
    await expect(page.locator('#main .back')).toContainText('Erledigt');
    await expect(karte(page, 'Velomechaniker')).toHaveCount(1);

    // nur diese Aufgabe: vom Projekt gelöst, Projekt bleibt abgeschlossen
    await karte(page, 'Velomechaniker').locator('[data-action=restore]').tap();
    await expect(page.locator('#modal')).toContainText('Was soll wieder aktiv werden?');
    await page.locator('#modal [data-mode=item]').tap();
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Velomechaniker')).toHaveCount(1);
    await expect(karte(page, 'Velomechaniker').locator('.row-eyebrow'), 'ohne Projekt').toHaveCount(0);
    await gehe(page, 'test/#done');
    await expect(page.locator('#main .row-title', { hasText: 'Velo winterfit' }), 'Projekt bleibt abgeschlossen').toHaveCount(1);

    // ganzes Projekt wieder aktivieren
    await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap();
    await karte(page, 'Kette ölen').locator('[data-action=restore]').tap();
    await page.locator('#modal [data-mode=project]').tap();
    await expect(page.locator('#main .pill.status-active')).toHaveCount(1);
    await gehe(page, 'test/#projects');
    await expect(page.locator('#main .row-title', { hasText: 'Velo winterfit' })).toHaveCount(1);
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Kette ölen')).toHaveCount(1);
  });

  test('Abschliessen „offen lassen“: offene Aufgaben bleiben offen, verschwinden aber aus den Listen', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Wohnzimmer' }).tap();
    await page.locator('[data-action=close-project]').tap();
    await page.locator('#modal [data-action=close-project-go][data-with="0"]').tap();
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Farbmuster')).toHaveCount(0);
    await gehe(page, 'test/#done');
    await page.locator('#main .row-title', { hasText: 'Wohnzimmer' }).tap();
    await expect(karte(page, 'Farbmuster').locator('.check:not(.is-done)'), 'noch offen').toHaveCount(1);
  });
});
