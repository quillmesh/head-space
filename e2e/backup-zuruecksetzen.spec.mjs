// Verschlüsseltes Backup (Export, Download, Import auf neuem Gerät) und „Zurück auf Stand vom …“.
import { test, expect, COMPUTER, HANDY } from './fixtures.mjs';
import { gehe, karte, wischen, keinQuerScrollen } from './hilfen.mjs';

test.describe('Backup', () => {
  test.use(COMPUTER);

  test('verschlüsselt, als Datei; neues Gerät: falsche Passphrase erkannt, richtige stellt alles her', async ({ page, geraet }, testInfo) => {
    await gehe(page, '');
    for (const t of ['Zahnarzt anrufen', 'Milch kaufen']) { await page.fill('#capture-input', t); await page.keyboard.press('Enter'); }
    await page.click('[data-view=settings]');
    await page.fill('#pass1', 'korrekt-pferd-batterie'); await page.fill('#pass2', 'korrekt-pferd-batterie');
    await page.click('form[data-form=export] button[type=submit]');
    await page.locator('#backup-text').waitFor({ timeout: 15_000 });
    const text = await page.inputValue('#backup-text');
    expect(text).toContain('AES-256-GCM');
    expect(text, 'kein Klartext').not.toContain('Zahnarzt');
    const dl = page.waitForEvent('download');
    await page.click('[data-action=download-backup]');
    const datei = await dl;
    expect(datei.suggestedFilename()).toMatch(/^kopf-frei-backup-/);
    const pfad = testInfo.outputPath('backup.json');
    await datei.saveAs(pfad);

    const neu = await geraet(HANDY, 'neues Gerät');
    await gehe(neu, '#settings');
    await neu.setInputFiles('#import-file', pfad);
    await neu.fill('#import-pass', 'falsch-falsch'); await neu.click('form[data-form=import] button[type=submit]');
    await expect(neu.locator('.toast.error.show')).toContainText('Passphrase falsch', { timeout: 15_000 });
    await neu.setInputFiles('#import-file', pfad);
    await neu.fill('#import-pass', 'korrekt-pferd-batterie'); await neu.click('form[data-form=import] button[type=submit]');
    await expect(neu.locator('#toast')).toContainText('wiederhergestellt', { timeout: 15_000 });
    await neu.locator('.menu-btn').tap();
    await neu.locator('.nav-item[data-view=inbox]').tap();
    await expect(neu.locator('#main .row')).toHaveCount(2);
    expect(await keinQuerScrollen(neu)).toBe(true);
  });
});

test.describe('Zurück auf früheren Stand', () => {
  test.use(HANDY);

  test('Ende gestern wiederherstellen, umkehrbar, Zukunft abgelehnt', async ({ page }) => {
    // Ausgangslage von gestern direkt in die Datenbank (wie nach einem Tag Nutzung)
    await page.goto('icon.svg');
    await page.evaluate(async () => {
      const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(10, 0, 0, 0);
      const t = y.getTime();
      const ev = [
        { id: 'g1', ts: t, device: 'x', type: 'context.add', data: { name: '@Telefon' } },
        { id: 'g2', ts: t + 1, device: 'x', type: 'item.create', data: { id: 'a', title: 'Gestern erfasst', list: 'next', context: '@Telefon' } },
        { id: 'g3', ts: t + 2, device: 'x', type: 'item.create', data: { id: 'b', title: 'Wird heute gelöscht', list: 'next' } },
      ];
      await new Promise((res, rej) => {
        const r = indexedDB.open('kopf-frei', 2);
        r.onupgradeneeded = () => { for (const n of ['events', 'meta', 'synced']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, n === 'events' ? { keyPath: 'id' } : undefined); };
        r.onsuccess = () => { const tx = r.result.transaction(['events', 'meta'], 'readwrite'); ev.forEach((e) => tx.objectStore('events').put(e)); tx.objectStore('meta').put(Date.now(), 'lastBackup'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = rej; };
      });
    });
    await gehe(page, '#next');

    // Heute: umbenennen, wischen-löschen, neu erfassen
    await page.locator('#main .row-title', { hasText: 'Gestern erfasst' }).tap();
    await page.fill('#e-title', 'Heute umbenannt'); await page.locator('form[data-form=edit] button[type=submit]').tap();
    const weg = karte(page, 'Wird heute gelöscht');
    await wischen(weg); await weg.locator('.swipe-del').tap();
    await expect(weg).toHaveCount(0);
    await gehe(page, '#inbox');
    await page.fill('#capture-input', 'Heute neu'); await page.keyboard.press('Enter');

    const titel = async () => {
      const t = [];
      for (const v of ['#next', '#inbox']) { await gehe(page, v); t.push(...await page.locator('#main .row-title').allInnerTexts()); }
      return t.sort();
    };

    await gehe(page, '#settings');
    const punkt = page.locator('#restore-list .restore-point', { hasText: 'Ende' }).first();
    await expect(punkt, 'Punkt „Ende <gestern>“').toHaveCount(1);
    await expect(punkt).toContainText('spätere Änderungen');
    await punkt.tap();
    await expect(page.locator('#modal'), 'Bestätigung erklärt, dass es umkehrbar ist').toContainText('wieder rückgängig');
    await page.locator('[data-action=confirm]').tap();
    await page.locator('#undo.show').waitFor();
    expect(await titel()).toEqual(['Gestern erfasst', 'Wird heute gelöscht']);
    await page.reload(); await page.locator('#main h1').waitFor();
    expect(await titel(), 'bleibt nach Neuladen').toEqual(['Gestern erfasst', 'Wird heute gelöscht']);

    await gehe(page, '#settings');
    const zurueck = page.locator('#restore-list .restore-point', { hasText: 'Vor dem Zurücksetzen' });
    await expect(zurueck).toHaveCount(1);
    await zurueck.tap(); await page.locator('[data-action=confirm]').tap();
    await page.locator('#undo.show').waitFor();
    expect(await titel(), 'Zurücksetzen wieder aufgehoben').toEqual(['Heute neu', 'Heute umbenannt']);

    await gehe(page, '#settings');
    await page.fill('#restore-when', '2099-01-01T10:00');
    await page.locator('form[data-form=restore-custom] button[type=submit]').tap();
    await expect(page.locator('#toast')).toContainText('Vergangenheit');
  });
});
