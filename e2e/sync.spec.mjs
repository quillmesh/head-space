// Sync über ein simuliertes GitHub mit zwei Geräten (Computer und Handy), dazu alte Datenbanken.
// Oberste Priorität: Datenkonsistenz. Nach jedem Abgleich müssen beide Geräte exakt gleich sein.
// (Viele zufällige Abläufe ohne Browser: tests/unit/sync-zufall.test.ts)
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, karte, wischen, simuliertesGitHub, syncEinrichten } from './hilfen.mjs';

// Das simulierte GitHub antwortet absichtlich mit 401/404/409/422; der Browser meldet das in der Konsole.
test.use({ erlaubteKonsolenfehler: /401|404|409|422/ });

/** Daten wie aus Version 0.1–0.3: Datenbank-Version 1, ohne Formatnummer, mit Zusatzfeld und unbekanntem Ereignis */
async function alteDatenbank(page) {
  await page.goto('icon.svg');
  await page.evaluate(async () => {
    const t = Date.now() - 50000;
    const ev = [
      { id: 'e1', ts: t, device: 'alt', type: 'context.add', data: { name: '@Telefon' } },
      { id: 'e2', ts: t + 1, device: 'alt', type: 'project.create', data: { id: 'p1', title: 'Steuererklärung', outcome: '', status: 'active', created: t, updated: t, completed: null } },
      { id: 'e3', ts: t + 2, device: 'alt', type: 'item.create', data: { id: 'i1', title: 'Belege scannen', notes: '', list: 'next', context: '@Telefon', projectId: 'p1', waitingFor: null, tickler: null, created: t, updated: t, completed: null } },
      { id: 'e4', ts: t + 3, device: 'alt', type: 'item.create', data: { id: 'i2', title: 'Alter Eintrag mit Zusatzfeld', list: 'inbox', energie: 'hoch' } },
      { id: 'e5', ts: t + 4, device: 'neu', type: 'zukunft.ereignis', data: { irgendwas: 1 } },
    ];
    await new Promise((res, rej) => {
      const r = indexedDB.open('kopf-frei', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('events', { keyPath: 'id' }); r.result.createObjectStore('meta'); };
      r.onsuccess = () => {
        const tx = r.result.transaction(['events', 'meta'], 'readwrite');
        ev.forEach((e) => tx.objectStore('events').put(e));
        tx.objectStore('meta').put('alt-geraet-0001', 'device');
        tx.objectStore('meta').put(Date.now(), 'lastBackup');
        tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej;
      };
    });
  });
}
const ereignis = (page, id) => page.evaluate((id) => new Promise((res) => { const r = indexedDB.open('kopf-frei'); r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').get(id); q.onsuccess = () => res(q.result); }; }), id);

test.describe('Alte Datenbank', () => {
  test.use({ ...COMPUTER, serviceWorkers: 'block' });

  test('Version 1 wird gelesen und additiv auf Version 2 erweitert', async ({ page }) => {
    await alteDatenbank(page);
    await gehe(page, '#next');
    await expect(karte(page, 'Belege scannen')).toHaveCount(1);
    await expect(karte(page, 'Belege scannen').locator('button.due-none'), 'fehlende Frist = keine Frist').toHaveCount(1);
    await expect(page.locator('.row-eyebrow'), 'Projekt als Überzeile').toContainText(/steuererklärung/i);
    await page.click('[data-view=inbox]');
    await expect(karte(page, 'Zusatzfeld'), 'unvollständiger Eintrag lesbar').toHaveCount(1);
    const db = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('kopf-frei'); r.onsuccess = () => { res({ v: r.result.version, stores: [...r.result.objectStoreNames] }); r.result.close(); }; }));
    expect(db.v).toBe(2);
    expect(db.stores).toEqual(expect.arrayContaining(['events', 'synced']));
  });
});

