// Hilfen für mehrere Testdateien
import { createHash } from 'node:crypto';

/** Datum in n Tagen als YYYY-MM-DD (lokale Zeit) */
export const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Karte mit genau diesem Titel (Teiltreffer) */
export const karte = (page, titel) => page.locator('#main li.row', { has: page.locator('.row-title', { hasText: titel }) });

/** Zur Ansicht wechseln und warten, bis sie da ist */
export const gehe = async (page, pfad) => { await page.goto(pfad); await page.locator('#main h1, #main .back').first().waitFor(); };

/** Mittelpunkte (senkrecht) der sichtbaren Elemente: zum Prüfen „auf einer Linie“ */
export const mitten = (loc) => loc.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }));

/** Warten, bis alle laufenden CSS-Animationen und Übergänge fertig sind (statt einer festen Wartezeit) */
export const animationenFertig = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

/** Kein horizontales Scrollen */
export const keinQuerScrollen = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/**
 * Wischen nach links mit Touch-Pointer-Ereignissen (so, wie die App sie vom Finger bekommt).
 * Läuft in jedem Browser. Für echte Finger-Ereignisse über das Chrome-Protokoll siehe fingerZiehen.
 */
export async function wischen(zeile, dx = -140, dy = 0) {
  await zeile.locator('.row-inner').evaluate((el, [dx, dy]) => {
    const r = el.getBoundingClientRect();
    const x0 = r.right - 30, y0 = r.top + r.height / 2;
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    ev('pointerdown', x0, y0);
    for (let i = 1; i <= 8; i++) ev('pointermove', x0 + (dx * i) / 8, y0 + (dy * i) / 8);
    ev('pointerup', x0 + dx, y0 + dy);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x0 + dx, clientY: y0 + dy }));
  }, [dx, dy]);
}

/** Echte Finger-Geste über das Chrome-Protokoll (nur Chromium): Finger auf (x, y), um (dx, dy) ziehen */
export async function fingerZiehen(page, x, y, dx, dy) {
  const cdp = await page.context().newCDPSession(page);
  const tp = (xx, yy) => [{ x: xx, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x, y) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x + (dx * i) / 12, y + (dy * i) / 12) });
    await page.waitForTimeout(16); // ein Bildschirmbild, wie ein echter Finger
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Mitte eines Elements */
export async function mitte(loc) { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; }

/**
 * Simuliertes GitHub (Contents- und Git-API), wie die App es für den Sync nutzt.
 * Ein Objekt pro Test; mehrere Geräte teilen es (gleiches Daten-Repo).
 */
export function simuliertesGitHub() {
  const files = new Map(); // Pfad -> Base64
  const state = { isPrivate: true, calls: 0 };
  const shaOf = (p) => createHash('sha1').update(p).digest('hex'); // wie GitHub: eindeutig je Datei
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS' };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  async function handler(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    state.calls++;
    const u = new URL(req.url());
    if (req.headers()['authorization'] !== 'Bearer github_pat_gut') return json(route, 401, { message: 'Bad credentials' });
    const m = u.pathname.match(/^\/repos\/adrian\/head-space-data(\/.*)?$/);
    if (!m) return json(route, 404, { message: 'Not Found' });
    const rest = m[1] ?? '';
    if (rest === '') return json(route, 200, { private: state.isPrivate, default_branch: 'main', full_name: 'adrian/head-space-data', permissions: { push: true } });
    if (rest.startsWith('/contents/')) {
      const path = decodeURIComponent(rest.slice('/contents/'.length));
      if (req.method() === 'GET') return files.has(path) ? json(route, 200, { content: files.get(path), sha: shaOf(path) }) : json(route, 404, { message: 'Not Found' });
      if (req.method() === 'PUT') {
        if (files.has(path)) return json(route, 422, { message: "sha wasn't supplied" });
        files.set(path, JSON.parse(req.postData()).content);
        return json(route, 201, { content: { path } });
      }
    }
    if (rest.startsWith('/git/trees/')) {
      if (!files.size) return json(route, 409, { message: 'Git Repository is empty.' });
      return json(route, 200, { tree: [...files.keys()].map((p) => ({ path: p, type: 'blob', sha: shaOf(p) })), truncated: false });
    }
    if (rest.startsWith('/git/blobs/')) {
      const p = [...files.keys()].find((k) => shaOf(k) === rest.slice('/git/blobs/'.length));
      return p ? json(route, 200, { content: files.get(p) }) : json(route, 404, { message: 'Not Found' });
    }
    return json(route, 404, { message: 'Not Found' });
  }
  return {
    files, state,
    /** Inhalt des Repos als Klartext (zum Prüfen, dass nichts unverschlüsselt hochgeladen wird) */
    text: () => [...files.entries()].map(([p, c]) => p + ' ' + Buffer.from(c, 'base64').toString('utf8')).join('\n'),
    /** Gerät an dieses GitHub anschliessen */
    anschliessen: (page) => page.context().route('https://api.github.com/**', handler),
  };
}

/** Sync im Formular einrichten: erstes Gerät mit zwei Passphrase-Feldern, weitere mit einem */
export async function syncEinrichten(page, { erstes, token = 'github_pat_gut', pass = 'mein-geheimer-satz-123' } = {}) {
  await gehe(page, '#settings'); await page.locator('#sync-owner').waitFor();
  await page.fill('#sync-owner', 'adrian'); await page.fill('#sync-repo', 'head-space-data'); await page.fill('#sync-token', token);
  await page.click('form[data-form=sync-probe] button[type=submit]');
  await page.locator('#sync-pass1').waitFor();
  await page.fill('#sync-pass1', pass);
  if (erstes) await page.fill('#sync-pass2', pass);
  await page.click('form[data-form=sync-connect] button[type=submit]');
  await page.locator('#sync .sync-idle').waitFor({ timeout: 30_000 });
}
