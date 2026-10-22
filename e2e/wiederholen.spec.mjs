// Wiederkehrende Aufgaben (0.14, Variante A): beim Klären „Wiederholen“ einschalten, Wochentage antippen;
// erledigen legt die nächste an, pro Serie nur die nächste sichtbar; ↻ auf der Karte; ändern/beenden im Dialog.
import { test, expect, HANDY } from './fixtures.mjs';
import { gehe, karte, iso } from './hilfen.mjs';

/** Wochentag von heute + n (0 = Montag) */
const wt = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return (d.getDay() + 6) % 7; };

test.describe('Wiederholen auf dem Handy', () => {
  test.use(HANDY);

  test('beim Klären einschalten: Wochentage, Satz, erste Frist; Karte mit ↻', async ({ page }) => {
    await gehe(page, '');
    await page.fill('#capture-input', 'Abfall rausstellen'); await page.keyboard.press('Enter');
    await karte(page, 'Abfall').locator('[data-action=clarify]').tap();
    await page.locator('[data-step=yes]').tap();
    await page.locator('[data-action=clarify-goal][data-val=next]').tap();
    const box = page.locator('[data-repeat-box]');
    await expect(box.locator('.rep-seg'), 'aus: nur der Schalter').toHaveCount(0);
    await box.locator('[data-action=repeat-toggle]').tap();
    await expect(box.locator('[data-action=repeat-toggle]')).toHaveAttribute('aria-checked', 'true');
    await expect(box.locator('[data-action=repeat-kind][data-kind=week]')).toHaveAttribute('aria-pressed', 'true');
    // heute ist vorgewählt; zusätzlich übermorgen, heute wieder abwählen
    await box.locator(`[data-action=repeat-day][data-day="${wt(2)}"]`).tap();
    await box.locator(`[data-action=repeat-day][data-day="${wt(0)}"]`).tap();
    await expect(box.locator('.repeat-sum')).toContainText('sichtbar 7 Tage vorher');
    await page.locator('form[data-form=clarify-yes] button[type=submit]').tap();
    await gehe(page, '#next');
    const k = karte(page, 'Abfall');
    await expect(k.locator('.rep-ico'), '↻ auf der Karte').toHaveCount(1);
    await expect(k.locator('button.due'), 'erste Frist: übermorgen').toHaveAttribute('aria-label', new RegExp(`${new Date(iso(2)).getDate()}\\.`));
  });

  test('erledigen legt die nächste an; nur eine pro Serie sichtbar; Rückgängig', async ({ page }) => {
    await gehe(page, '');
    await page.fill('#capture-input', 'Pflanzen'); await page.keyboard.press('Enter');
    await karte(page, 'Pflanzen').locator('[data-action=clarify]').tap();
    await page.locator('[data-step=yes]').tap();
    await page.locator('[data-action=clarify-goal][data-val=next]').tap();
    await page.locator('[data-action=repeat-toggle]').tap();
    for (let n = 1; n < 7; n++) await page.locator(`[data-action=repeat-day][data-day="${wt(n)}"]`).tap(); // jeden Tag
    await expect(page.locator('.repeat-sum')).toContainText('Jeden Tag');
    await page.locator('form[data-form=clarify-yes] button[type=submit]').tap();
    await gehe(page, '#next');
    await expect(karte(page, 'Pflanzen')).toHaveCount(1);
    await expect(karte(page, 'Pflanzen').locator('button.due')).toHaveText(/Heute/);
    await page.clock.install();
    await karte(page, 'Pflanzen').locator('.check').tap();
    await page.clock.runFor(400);
    await expect(karte(page, 'Pflanzen'), 'nächste ist da, nur eine').toHaveCount(1);
    await expect(karte(page, 'Pflanzen').locator('button.due'), 'Frist morgen').toHaveAttribute('aria-label', new RegExp(`${new Date(iso(1)).getDate()}\\.`));
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(karte(page, 'Pflanzen')).toHaveCount(1);
  });

  test('im Bearbeiten-Dialog ändern (Monatlich am Tag X) und beenden', async ({ page }) => {
    await gehe(page, 'test/#next');
    await karte(page, 'Pflanzen giessen').locator('.row-title').tap();
    const box = page.locator('#modal [data-repeat-box]');
    await expect(box.locator('[data-action=repeat-toggle]')).toHaveAttribute('aria-checked', 'true');
    await box.locator('[data-action=repeat-kind][data-kind=month]').tap();
    await page.selectOption('#rep-day', '28');
    await expect(box.locator('.repeat-sum')).toContainText('Jeden Monat am 28.');
    await page.locator('#modal button[type=submit]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await karte(page, 'Pflanzen giessen').locator('.row-title').tap();
    await expect(page.locator('#modal .repeat-sum')).toContainText('Jeden Monat am 28.');
    await page.locator('#modal [data-action=repeat-toggle]').tap();
    await page.locator('#modal button[type=submit]').tap();
    await expect(karte(page, 'Pflanzen giessen').locator('.rep-ico'), 'beendet: kein ↻').toHaveCount(0);
  });

  test('ohne Wochentag lässt es sich nicht speichern', async ({ page }) => {
    await gehe(page, 'test/#next');
    await karte(page, 'Altglas').locator('.row-title').tap();
    await page.locator('#modal [data-action=repeat-toggle]').tap();
    await page.locator(`#modal [data-action=repeat-day][data-day="${wt(0)}"]`).tap();
    await expect(page.locator('#modal .repeat-sum')).toHaveText('Wähl mindestens einen Wochentag.');
    await page.locator('#modal button[type=submit]').tap();
    await expect(page.locator('#modal'), 'Dialog bleibt offen').toBeVisible();
    await expect(page.locator('#toast, .toast').first()).toContainText('Wochentag');
  });
});
