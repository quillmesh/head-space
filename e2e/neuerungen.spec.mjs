// Was ist neu (0.12): nach einem Update einmal ein Fenster mit den Neuerungen aus RELEASE-NOTES.md.
import { readFileSync } from 'node:fs';
import { test, expect, HANDY } from './fixtures.mjs';
import { gehe } from './hilfen.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** Einstellung in der Datenbank der Test-App lesen/schreiben (wie sie eine ältere Version hinterlassen hätte) */
const meta = (page, key, value) => page.evaluate(([key, value, write]) => new Promise((resolve, reject) => {
  const r = indexedDB.open('kopf-frei-test');
  r.onsuccess = () => {
    const tx = r.result.transaction('meta', write ? 'readwrite' : 'readonly');
    const req = write ? tx.objectStore('meta').put(value, key) : tx.objectStore('meta').get(key);
    req.onsuccess = () => { r.result.close(); resolve(req.result ?? null); };
    req.onerror = () => reject(req.error);
  };
  r.onerror = () => reject(r.error);
}), [key, value ?? null, value !== undefined]);

test.describe('Was ist neu', () => {
  test.use(HANDY);

  test('neues Gerät: kein Fenster, Version wird gemerkt', async ({ page }) => {
    await gehe(page, 'test/#inbox');
    await expect.poll(() => meta(page, 'notesSeen')).toBe(VERSION);
    await expect(page.locator('#modal .notes-sheet')).toHaveCount(0);
  });

  test('nach einem Update einmal: Neuerungen der neuen Version, danach nicht mehr', async ({ page }) => {
    await gehe(page, 'test/#inbox');
    await expect.poll(() => meta(page, 'notesSeen')).toBe(VERSION);
    await meta(page, 'notesSeen', '0.11.0'); // wie nach einem Update von 0.11.0
    await page.reload();
    const fenster = page.locator('#modal .notes-sheet');
    await expect(fenster).toBeVisible();
    await expect(fenster).toContainText(`Neu in Version ${VERSION}`);
    await expect(fenster.locator('.notes-list li').first()).toBeVisible();
    await page.locator('#modal [data-action=notes-close]').tap();
    await expect(fenster).toHaveCount(0);
    await expect.poll(() => meta(page, 'notesSeen')).toBe(VERSION);
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(page.locator('#modal .notes-sheet')).toHaveCount(0);
  });
});
