// Frist direkt in der Karte setzen (Fahne): System-Kalender, Ersatzdialog, Rückgängig,
// Geräte, die nur „input“ melden (iPad/Safari), und Rad-Auswahl mit Fokus.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
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
