// Spracheingabe. Seit 0.8 PAUSIERT: Der Code bleibt, eingeschaltet nur über localStorage
// `kopf-frei-voice-enabled = 1` (so auch in diesen Tests). Die Spracherkennung des Browsers ist simuliert.
// Ursprüngliches Problem (offen): Android 10, Chrome, installierte App: „aborted“ nach ca. 8 ms ohne „audiostart“.
import { test, expect, COMPUTER, HANDY, IPAD } from './fixtures.mjs';
import { gehe } from './hilfen.mjs';

const EIN = () => localStorage.setItem('kopf-frei-voice-enabled', '1');

/** Simulierte Erkennung: Verfügbarkeit offline aus localStorage „fakeAvail“; erkennt window.__say */
const ERKENNUNG_A = () => {
  window.__avail = localStorage.getItem('fakeAvail') || 'unavailable';
  class FakeSR {
    constructor() { this.processLocally = false; this.lang = ''; }
    start() {
      window.__srStarted = { local: this.processLocally, lang: this.lang, activation: navigator.userActivation ? navigator.userActivation.isActive : true };
      setTimeout(() => {
        this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'Zahnarzt' }], { isFinal: false })] });
        setTimeout(() => {
          this.onresult && this.onresult({ results: [Object.assign([{ transcript: window.__say || 'Zahnarzt anrufen' }], { isFinal: true })] });
          this.onend && this.onend();
        }, 120);
      }, 60);
    }
    stop() { this.onend && this.onend(); }
  }
  FakeSR.available = async () => window.__avail;
  FakeSR.install = async () => { window.__avail = 'available'; localStorage.setItem('fakeAvail', 'available'); return true; };
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
};

/** Simulierte Erkennung mit wählbarem Verhalten: silent = endet ohne Aufnahme, ok = „Hallo Welt“, aborted = Abbruch */
const ERKENNUNG_B = () => {
  window.__mode = 'silent';
  class FakeSR extends EventTarget {
    constructor() { super(); this.processLocally = false; }
    start() {
      window.__starts = (window.__starts || 0) + 1;
      window.__srStarted = { local: this.processLocally };
      const mode = window.__mode;
      this.dispatchEvent(new Event('start'));
      setTimeout(() => {
        if (mode === 'ok') {
          this.dispatchEvent(new Event('audiostart'));
          this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'Hallo Welt' }], { isFinal: true })] });
        }
        if (mode === 'aborted') this.onerror && this.onerror({ error: 'aborted' });
        this.onend && this.onend();
      }, 50);
    }
    stop() { this.onend && this.onend(); }
  }
  FakeSR.available = async () => 'available';
  window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
};
const feldIst = (page, sel, wert) => page.waitForFunction(([s, w]) => document.querySelector(s)?.value === w, [sel, wert]);

test.describe('Ausgeschaltet (Normalfall seit 0.8)', () => {
  test.use(IPAD);
  test('nirgends ein Mikrofon, kein Bereich in den Einstellungen', async ({ page }) => {
    await gehe(page, 'test/');
    await expect(page.locator('.mic')).toHaveCount(0);
    await expect(page.locator('.fab-mic')).toBeHidden();
    await page.locator('.fab:not(.fab-mic)').tap(); await page.locator('#quick-input').waitFor();
    await expect(page.locator('#modal .mic')).toHaveCount(0);
    await page.locator('#modal .sheet-head [data-action=close]').tap();
    await gehe(page, 'test/#settings');
    await expect(page.locator('#main')).not.toContainText('Spracheingabe');
  });
});

