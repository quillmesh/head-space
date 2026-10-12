// Unteraufgaben (0.12): nur im Dialog der Aufgabe; Knopf schaltet sie ein, „+“ fügt hinzu,
// Abhaken wird sofort gespeichert und bleibt sichtbar; Text, neue und entfernte mit „Speichern“.
import { test, expect, HANDY } from './fixtures.mjs';
import { gehe, karte } from './hilfen.mjs';

const oeffne = async (page, titel) => { await karte(page, titel).locator('.row-title').tap(); await page.locator('#modal form[data-form=edit]').waitFor(); };
const zeilen = (page) => page.locator('#modal .sub-row');

test.describe('Unteraufgaben auf dem Handy', () => {
  test.use(HANDY);

  test('einschalten, mit + ergänzen, speichern; nur im Dialog sichtbar', async ({ page }) => {
    await gehe(page, 'test/#next');
    await oeffne(page, 'Altglas');
    await expect(zeilen(page), 'zuerst nur der Knopf').toHaveCount(0);
    await page.locator('#modal [data-action=sub-start]').tap();
    await expect(zeilen(page), 'eine leere Zeile').toHaveCount(1);
    await expect(page.locator('#modal .sub-input')).toBeFocused();
    await page.keyboard.type('Flaschen sammeln');
    await page.locator('#modal [data-action=sub-add]').tap();
    await expect(zeilen(page)).toHaveCount(2);
    await page.keyboard.type('Container suchen');
    await page.locator('#modal button[type=submit]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await expect(page.locator('#main'), 'nicht auf der Karte').not.toContainText('Flaschen');

    await page.reload(); await karte(page, 'Altglas').waitFor();
    await oeffne(page, 'Altglas');
    await expect(page.locator('#modal .sub-input')).toHaveCount(2);
    await expect(page.locator('#modal .sub-input').first()).toHaveValue('Flaschen sammeln');
  });

  test('Abhaken sofort gespeichert und weiter sichtbar; entfernen und umbenennen mit „Speichern“', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Velo winterfit' }).tap();
    await oeffne(page, 'Kette ölen');
    await expect(zeilen(page)).toHaveCount(3);
    await expect(zeilen(page).nth(0), 'Beispiel: erste schon abgehakt').toHaveClass(/is-done/);
    await zeilen(page).nth(1).locator('.sub-check').tap();
    await expect(zeilen(page).nth(1)).toHaveClass(/is-done/);
    // ohne Speichern schliessen: Abhaken bleibt trotzdem
    await page.locator('#modal .sheet-head [data-action=close]').tap();
    await page.reload(); await karte(page, 'Kette ölen').waitFor();
    await oeffne(page, 'Kette ölen');
    await expect(zeilen(page), 'abgehakte bleiben sichtbar').toHaveCount(3);
    await expect(zeilen(page).nth(1)).toHaveClass(/is-done/);
    await expect(zeilen(page).nth(1).locator('.sub-input')).toHaveCSS('text-decoration-line', 'line-through');

    // entfernen und umbenennen
    await zeilen(page).nth(0).locator('[data-action=sub-del]').tap();
    await expect(zeilen(page)).toHaveCount(2);
    await zeilen(page).nth(1).locator('.sub-input').fill('Bremsbeläge ersetzen');
    await page.locator('#modal button[type=submit]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await oeffne(page, 'Kette ölen');
    await expect(page.locator('#modal .sub-input')).toHaveCount(2);
    await expect(page.locator('#modal .sub-input').nth(1)).toHaveValue('Bremsbeläge ersetzen');
  });
});
