// Gemeinsame Grundlage aller End-to-End-Tests.
//
// - `page` wartet vor jedem Neuladen/Seitenwechsel, bis die App alles gespeichert hat (wie ein Mensch,
//   der nie Millisekunden nach einer Änderung neu lädt).
// - JavaScript-Fehler und Konsolenfehler auf der Seite lassen den Test scheitern.
// - `geraet(...)` öffnet ein weiteres Gerät (eigener Browser-Kontext = eigene Datenbank) mit denselben Regeln.
// - Geräte: HANDY, IPAD, COMPUTER (mit echten Touch-Ereignissen auf Handy und iPad).
import { test as base, expect } from 'playwright/test';

export { expect };

export const HANDY = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
export const IPAD = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
export const COMPUTER = { viewport: { width: 1180, height: 820 } };

function harden(page, label, errors, allowed) {
  const wait = () => page.evaluate(() => window.kopfFrei?.whenSaved()).catch(() => {});
  const reload = page.reload.bind(page);
  const goto = page.goto.bind(page);
  page.reload = async (opts) => { await wait(); return reload(opts); };
  page.goto = async (url, opts) => { if (page.url().startsWith('http')) await wait(); return goto(url, opts); };
  page.on('pageerror', (e) => errors.push(`${label} Seitenfehler: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !(allowed && allowed.test(m.text()))) errors.push(`${label} Konsole: ${m.text()}`); });
  return page;
}

export const test = base.extend({
  /** Konsolenfehler, die in einem Test erwartet sind (z. B. 401/404 vom simulierten GitHub) */
  erlaubteKonsolenfehler: [null, { option: true }],
  // Wird als Letztes abgebaut (page und geraet hängen davon ab): prüft alle Geräte zusammen
  fehler: async ({}, use) => {
    const list = [];
    await use(list);
    expect(list, 'Fehler auf der Seite').toEqual([]);
  },

  page: async ({ page, fehler, erlaubteKonsolenfehler }, use) => {
    await use(harden(page, '', fehler, erlaubteKonsolenfehler));
  },

  geraet: async ({ browser, fehler, erlaubteKonsolenfehler }, use) => {
    const contexts = [];
    let n = 0;
    await use(async (opts = {}, label = `Gerät ${++n}`) => {
      const ctx = await browser.newContext(opts);
      contexts.push(ctx);
      return harden(await ctx.newPage(), label, fehler, erlaubteKonsolenfehler);
    });
    for (const c of contexts) await c.close();
  },
});