test.describe('Eingeschaltet (für Tests): Zustimmung, offline/online, Sprachpaket', () => {
  test.use(COMPUTER);
  test.beforeEach(async ({ page }) => { await page.addInitScript(ERKENNUNG_A); await page.addInitScript(EIN); });
  const szenario = async (page, verfuegbar, sagt) => {
    await page.evaluate((a) => localStorage.setItem('fakeAvail', a), verfuegbar);
    await page.reload(); await page.locator('#main h1').waitFor();
    await page.evaluate((t) => { window.__say = t; window.__srStarted = null; }, sagt);
  };

  test('offline verfügbar: erster Tipp fragt, zweiter nimmt sofort auf, Geste bleibt erhalten', async ({ page }) => {
    await gehe(page, '');
    await szenario(page, 'available', 'Zahnarzt anrufen');
    await page.click('#main .mic');
    await page.locator('[data-action=voice-local]').waitFor();
    expect(await page.evaluate(() => window.__srStarted), 'ohne Zustimmung keine Aufnahme').toBeNull();
    await page.click('[data-action=voice-local]');
    await feldIst(page, '#capture-input', 'Zahnarzt anrufen');
    expect(await page.evaluate(() => window.__srStarted)).toMatchObject({ local: true, lang: 'de-DE', activation: true });
    await page.fill('#capture-input', '');
    await page.evaluate(() => { window.__srStarted = null; });
    await page.click('#main .mic');
    await feldIst(page, '#capture-input', 'Zahnarzt anrufen');
    await expect(page.locator('#modal'), 'zweiter Tipp: kein Dialog').toBeHidden();
    expect(await page.evaluate(() => window.__srStarted)).toMatchObject({ local: true, activation: true });
  });

  test('nur online: Zustimmung „Nur dieses Mal“ fragt beim nächsten Mal wieder; Abbrechen', async ({ page }) => {
    await gehe(page, '');
    await szenario(page, 'unavailable', 'Offerte Fenster einholen');
    await page.click('#main .mic');
    await page.locator('[data-action=voice-once]').waitFor();
    expect(await page.evaluate(() => window.__srStarted)).toBeNull();
    await page.click('[data-action=voice-once]');
    await feldIst(page, '#capture-input', 'Offerte Fenster einholen');
    expect(await page.evaluate(() => window.__srStarted)).toMatchObject({ local: false, activation: true });
    await page.click('form[data-form=capture] button[type=submit]');
    await page.click('#main .mic');
    await page.locator('[data-action=voice-once]').waitFor();
    await page.click('[data-action=voice-cancel]');
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('Sprachpaket laden über den Schnellknopf, dann offline erkannt', async ({ page }) => {
    await gehe(page, '');
    await szenario(page, 'downloadable', 'Geschenk für Anna');
    await page.click('.fab-mic');
    await page.click('[data-action=voice-install-go]');
    await feldIst(page, '#quick-input', 'Geschenk für Anna');
    expect(await page.evaluate(() => window.__srStarted.local)).toBe(true);
  });

  test('Einstellungen: Status, „Online immer erlauben“ bleibt gespeichert und fragt nicht mehr', async ({ page }) => {
    await gehe(page, '#settings');
    if (await page.locator('[data-action=voice-check]').count()) await page.click('[data-action=voice-check]');
    await expect(page.locator('#voice-state')).not.toContainText('geprüft');
    expect((await page.locator('#voice-state').innerText()).length).toBeGreaterThan(5);
    await page.check('#voice-cloud');
    await page.evaluate(() => window.kopfFrei.whenSaved());
    await page.reload(); await page.click('[data-view=settings]');
    await expect(page.locator('#voice-cloud')).toBeChecked();
    await szenario(page, 'unavailable', 'Ohne Nachfrage');
    await page.click('[data-view=inbox]'); await page.click('#main .mic');
    await feldIst(page, '#capture-input', 'Ohne Nachfrage');
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('Absturzschutz: nach einem Absturz bei der Abfrage wird nicht mehr gefragt', async ({ page }) => {
    await page.addInitScript(() => { window.__called = false; window.SpeechRecognition.available = async () => { window.__called = true; return 'available'; }; localStorage.setItem('kopf-frei-voice-probe', 'pending'); });
    await gehe(page, '');
    await page.click('#main .mic'); await page.locator('[data-action=voice-once]').waitFor();
    expect(await page.evaluate(() => window.__called)).toBe(false);
  });
});

test.describe('Eingeschaltet auf dem Handy: Ausfälle', () => {
  test.use(HANDY);

  test('Browser ohne Spracherkennung: Hinweis auf die Bildschirmtastatur', async ({ page }) => {
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.addInitScript(EIN);
    await gehe(page, '');
    await page.click('#main .mic');
    await expect(page.locator('.toast.error.show')).toContainText('Bildschirmtastatur');
  });

  test('offline still → online angeboten; gemerkt; Abbruch → Tastatur; Diagnose in den Einstellungen', async ({ page }) => {
    await page.addInitScript(ERKENNUNG_B); await page.addInitScript(EIN);
    await gehe(page, '');
    await page.click('#main .mic');
    await page.click('[data-action=voice-local]');
    await page.locator('[data-action=voice-once]').waitFor();
    await expect(page.locator('.toast.error.show'), 'keine Fehlermeldung, direkt Angebot online').toHaveCount(0);
    await page.evaluate(() => { window.__mode = 'ok'; window.__srStarted = null; });
    await page.click('[data-action=voice-once]');
    await feldIst(page, '#capture-input', 'Hallo Welt');
    expect(await page.evaluate(() => window.__srStarted.local)).toBe(false);

    await page.reload(); await page.locator('#capture-input').waitFor();
    await page.click('#main .mic');
    await page.locator('[data-action=voice-once]').waitFor();
    await expect(page.locator('[data-action=voice-local]'), 'Offline-Problem bleibt gemerkt').toHaveCount(0);
    await page.click('[data-action=voice-cancel]');

    await page.fill('#capture-input', '');
    await page.evaluate(() => { window.__mode = 'aborted'; });
    await page.click('#main .mic');
    await page.click('[data-action=voice-once]');
    await expect(page.locator('#toast')).toContainText('Tastatur');
    await expect(page.locator('#toast'), 'mit Code').toContainText('aborted');
    await page.evaluate(() => { window.__starts = 0; });
    await page.locator('#main .mic').tap();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id), 'Mikrofon öffnet direkt die Tastatur').toBe('capture-input');
    expect(await page.evaluate(() => window.__starts)).toBe(0);
    await expect(page.locator('#modal')).toBeHidden();

    await gehe(page, '#settings');
    await expect(page.locator('.facts', { hasText: 'Letztes Problem' })).toContainText('aborted');
    await page.click('#voice-diag summary');
    await page.click('[data-action=voice-test][data-mode=online]');
    await page.waitForFunction(() => /\bend\b/.test(document.getElementById('voice-log').textContent) && document.getElementById('voice-log').textContent.includes('Browser:'));
    const log = await page.locator('#voice-log').innerText();
    expect(log).toContain('start (online'); expect(log).toContain('error: aborted');
    await page.evaluate(() => { window.__mode = 'ok'; });
    await page.click('[data-action=voice-test][data-mode=offline]');
    await feldIst(page, '#voice-test-input', 'Hallo Welt');
    await expect(page.locator('#voice-log')).toContainText('audiostart');
    await expect(page.locator('#voice-diag')).toContainText('öffnet zurzeit die Tastatur');
    await page.click('[data-action=voice-variants]');
    await expect(page.locator('#voice-log')).toContainText('Ergebnis:', { timeout: 15_000 });
    const v = await page.locator('#voice-log').innerText();
    expect(v).toContain('Variante 5: Sprache de'); expect(v).toContain('5 von 5');
    expect(await page.evaluate(() => localStorage.getItem('kopf-frei-voice-online-broken')), 'Erfolg hebt die Tastatur-Umleitung auf').toBeNull();
  });

  test('Online erlaubt: Offline-Ausfall wechselt ohne Rückfrage auf online', async ({ page }) => {
    await page.addInitScript(ERKENNUNG_B); await page.addInitScript(EIN);
    await gehe(page, '#settings');
    await page.check('#voice-cloud');
    await page.evaluate(() => window.kopfFrei.whenSaved());
    await gehe(page, '#inbox');
    await page.click('#main .mic');
    await expect.poll(() => page.evaluate(() => window.__starts ?? 0)).toBeGreaterThan(0);
    await page.evaluate(() => { window.__mode = 'silent'; window.__starts = 0; });
    await page.fill('#capture-input', '');
    await page.click('#main .mic');
    await expect.poll(() => page.evaluate(() => window.__starts), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => window.__srStarted.local)).toBe(false);
  });
});