test.describe('Einrichten und Abgleichen', () => {
  test('Fehler verständlich, zweites Gerät, verschlüsselt, automatisch hochladen, unbekanntes bleibt, trennen', async ({ geraet }) => {
    const gh = simuliertesGitHub();
    const A = await geraet({ viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' }, 'A');
    await gh.anschliessen(A);
    await alteDatenbank(A);

    // Formular: falsches Token, öffentliches Repo, dann richtig
    await gehe(A, '#settings');
    const schritt1 = async (P, token) => {
      await P.fill('#sync-owner', 'adrian'); await P.fill('#sync-repo', 'head-space-data'); await P.fill('#sync-token', token);
      await P.click('form[data-form=sync-probe] button[type=submit]');
    };
    await schritt1(A, 'github_pat_falsch');
    await expect(A.locator('.toast.error.show')).toContainText('ungültig');
    gh.state.isPrivate = false;
    await schritt1(A, 'github_pat_gut');
    await expect(A.locator('#toast'), 'öffentliches Repo abgelehnt').toContainText('öffentlich');
    gh.state.isPrivate = true;
    await schritt1(A, 'github_pat_gut');
    await A.fill('#sync-pass1', 'mein-geheimer-satz-123'); await A.fill('#sync-pass2', 'mein-geheimer-satz-123');
    await A.click('form[data-form=sync-connect] button[type=submit]');
    await A.locator('#sync .sync-idle').waitFor({ timeout: 30_000 });
    expect(gh.files.has('kopf-frei.json')).toBe(true);
    expect([...gh.files.keys()].some((p) => p.startsWith('events/')), 'erstes Paket hochgeladen').toBe(true);
    expect(gh.text(), 'im Repo kein Klartext').not.toMatch(/Belege|Steuer|Zusatzfeld|@Telefon/);
    await expect(A.locator('.nav-foot .sync-pill')).toContainText('Synchronisiert');

    // Gerät B: bestehendes Repo erkannt, falsche Passphrase abgelehnt
    const B = await geraet({ ...HANDY, serviceWorkers: 'block' }, 'B');
    await gh.anschliessen(B);
    await gehe(B, '#settings');
    await schritt1(B, 'github_pat_gut');
    await B.locator('#sync-pass1').waitFor();
    await expect(B.locator('#sync-pass2'), 'nur eine Passphrase').toHaveCount(0);
    await B.fill('#sync-pass1', 'falsche-passphrase');
    await B.click('form[data-form=sync-connect] button[type=submit]');
    await expect(B.locator('#toast')).toContainText('passt nicht', { timeout: 30_000 });
    await B.fill('#sync-pass1', 'mein-geheimer-satz-123');
    await B.click('form[data-form=sync-connect] button[type=submit]');
    await B.locator('#sync .sync-idle').waitFor({ timeout: 30_000 });
    await gehe(B, '#next');
    await expect(karte(B, 'Belege scannen'), 'B hat die Daten von A').toHaveCount(1);

    // B erfasst etwas: wird nach der Wartezeit von selbst hochgeladen (simulierte Uhr statt 5 Sekunden warten)
    await B.clock.install();
    await gehe(B, '#inbox');
    const vorher = gh.files.size;
    await B.fill('#capture-input', 'Von Gerät B erfasst'); await B.keyboard.press('Enter');
    await B.clock.fastForward(5000);
    await expect.poll(() => gh.files.size, 'automatisch hochgeladen').toBe(vorher + 1);

    // A holt
    await A.click('[data-action=sync-now]');
    await A.click('[data-view=inbox]');
    await expect(karte(A, 'Von Gerät B')).toHaveCount(1);

    // Ereignis einer neueren Version und unbekanntes Feld sind über den Sync bei B angekommen
    expect((await ereignis(B, 'e5'))?.type).toBe('zukunft.ereignis');
    expect((await ereignis(B, 'e4'))?.data?.energie).toBe('hoch');

    // Ohne Änderungen kein Upload
    const n = gh.files.size;
    await A.click('[data-view=settings]');
    await A.evaluate(() => window.kopfFrei.sync());
    expect(gh.files.size).toBe(n);

    // Trennen: Anzeige weg, Daten bleiben
    await A.click('[data-action=sync-disconnect]'); await A.click('[data-action=confirm]');
    await A.locator('#sync-owner').waitFor();
    await expect(A.locator('.nav-foot .sync-pill')).toHaveCount(0);
    await A.click('[data-view=inbox]');
    await expect(karte(A, 'Von Gerät B')).toHaveCount(1);
  });
});

test.describe('Löschen über zwei Geräte', () => {
  test('nach jedem Abgleich sind beide Geräte exakt gleich', async ({ geraet }) => {
    test.slow(); // langer Ablauf mit vielen Abgleichen
    const gh = simuliertesGitHub();
    const A = await geraet({ viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' }, 'A');
    const B = await geraet({ ...HANDY, serviceWorkers: 'block' }, 'B');
    for (const p of [A, B]) { await gh.anschliessen(p); await p.clock.install(); }

    // Abgleich: zweimal, damit ein gerade laufender automatischer Abgleich die neueste Änderung nicht verpasst
    const abgleich = async (...ps) => { for (const p of ps) await p.evaluate(async () => { await window.kopfFrei.whenSaved(); await window.kopfFrei.sync(); await window.kopfFrei.sync(); }); };
    const stand = (p) => p.evaluate(() => window.kopfFrei.snapshot());
    const gleich = async (wann) => {
      await abgleich(A, B, A); // A schickt, B holt und schickt, A holt
      expect(await stand(B), `${wann}: beide Geräte gleich`).toBe(await stand(A));
    };
    const loeschenWischen = async (p, titel) => {
      await wischen(karte(p, titel));
      await karte(p, titel).locator('.swipe-del').tap();
      await expect(karte(p, titel)).toHaveCount(0);
    };
    const leeren = async (p) => { await gehe(p, '#done'); await p.click('[data-action=empty-trash]'); await p.click('[data-action=confirm]'); };

    // 1. Daten auf A, beide verbinden
    await gehe(A, '#inbox');
    for (const t of ['Eins', 'Zwei', 'Drei']) { await A.fill('#capture-input', t); await A.keyboard.press('Enter'); }
    await gehe(A, '#projects');
    await A.click('[data-action=new-project]'); await A.fill('#pf-title', 'Umzug'); await A.fill('#pf-next', 'Kisten packen');
    await A.click('form[data-form=project] button[type=submit]');
    await A.locator('#step-input').waitFor();
    await A.fill('#step-input', 'Möbel ausmessen'); await A.keyboard.press('Enter');
    await syncEinrichten(A, { erstes: true });
    await syncEinrichten(B);
    await gleich('Start');
    await gehe(B, '#inbox');
    await expect(karte(B, 'Eins')).toHaveCount(1);

    // 2. B wischt „Eins“ weg, nimmt zurück, wischt nochmals
    await loeschenWischen(B, 'Eins');
    await B.locator('[data-action=undo]').tap();
    await expect(karte(B, 'Eins')).toHaveCount(1);
    await loeschenWischen(B, 'Eins');
    await B.clock.fastForward(3500);
    await gleich('gewischt (Papierkorb)');
    await gehe(A, '#inbox'); await expect(karte(A, 'Eins')).toHaveCount(0);
    await gehe(A, '#done'); await expect(karte(A, 'Eins'), 'A: im Papierkorb').toHaveCount(1);

    // 3. A legt „Zwei“ in den Papierkorb und nimmt es sofort zurück
    await gehe(A, '#inbox');
    await karte(A, 'Zwei').locator('.row-title').click(); await A.locator('#e-title').waitFor();
    await A.click('[data-action=trash]'); await A.click('[data-action=undo]');
    await gleich('Papierkorb + Rückgängig');
    await gehe(B, '#inbox'); await expect(karte(B, 'Zwei')).toHaveCount(1);

    // 4. A leert den Papierkorb
    await leeren(A);
    await gleich('Papierkorb geleert');
    await gehe(B, '#done'); await expect(karte(B, 'Eins'), 'B: endgültig weg').toHaveCount(0);
    const geloescht = await B.evaluate(() => JSON.parse(window.kopfFrei.snapshot()).items.filter((i) => i.deleted));
    expect(geloescht.map((i) => [i.title, i.notes]), 'Inhalt geleert').toEqual([['', '']]);

    // 5. A löscht das Projekt (mit Bestätigung)
    await gehe(A, '#projects'); await A.locator('#main .row-title', { hasText: 'Umzug' }).click();
    await A.click('[data-action=delete-project]');
    await expect(A.locator('#modal'), 'Bestätigung nennt die Anzahl Aufgaben').toContainText('2 Aufgaben');
    await A.click('[data-action=confirm]');
    await gleich('Projekt gelöscht');
    await gehe(B, '#projects'); await expect(karte(B, 'Umzug')).toHaveCount(0);
    await gehe(B, '#next'); await expect(karte(B, 'Kisten')).toHaveCount(0); await expect(karte(B, 'Möbel')).toHaveCount(0);
    await gehe(B, '#done'); await expect(karte(B, 'Kisten'), 'nicht im Papierkorb (endgültig)').toHaveCount(0);

    // 6. Gleichzeitig: A legt „Drei“ in den Papierkorb, B ändert den Titel (ohne Abgleich dazwischen)
    await gehe(A, '#inbox');
    await karte(A, 'Drei').locator('.row-title').click(); await A.locator('#e-title').waitFor();
    await A.click('[data-action=trash]'); await A.clock.fastForward(3500);
    await gehe(B, '#inbox');
    await karte(B, 'Drei').locator('.row-title').tap(); await B.locator('#e-title').waitFor();
    await B.fill('#e-title', 'Drei geändert'); await B.click('form[data-form=edit] button[type=submit]');
    await gleich('gleichzeitig gelöscht und geändert');
    for (const p of [A, B]) {
      await gehe(p, '#inbox'); await expect(karte(p, 'Drei'), 'bleibt im Papierkorb').toHaveCount(0);
      await gehe(p, '#done'); await expect(karte(p, 'Drei geändert'), 'neuer Titel trotzdem übernommen').toHaveCount(1);
    }

    // 7. Gleichzeitig: A leert den Papierkorb, B ändert die Notiz
    await leeren(A);
    await gehe(B, '#done');
    await karte(B, 'Drei geändert').locator('.row-title').tap(); await B.locator('#e-notes').waitFor();
    await B.fill('#e-notes', 'Notiz nach dem Löschen'); await B.click('form[data-form=edit] button[type=submit]');
    await gleich('gleichzeitig endgültig gelöscht und geändert');
    const leer = await A.evaluate(() => JSON.parse(window.kopfFrei.snapshot()).items.filter((i) => i.deleted));
    expect(leer.every((i) => i.title === '' && i.notes === ''), 'Endgültig Gelöschtes bleibt leer').toBe(true);

    // 8. Nach Neuladen unverändert, erneuter Abgleich ändert nichts
    const vorher = await stand(B);
    await B.reload(); await B.locator('#main h1').waitFor();
    expect(await stand(B)).toBe(vorher);
    const n = gh.files.size;
    await abgleich(A, B);
    expect(gh.files.size, 'ohne Änderungen kein Upload').toBe(n);
  });
});

test.describe('Projekt löschen, während das andere Gerät einen Schritt hinzufügt (0.11)', () => {
  test('der verwaiste Schritt wird auf beiden Geräten mitgelöscht', async ({ geraet }) => {
    const gh = simuliertesGitHub();
    const A = await geraet({ viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' }, 'A');
    const B = await geraet({ ...HANDY, serviceWorkers: 'block' }, 'B');
    for (const p of [A, B]) await gh.anschliessen(p);
    const abgleich = async (...ps) => { for (const p of ps) await p.evaluate(async () => { await window.kopfFrei.whenSaved(); await window.kopfFrei.sync(); await window.kopfFrei.sync(); }); };

    await gehe(A, '#projects');
    await A.click('[data-action=new-project]'); await A.fill('#pf-title', 'Umzug'); await A.fill('#pf-next', 'Kisten packen');
    await A.click('form[data-form=project] button[type=submit]');
    await A.locator('#step-input').waitFor();
    await syncEinrichten(A, { erstes: true });
    await syncEinrichten(B);

    // Ohne Abgleich dazwischen: A löscht das Projekt, B fügt einen Schritt hinzu
    await gehe(A, '#projects'); await A.locator('#main .row-title', { hasText: 'Umzug' }).click();
    await A.click('[data-action=delete-project]'); await A.click('[data-action=confirm]');
    await gehe(B, '#projects'); await B.locator('#main .row-title', { hasText: 'Umzug' }).tap();
    await B.fill('#step-input', 'Möbel ausmessen'); await B.keyboard.press('Enter');
    await expect(karte(B, 'Möbel ausmessen')).toHaveCount(1);

    await abgleich(A, B, A);
    expect(await B.evaluate(() => window.kopfFrei.snapshot())).toBe(await A.evaluate(() => window.kopfFrei.snapshot()));
    for (const p of [A, B]) {
      await gehe(p, '#next');
      await expect(karte(p, 'Möbel ausmessen'), 'verwaister Schritt weg').toHaveCount(0);
      await expect(karte(p, 'Kisten packen')).toHaveCount(0);
      await gehe(p, '#done');
      await expect(karte(p, 'Möbel ausmessen'), 'nicht im Papierkorb (endgültig)').toHaveCount(0);
    }
  });
});
