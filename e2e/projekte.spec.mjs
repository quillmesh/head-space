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
