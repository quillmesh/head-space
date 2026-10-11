// Erledigen mit Rückgängig-Leiste (3 Sekunden), Dialog „Nächster Schritt“ beim letzten Projektschritt,
// Projekteintrag übernehmen, Erledigt über Bearbeiten, Lage der Leiste auf dem Handy.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, karte, iso } from './hilfen.mjs';

/** Live-App mit den eingebauten Beispieleinträgen (Velo-Projekt mit genau einem Schritt) */
const mitBeispielen = async (page, ansicht = 'next') => {
  await gehe(page, '');
  await page.click('[data-action=load-examples]');
  await page.click(`[data-view=${ansicht}]`);
};

test.describe('Am Computer', () => {
  test.use(COMPUTER);

  test('letzter Projektschritt: Leiste oben, Dialog, Rückgängig schliesst und behält die Frist', async ({ page }) => {
    await mitBeispielen(page);
    await karte(page, 'Velomechaniker').locator('.check').click();
    await expect(page.locator('#undo')).toHaveClass(/show/);
    await expect(page.locator('#undo')).toContainText('Erledigt');
    await expect(page.locator('form[data-form=next-step]')).toBeVisible();
    expect((await page.locator('#undo').boundingBox()).y, 'Leiste oben, solange der Dialog offen ist').toBeLessThan(100);
    await page.click('[data-action=undo]');
    await expect(page.locator('#modal')).toBeHidden();
    await expect(karte(page, 'Velomechaniker')).toHaveCount(1);
    await expect(karte(page, 'Velomechaniker').locator('.due'), 'Frist erhalten').not.toHaveText('');
  });

  test('nach 3 Sekunden: Leiste weg, Dialog bleibt; nächster Schritt mit Kontext und Frist', async ({ page }) => {
    await page.clock.install();
    await mitBeispielen(page);
    await karte(page, 'Velomechaniker').locator('.check').click();
    await page.clock.fastForward(3500);
    await expect(page.locator('#undo')).not.toHaveClass(/show/);
    await expect(page.locator('form[data-form=next-step]')).toBeVisible();
    await page.fill('#ns-title', 'Kette ölen'); await page.selectOption('#ns-ctx', '@Zuhause'); await page.fill('#ns-due', iso(5));
    await page.click('form[data-form=next-step] button[type=submit]');
    await expect(karte(page, 'Kette ölen')).toHaveCount(1);
    await expect(karte(page, 'Kette ölen').locator('.ctx-badge')).toHaveAttribute('title', 'Zuhause');
    await expect(karte(page, 'Kette ölen').locator('.chip.proj'), 'gehört zum Projekt').toHaveCount(1);
  });

  test('Dialog bietet vorhandenen Projekteintrag an; kein Dialog, wenn noch Schritte offen sind', async ({ page }) => {
    await mitBeispielen(page, 'projects');
    await page.click('#main .row-title');
    await page.fill('#step-input', 'Licht testen'); await page.keyboard.press('Enter');
    await page.locator('#main .row-title', { hasText: 'Licht testen' }).click();
    await page.selectOption('#e-list', 'someday'); await page.click('form[data-form=edit] button[type=submit]');
    await karte(page, 'Velomechaniker').locator('.check').click();
    await expect(page.locator('[data-action=promote]')).toContainText('Licht testen');
    await page.click('[data-action=promote]');
    await expect(karte(page, 'Licht testen').locator('.check'), 'als nächster Schritt übernommen').toHaveCount(1);
    await expect(page.locator('.callout.warn')).toHaveCount(0);

    await page.fill('#step-input', 'Reifen kaufen'); await page.keyboard.press('Enter');
    await karte(page, 'Reifen kaufen').locator('.check').click();
    await expect(page.locator('#undo')).toHaveClass(/show/);
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('Erledigt über Bearbeiten: auch mit Rückgängig, Titel wird mit zurückgeholt', async ({ page }) => {
    await gehe(page, '');
    await page.fill('#capture-input', 'Rechnung bezahlen'); await page.keyboard.press('Enter');
    await page.locator('#main .row-title', { hasText: 'Rechnung' }).click();
    await page.selectOption('#e-list', 'done'); await page.fill('#e-title', 'Rechnung bezahlt');
    await page.click('form[data-form=edit] button[type=submit]');
    await expect(page.locator('#undo')).toContainText('Erledigt');
    await page.click('[data-action=undo]');
    await expect(karte(page, 'Rechnung bezahlen')).toHaveCount(1);
  });
});

test.describe('Auf dem Handy', () => {
  test.use(HANDY);

  test('Leiste verdeckt den Plus-Knopf nicht', async ({ page }) => {
    await gehe(page, 'test/#waiting');
    await page.locator('#main .check').first().tap();
    await expect(page.locator('#undo')).toHaveClass(/show/);
    const leiste = await page.locator('#undo').boundingBox();
    const plus = await page.locator('.fab:not(.fab-mic)').boundingBox();
    expect(leiste.x + leiste.width).toBeLessThanOrEqual(plus.x);
  });
});
