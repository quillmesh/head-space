// Jede Knopfart reagiert auf Antippen (echte Touch-Ereignisse), einmal pro Gerät (Entscheid 0.11):
// Alle Ansichten und wichtigen Dialoge werden durchgegangen; eine Knopfart wird dort geprüft, wo sie zum
// ersten Mal erreichbar ist. Handy und iPad mit Chromium; iPad zusätzlich mit WebKit (Safari-Kern) auf
// GitHub (E2E_WEBKIT=1, Markierung @webkit).
// „Reagiert“ heisst: die Seite ändert sich, die Adresse wechselt oder die Datumsauswahl wird geöffnet.
import { test, expect, HANDY, IPAD } from './fixtures.mjs';
import { animationenFertig } from './hilfen.mjs';

const VIEWS = ['inbox', 'next', 'due', 'projects', 'waiting', 'tickler', 'someday', 'reference', 'done', 'settings'];
// Zustände mit Dialogen bzw. Unteransichten: [Name, Hash, Vorbereitung]
const STATES = [
  ...VIEWS.map((v) => [v, '#' + v, null]),
  ['projekt', '#projects', async (p) => { await p.locator('#main .row-title', { hasText: 'Velo winterfit' }).first().tap({ timeout: 3000 }); await p.locator('#step-input').waitFor({ timeout: 3000 }); }],
  ['bearbeiten', '#waiting', async (p) => { await p.locator('#main .row-title', { hasText: 'Lisa' }).first().tap({ timeout: 3000 }); await p.locator('#e-title').waitFor({ timeout: 3000 }); }],
  // 0.12: Farbwahl, Unteraufgaben, Rückfrage beim Abschliessen
  ['farbwahl', '#projects', async (p) => { await p.locator('#main .row-title', { hasText: 'Velo winterfit' }).first().tap({ timeout: 3000 }); await p.locator('[data-action=pick-color]').tap({ timeout: 3000 }); await p.locator('#modal .palette').waitFor({ timeout: 3000 }); }],
  ['unteraufgaben', '#projects', async (p) => { await p.locator('#main .row-title', { hasText: 'Velo winterfit' }).first().tap({ timeout: 3000 }); await p.locator('#main .row-title', { hasText: 'Kette ölen' }).tap({ timeout: 3000 }); await p.locator('#modal .sub-list').waitFor({ timeout: 3000 }); }],
  ['abschliessen', '#projects', async (p) => { await p.locator('#main .row-title', { hasText: 'Velo winterfit' }).first().tap({ timeout: 3000 }); await p.locator('[data-action=close-project]').tap({ timeout: 3000 }); await p.locator('#modal .stack-btns').waitFor({ timeout: 3000 }); }],
  ['klären', '#inbox', async (p) => { await p.locator('[data-action=clarify-first]').tap({ timeout: 3000 }); await p.locator('#clarify-title').waitFor({ timeout: 3000 }); }],
  ['menü', '#inbox', async (p) => { if (await p.locator('.menu-btn').isVisible()) { await p.locator('.menu-btn').tap(); await animationenFertig(p); } }],
  ['schnellerfassung', '#inbox', async (p) => { await p.locator('.fab').tap(); await p.locator('#quick-input').waitFor(); }],
];
// Bewusst ohne sichtbare Reaktion: Griff (nur Ziehen), Löschen hinter der Karte (nur nach Wischen sichtbar)
const SKIP = '.drag-handle, .swipe-del';

const SPY = () => {
  // erreichbar = sichtbar und an seiner Mitte nicht von etwas anderem verdeckt (z. B. eingeklapptes Menü)
  window.__reachable = (el) => {
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height || getComputedStyle(el).visibility === 'hidden') return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  };
  window.__sig = (el) => { const d = el.dataset; return [el.tagName, d.action ?? '', d.view ?? '', d.status ?? '', d.seq ?? '', d.step ?? '', d.theme ?? '', d.mode ?? '', d.action ? '' : el.textContent.trim().slice(0, 30)].join('|'); };
  window.__picker = 0;
  HTMLInputElement.prototype.showPicker = function () { window.__picker++; };
};

