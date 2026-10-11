// Live- und Test-App auf derselben Domain (wie auf GitHub Pages) sind vollständig getrennt:
// Datenbank, Einstellungen, Service Worker, Caches. Test-App ohne Sync; Live lehnt Test-Backups ab.
// Siehe CLAUDE.md: Änderungen an src/env.ts nur zusammen mit diesem Test.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, karte, keinQuerScrollen } from './hilfen.mjs';

test.describe('Computer', () => {
  test.use(COMPUTER);

  test('Live und Test: getrennte Daten, Einstellungen, Service Worker, Caches; Test-Backup in Live abgelehnt', async ({ page }) => {
    // Live: eigener Eintrag, dunkle Darstellung, Service Worker aktiv
    await gehe(page, '');
    await page.fill('#capture-input', 'LIVE-EINTRAG'); await page.keyboard.press('Enter');
    await page.click('[data-view=settings]'); await page.click('[data-action=theme][data-value=dark]');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); await page.locator('#main h1').waitFor();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Live: Service Worker aktiv').toBe(true);
    await expect(page.locator('.env-strip')).toHaveCount(0);
    await expect(page).toHaveTitle('Kopf frei');

    // Test-App wird nicht vom Live-Service-Worker übernommen
    await gehe(page, 'test/');
    await expect(page).toHaveTitle('Kopf frei TEST');
    await expect(page.locator('.env-strip')).toContainText('TEST-UMGEBUNG');
    await expect(page.locator('.brand').first()).toContainText('TEST');
    await page.click('[data-view=next]');
    await expect(karte(page, 'Velomechaniker'), 'startet mit Beispieldaten').toHaveCount(1);
    await page.click('[data-view=inbox]');
    await expect(karte(page, 'LIVE-EINTRAG'), 'sieht keine Live-Daten').toHaveCount(0);
    await expect(page.locator('html'), 'eigene Darstellung').not.toHaveAttribute('data-theme', /.+/);
    await page.fill('#capture-input', 'TEST-EINTRAG'); await page.keyboard.press('Enter');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const bereiche = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort());
    expect(bereiche, 'zwei getrennte Service Worker').toEqual(['/', '/test/']);

    await page.click('[data-view=settings]');
    await expect(page.locator('#sync'), 'Sync abgeschaltet').toContainText('abgeschaltet');
    await expect(page.locator('#sync-owner')).toHaveCount(0);
    await page.fill('#pass1', 'test-passphrase-1'); await page.fill('#pass2', 'test-passphrase-1');
    await page.click('form[data-form=export] button[type=submit]');
    await page.locator('#backup-text').waitFor({ timeout: 20_000 });
    const testBackup = await page.inputValue('#backup-text');

    // Zurück zu Live
    await gehe(page, '');
    await page.click('[data-view=inbox]');
    await expect(karte(page, 'LIVE-EINTRAG')).toHaveCount(1);
    await expect(karte(page, 'TEST-EINTRAG')).toHaveCount(0);
    await page.click('[data-view=next]');
    await expect(karte(page, 'Velomechaniker'), 'Live: keine Beispieldaten').toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.click('[data-view=settings]');
    await page.click('#import-text-toggle, details:has(#import-text) summary');
    await page.fill('#import-text', testBackup); await page.fill('#import-pass', 'test-passphrase-1');
    await page.click('form[data-form=import] button[type=submit]');
    await expect(page.locator('#toast'), 'Live lehnt Backup aus der Test-App ab').toContainText('Test-App', { timeout: 20_000 });

    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
    expect(dbs).toEqual(expect.arrayContaining(['kopf-frei', 'kopf-frei-test']));
    const caches = await page.evaluate(() => window.caches.keys());
    expect(caches.some((k) => /^kopf-frei-\d+$/.test(k)), `Live-Cache (${caches})`).toBe(true);
    expect(caches.some((k) => /^kopf-frei-test-\d+$/.test(k)), `Test-Cache bleibt (${caches})`).toBe(true);

    // Test-App zurücksetzen: nur Test-Daten weg
    await gehe(page, 'test/');
    await page.click('[data-view=settings]');
    await Promise.all([page.waitForEvent('load'), (async () => { await page.click('[data-action=test-reset]'); await page.click('[data-action=confirm]'); })()]);
    await page.locator('#main h1').waitFor();
    await page.click('[data-view=inbox]');
    await expect(karte(page, 'TEST-EINTRAG')).toHaveCount(0);
    await page.click('[data-view=next]');
    await expect(karte(page, 'Velomechaniker'), 'frische Beispieldaten').toHaveCount(1);
    await gehe(page, '');
    await page.click('[data-view=inbox]');
    await expect(karte(page, 'LIVE-EINTRAG'), 'Live unberührt').toHaveCount(1);
  });
});

test.describe('Handy', () => {
  test.use(HANDY);
  test('Test-App: kein Querscrollen', async ({ page }) => {
    await gehe(page, 'test/#next');
    expect(await keinQuerScrollen(page)).toBe(true);
  });
});
