// Offline-fähig (Service Worker) und Updates: Hinweis „Neue Version“, Update kommt vollständig an,
// auch wenn GitHubs Zwischenspeicher noch kurz alte Dateien liefert; „App reparieren“; Daten bleiben.
// Jeder Test hat einen eigenen Server mit einer Kopie der Website (Version A) und einer simulierten
// neuen Veröffentlichung (Version B: andere Bau-Nummer, Version 9.9.9). So stört er keine anderen Tests.
import { test, expect, HANDY, COMPUTER } from './fixtures.mjs';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const SITE = new URL('../site/', import.meta.url).pathname;
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/** Eigener Server: modus 'A' (aktuell), 'B' (neu) oder 'veraltet' (neue Version, normale Adressen liefern noch A) */
test.beforeEach(async ({}, testInfo) => {
  const A = Object.fromEntries(readdirSync(SITE).filter((f) => f.includes('.')).map((f) => [f, readFileSync(join(SITE, f))]));
  const bauA = String(A['sw.js']).match(/const VERSION = '(\d+)'/)[1];
  const verA = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
  const zuB = (buf) => Buffer.from(String(buf).split(bauA).join(String(Number(bauA) + 1)).split(`"${verA}"`).join('"9.9.9"'));
  const B = { ...A, 'sw.js': zuB(A['sw.js']), 'app.js': zuB(A['app.js']) };
  const server = { modus: 'A', verA };
  server.http = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = url.pathname.slice(1) || 'index.html';
    if (!A[file]) { res.writeHead(404); return res.end(); }
    const set = server.modus === 'A' ? A : server.modus === 'B' ? B : (file === 'sw.js' || url.searchParams.has('v') ? B : A);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(set[file]);
  });
  await new Promise((r) => server.http.listen(0, r));
  server.url = `http://localhost:${server.http.address().port}/`;
  testInfo.server = server;
});
test.afterEach(async ({}, testInfo) => { testInfo.server.http.close(); });

const version = async (page, url) => {
  await page.goto(url + '#settings'); await page.locator('.facts').first().waitFor();
  return (await page.locator('.facts', { hasText: 'App-Version' }).innerText()).match(/App-Version\s+([\d.]+)/)?.[1];
};
async function startMitDaten(page, url) {
  await page.goto(url); await page.locator('#capture-input').waitFor();
  await page.fill('#capture-input', 'Bleibt erhalten'); await page.keyboard.press('Enter');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.locator('#main h1').waitFor();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Service Worker aktiv (offline-fähig)').toBe(true);
}
const datenDa = async (page, url) => { await page.goto(url + '#inbox'); await expect(page.locator('#main .row-title', { hasText: 'Bleibt erhalten' })).toHaveCount(1); };

test.describe('Computer', () => {
  test.use(COMPUTER);
  test('neuer Service Worker: Hinweis, Update anwenden, Daten bleiben', async ({ page }, testInfo) => {
    const s = testInfo.server;
    await startMitDaten(page, s.url);
    s.modus = 'B';
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await expect(page.locator('.banner.update')).toContainText('Neue Version', { timeout: 20_000 });
    await Promise.all([page.waitForEvent('load', { timeout: 20_000 }), page.click('[data-action=apply-update]')]);
    await page.locator('#main h1').waitFor();
    await expect(page.locator('.banner.update')).toHaveCount(0);
    await datenDa(page, s.url);
  });
});

test.describe('Handy', () => {
  test.use(HANDY);

  test('„Nach Updates suchen“; Update kommt vollständig an, trotz alter Dateien im Zwischenspeicher', async ({ page }, testInfo) => {
    const s = testInfo.server;
    await startMitDaten(page, s.url);
    expect(await version(page, s.url)).toBe(s.verA);
    await page.locator('[data-action=check-update]').tap();
    await expect(page.locator('#toast')).toContainText('neueste Version', { timeout: 15_000 });

    s.modus = 'veraltet';
    await page.locator('[data-action=check-update]').tap();
    await page.locator('.banner.update').waitFor({ timeout: 20_000 });
    await Promise.all([page.waitForEvent('load', { timeout: 20_000 }), page.locator('[data-action=apply-update]').tap()]);
    expect(await version(page, s.url), 'wirklich die neue Version, keine alte Datei aus dem Zwischenspeicher').toBe('9.9.9');
    await expect(page.locator('.banner.update')).toHaveCount(0);
    await datenDa(page, s.url);
  });

  test('„App reparieren“: lädt frisch, Service Worker wieder eingerichtet, Daten bleiben', async ({ page }, testInfo) => {
    const s = testInfo.server;
    await startMitDaten(page, s.url);
    s.modus = 'B';
    await page.goto(s.url + '#settings'); await page.locator('[data-action=repair-app]').waitFor();
    await Promise.all([page.waitForEvent('load', { timeout: 20_000 }), (async () => { await page.locator('[data-action=repair-app]').tap(); await page.locator('[data-action=confirm]').tap(); })()]);
    await page.locator('#main h1').waitFor();
    expect(await version(page, s.url)).toBe('9.9.9');
    await page.evaluate(() => navigator.serviceWorker.ready);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(1);
    await datenDa(page, s.url);
  });
});