for (const [geraetName, geraet] of [['Handy', HANDY], ['iPad @webkit', IPAD]]) {
  test.describe(`Alle Knöpfe: ${geraetName}`, () => {
    // Service Worker hier aus: er hat mit den Knöpfen nichts zu tun (eigene Tests in update-offline.spec.mjs)
    // und würde sich bei jedem Neuladen neu einrichten.
    test.use({ ...geraet, serviceWorkers: 'block' });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(SPY);
      page.on('dialog', (d) => d.dismiss());
    });
    // Vor jedem Knopf frische Beispieldaten: Datenbank der Test-App löschen, die App legt sie beim Start neu an.
    // So beginnt jeder Versuch im selben Zustand, egal was der vorherige Knopf verändert hat.
    const laden = async (page, hash, prep) => {
      await page.goto('test/icon.svg');
      await page.evaluate(() => new Promise((res) => { localStorage.clear(); const r = indexedDB.deleteDatabase('kopf-frei-test'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
      await page.goto('test/' + hash);
      await page.locator('#main h1, #main .back').first().waitFor();
      if (prep) await prep(page);
    };

    test('jede Knopfart reagiert auf Antippen', async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const geprueft = new Set();
      const ohneReaktion = [];
      for (const [name, hash, prep] of STATES) {
        const lade = () => laden(page, hash, prep);
        await lade();
        // Knopfarten dieser Ansicht, die noch in keiner früheren Ansicht geprüft wurden
        const sigs = (await page.evaluate((skip) => [...new Set([...document.querySelectorAll('button, a[href]')]
          .filter((el) => !el.closest(skip) && window.__reachable(el)).map((el) => window.__sig(el)))], SKIP))
          .filter((sig) => !geprueft.has(sig));
        for (const sig of sigs) {
          geprueft.add(sig);
          await lade();
          const found = await page.evaluate(([sig, skip]) => {
            const cands = [...document.querySelectorAll('button, a[href]')].filter((el) => !el.closest(skip) && window.__reachable(el) && window.__sig(el) === sig);
            // schon gewählte Schalter (Filter „Alle“, aktuelles Design) ändern nichts: einen anderen nehmen
            const el = cands.find((c) => c.getAttribute('aria-pressed') !== 'true' && !c.classList.contains('is-active')) ?? cands[0];
            if (!el) return 'missing';
            if (el.type === 'submit' && el.form) {
              // leere Textfelder ausfüllen, damit Absenden etwas bewirkt
              el.form.querySelectorAll('input:not([type]), input[type=text], textarea').forEach((f) => { if (!f.value && !f.readOnly) f.value = 'Knopf-Test'; });
              if (!el.form.checkValidity()) return 'invalid';
            }
            if (cands.length > 1 && el === cands[0] && (el.getAttribute('aria-pressed') === 'true' || el.classList.contains('is-active'))) return 'selected';
            window.__reachable(el);
            el.setAttribute('data-knopf', '1');
            return 'ok';
          }, [sig, SKIP]);
          if (found !== 'ok') continue;
          const knopf = page.locator('[data-knopf="1"]');
          const label = `${name}: ${sig.split('|').filter(Boolean).slice(1).join(' ') || sig}`;
          const vorher = await page.evaluate(() => { const k = document.querySelector('[data-knopf]'); k?.removeAttribute('data-knopf'); const h = document.documentElement.outerHTML; k?.setAttribute('data-knopf', '1'); return { h, url: location.href, p: window.__picker }; });
          try { await knopf.tap({ timeout: 2500 }); } catch (e) { ohneReaktion.push(`${label}: lässt sich nicht antippen (${e.message.split('\n')[0]})`); continue; }
          // Reaktion abwarten (Seite neu geladen zählt auch als Reaktion)
          const reagiert = await expect.poll(async () => {
            const nachher = await page.evaluate(() => { document.querySelector('[data-knopf]')?.removeAttribute('data-knopf'); return { h: document.documentElement.outerHTML, url: location.href, p: window.__picker ?? 0 }; }).catch(() => null);
            return !nachher || nachher.h !== vorher.h || nachher.url !== vorher.url || nachher.p > vorher.p;
          }, { timeout: 1500 }).toBe(true).then(() => true, () => false);
          if (!reagiert) ohneReaktion.push(`${label}: keine Reaktion`);
        }
      }
      testInfo.annotations.push({ type: 'Knopfarten', description: String(geprueft.size) });
      if (process.env.KNOPF_DEBUG) (await import('node:fs')).appendFileSync(process.env.KNOPF_DEBUG, `${geraetName} ${geprueft.size}\n`);
      expect(geprueft.size, 'Knopfarten gefunden').toBeGreaterThan(30);
      expect(ohneReaktion, geraetName).toEqual([]);
    });

    test('Fahne öffnet die Datumsauswahl beim ersten Antippen (Liste und Projekt); Feld nicht umgestaltet', async ({ page }) => {
      for (const [hash, prep] of [['#next', null], ['#projects', STATES.find((s) => s[0] === 'projekt')[2]]]) {
        await laden(page, hash, prep);
        const p0 = await page.evaluate(() => window.__picker);
        await page.locator('#main [data-action=due-pick]').first().tap();
        await expect.poll(async () => (await page.evaluate(() => window.__picker)) > p0 || await page.locator('#modal form[data-form=due]').isVisible(), hash).toBe(true);
      }
      // Unsichtbare Felder hinter der Fahne behalten das Aussehen des Systems (sonst öffnet Safari nichts)
      const aussehen = await page.locator('#main .due-input').first().evaluate((el) => getComputedStyle(el).webkitAppearance || getComputedStyle(el).appearance);
      expect(aussehen).not.toBe('none');
    });
  });
}
