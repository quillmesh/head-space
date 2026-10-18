// Friert echte Daten einer älteren App-Version als „Golden File“ ein.
//
// Baut die App aus einem Commit, lässt sie im Browser echte Daten erzeugen (Beispieleinträge laden,
// etwas erfassen, erledigen, bearbeiten) und speichert:
//   - ereignisse: alle Ereignisse genau so, wie die alte Version sie in IndexedDB geschrieben hat
//   - ansichten:  welche Titel die alte Version in welcher Liste angezeigt hat
// tests/unit/alte-daten.test.ts prüft damit, dass die aktuelle App diese Daten genau so liest.
//
// Aufruf (einmal pro Version, Ergebnis wird eingecheckt; danach nie mehr ändern):
//   node scripts/alte-daten-einfrieren.mjs <commit> <version>
//   z. B.  node scripts/alte-daten-einfrieren.mjs 44b8e7f 0.9.0
// Braucht Playwright (lokal installiert oder PLAYWRIGHT_MODULE).
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const [commit, version] = process.argv.slice(2);
if (!commit || !version) { console.error('Aufruf: node scripts/alte-daten-einfrieren.mjs <commit> <version>'); process.exit(1); }
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kf-alt-'));

try {
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, commit], { stdio: 'ignore' });
  execFileSync('bun', ['run', 'build.mjs'], { cwd: dir, stdio: 'ignore', env: { ...process.env, KF_ENV: 'live', KF_OUT: join(dir, 'dist') } });
  const dist = join(dir, 'dist');
  const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer((req, res) => {
    const p = join(dist, new URL(req.url, 'http://x').pathname.slice(1) || 'index.html');
    if (!existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 }, hasTouch: true, serviceWorkers: 'block' })).newPage();
  page.setDefaultTimeout(3000);
  page.on('dialog', (d) => d.accept());
  const aktionen = [];
  // Jede Aktion nur, wenn die Version sie kennt; was geklappt hat, wird mitgespeichert.
  const step = async (name, fn) => {
    try { await fn(); await page.waitForTimeout(150); aktionen.push(name); } catch (e) { if (process.env.DEBUG) console.log(name, e.message.split("\n")[0]); }
    await page.keyboard.press('Escape').catch(() => {});
    if (await page.locator('#modal').isVisible().catch(() => false)) await page.locator('#modal [data-action=close]').first().click().catch(() => {});
  };
  const go = async (v) => { await page.goto(url + '#' + v); await page.waitForSelector('#main h1'); };
  const swipe = (loc) => loc.locator('.row-inner').evaluate((el) => {
    const r = el.getBoundingClientRect(); const x0 = r.right - 30, y0 = r.top + r.height / 2;
    const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y0, isPrimary: true }));
    ev('pointerdown', x0); for (let i = 1; i <= 8; i++) ev('pointermove', x0 - (140 * i) / 8); ev('pointerup', x0 - 140);
  });

  await page.goto(url); await page.waitForSelector('#capture-input');
  await step('Beispieleinträge laden', async () => { await page.click('[data-action=load-examples]'); await page.waitForSelector('#main .row'); });
  for (const t of [`Grüezi aus ${version} – Spass mit Umlauten`, 'Wohnung kündigen', 'Wird gewischt', 'In den Papierkorb']) {
    await page.fill('#capture-input', t); await page.keyboard.press('Enter');
  }
  await step('Bearbeiten: Liste, Kontext, Frist, Notiz', async () => {
    await page.locator('#main .row-title', { hasText: 'Wohnung kündigen' }).click(); await page.waitForSelector('#e-title');
    await page.selectOption('#e-list', 'next'); await page.selectOption('#e-ctx', '@Computer');
    await page.fill('#e-due', '2026-11-30'); await page.fill('#e-notes', 'Belege im Ordner „2025“');
    await page.click('form[data-form=edit] button[type=submit]');
  });
  await step('Warten auf: Nachfassen', async () => {
    await go('waiting'); await page.locator('#main .row-title').first().click(); await page.waitForSelector('#e-tickler');
    await page.fill('#e-tickler', '2026-10-20'); await page.click('form[data-form=edit] button[type=submit]');
  });
  await step('Neues Projekt mit drei Schritten', async () => {
    await go('projects'); await page.click('[data-action=new-project]');
    await page.fill('#pf-title', 'Velo verkaufen'); await page.fill('#pf-next', 'Fotos machen');
    await page.click('form[data-form=project] button[type=submit]');
    await page.waitForSelector('#step-input');
    for (const s of ['Inserat schreiben', 'Preis recherchieren']) { await page.fill('#step-input', s); await page.keyboard.press('Enter'); }
  });
  await step('Projekt: Schritt mit Pfeiltaste verschieben (ab 0.8)', async () => {
    const h = page.locator('#main .drag-handle').last(); await h.focus(); await page.keyboard.press('ArrowUp');
  });
  await step('Projekt: „Nur die nächste“ (0.8–0.9)', async () => { await page.locator('[data-action=project-seq]').last().click(); });
  await step('Erledigen', async () => { await go('next'); await page.locator('#main .check').first().click(); });
  await step('Wischen: Aufgabe löschen', async () => {
    await go('inbox'); const row = page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Wird gewischt' }) });
    await swipe(row); await page.waitForSelector('#main li.row.swipe-open'); await page.waitForTimeout(450); // ältere Versionen ignorieren Tipps direkt nach dem Wischen
    await row.locator('.swipe-del').evaluate((b) => b.click());
    await page.waitForFunction(() => ![...document.querySelectorAll('#main .row-title')].some((t) => t.textContent.includes('Wird gewischt')));
  });
  await step('Papierkorb und leeren', async () => {
    await go('inbox'); await page.locator('#main .row-title', { hasText: 'In den Papierkorb' }).click(); await page.waitForSelector('#e-title');
    await page.click('[data-action=trash]'); await go('done');
    await page.click('[data-action=empty-trash]'); await page.click('[data-action=confirm]');
  });
  await step('Wischen: Projekt löschen (bis 0.9)', async () => {
    await go('projects'); const row = page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Velo verkaufen' }) });
    await swipe(row); await row.locator('.swipe-del').click();
  });
  // ab 0.12: Projektfarbe, Unteraufgaben (Ereignis item.sub), Projekt abschliessen und Aufgabe zurückholen
  await step('Projektfarbe wählen (ab 0.12)', async () => {
    await go('projects'); await page.locator('#main .row-title', { hasText: 'Velo verkaufen' }).click();
    await page.click('[data-action=pick-color]'); await page.click('#modal .swatch[data-key=wein]');
    await page.waitForSelector('#main .view-head.pc-wein');
  });
  await step('Unteraufgaben: anlegen, abhaken, umbenennen (ab 0.12)', async () => {
    await go('next'); await page.locator('#main .row-title', { hasText: 'Inserat schreiben' }).click(); await page.waitForSelector('#e-title');
    await page.click('[data-action=sub-start]'); await page.keyboard.type('Vertrag suchen');
    await page.click('[data-action=sub-add]'); await page.keyboard.type('Brief schreiben');
    await page.click('form[data-form=edit] button[type=submit]');
    await page.locator('#main .row-title', { hasText: 'Inserat schreiben' }).click(); await page.waitForSelector('.sub-check');
    await page.locator('.sub-check').first().click();
    await page.locator('.sub-input').last().fill('Brief eingeschrieben schicken');
    await page.click('form[data-form=edit] button[type=submit]');
  });
  await step('Projekt abschliessen mit offenen Aufgaben (ab 0.12)', async () => {
    await go('projects'); await page.locator('#main .row-title', { hasText: 'Velo verkaufen' }).click();
    await page.click('[data-action=close-project]'); await page.click('#modal [data-action=close-project-go][data-with="1"]');
  });
  await step('Aufgabe aus abgeschlossenem Projekt zurückholen: nur die Aufgabe (ab 0.12)', async () => {
    await go('done'); await page.locator('#main .row-title', { hasText: 'Velo verkaufen' }).click();
    await page.locator('#main [data-action=restore]').first().click(); await page.click('#modal [data-mode=item]');
  });
  // ab 0.13: „Geklärt“ in der Inbox und Klären mit Ziel-Kacheln
  await step('Inbox: Geklärt → schon erledigt (ab 0.13)', async () => {
    await go('inbox'); await page.fill('#capture-input', 'Kurz erledigt'); await page.keyboard.press('Enter');
    await page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Kurz erledigt' }) }).locator('[data-action=quick-done]').click();
    await page.click('#modal [data-action=quick-go][data-to=done]');
  });
  await step('Klären: Ziel „Nächster Schritt“ mit Kontext (ab 0.13)', async () => {
    await go('inbox'); await page.locator('#main li.row', { has: page.locator('.row-title', { hasText: 'Grüezi' }) }).locator('[data-action=clarify]').click();
    await page.click('[data-step=yes]'); await page.click('[data-action=clarify-goal][data-val=next]');
    await page.click('.ctx-chip[data-ctx="@Telefon"]'); await page.click('form[data-form=clarify-yes] button[type=submit]');
  });
  await page.evaluate(() => window.kopfFrei?.whenSaved?.());
  console.log(`${version}: ${aktionen.join(' · ')}`);

  // Was die alte Version anzeigt (Titel je Ansicht)
  const ansichten = {};
  for (const v of ['inbox', 'next', 'waiting', 'someday', 'reference', 'projects']) {
    await page.goto(url + '#' + v); await page.waitForSelector('#main h1');
    await page.waitForTimeout(150);
    ansichten[v] = (await page.locator('#main .row-title').allInnerTexts()).map((t) => t.trim()).filter(Boolean).sort();
  }
  const ereignisse = await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('kopf-frei');
    r.onerror = rej;
    r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res(q.result.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1))); };
  }));
  await browser.close(); server.close();

  const out = join(root, 'tests/unit/alte-daten', `v${version}.json`);
  writeFileSync(out, JSON.stringify({ version, commit, erzeugt: new Date().toISOString().slice(0, 10), aktionen, ansichten, ereignisse }, null, 1) + '\n');
  console.log(`${out}: ${ereignisse.length} Ereignisse`);
} finally {
  execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' });
  rmSync(dir, { recursive: true, force: true });
}
