// Löschen: Wischen legt in den Papierkorb (3 Sekunden Rückgängig), Papierkorb leeren, Projekt löschen.
// Entscheidungen: kein Wischen im Papierkorb und bei Projekten; endgültig erst mit „Papierkorb leeren“;
// Projekt nur über den Knopf in der Projektansicht, mit Bestätigung, Aufgaben endgültig mit.
import { test, expect, HANDY, IPAD } from './fixtures.mjs';
import { gehe, karte, wischen, fingerZiehen, mitte } from './hilfen.mjs';

test.describe('Wischen auf dem Handy', () => {
  test.use(HANDY);

  test('kurz, senkrecht oder weit: nur weit nach links legt „Löschen“ frei', async ({ page }) => {
    await gehe(page, 'test/#inbox');
    const erste = page.locator('#main li.row').first();
    await wischen(erste, -30);
    await expect(page.locator('#main li.row.swipe-open')).toHaveCount(0);
    await expect(page.locator('#modal'), 'Wischen öffnet nicht den Bearbeiten-Dialog').toBeHidden();
    await wischen(erste, -15, 80);
    await expect(page.locator('#main li.row.swipe-open'), 'senkrecht = Scrollen').toHaveCount(0);
    await wischen(erste, -140);
    await expect(erste).toHaveClass(/swipe-open/);
    await expect(erste.locator('.swipe-del')).toBeVisible();
    await expect(page.locator('#modal')).toBeHidden();
    await page.locator('h1').tap();
    await expect(page.locator('#main li.row.swipe-open'), 'Tippen daneben schliesst').toHaveCount(0);
  });

  test('schneller Tipp direkt nach dem Wischen (unter 350 ms) wird ausgeführt', async ({ page }) => {
    await gehe(page, 'test/#inbox');
    const zeile = page.locator('#main li.row').nth(1);
    const titel = (await zeile.locator('.row-title').innerText()).trim();
    await wischen(zeile);
    await zeile.locator('.swipe-del').evaluate((b) => { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 9 })); b.click(); });
    await expect(karte(page, titel)).toHaveCount(0);
  });

  test('Löschen: Rückgängig, nach 3 Sekunden endgültig im Papierkorb', async ({ page }) => {
    await page.clock.install();
    await gehe(page, 'test/#inbox');
    const anzahl = await page.locator('#main li.row').count();
    const titel = (await page.locator('#main li.row .row-title').first().innerText()).trim();
    const zeile = karte(page, titel);

    await wischen(zeile); await zeile.locator('.swipe-del').tap();
    await expect(zeile).toHaveCount(0);
    await expect(page.locator('#undo')).toHaveClass(/show/);
    await expect(page.locator('#undo')).toContainText('Gelöscht');
    await page.locator('[data-action=undo]').tap();
    await expect(zeile, 'Rückgängig holt die Aufgabe zurück').toHaveCount(1);

    await wischen(zeile); await zeile.locator('.swipe-del').tap();
    await page.clock.fastForward(3500);
    await expect(page.locator('#undo'), 'Leiste nach 3 Sekunden weg').not.toHaveClass(/show/);
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(zeile, 'bleibt gelöscht nach Neuladen').toHaveCount(0);
    await expect(page.locator('#main li.row'), 'andere Einträge unberührt').toHaveCount(anzahl - 1);

    await gehe(page, 'test/#done');
    const imKorb = karte(page, titel);
    await expect(imKorb, 'liegt im Papierkorb').toHaveCount(1);
    await expect(imKorb.locator('.swipe-del'), 'im Papierkorb kein Wischen').toHaveCount(0);
    await wischen(imKorb);
    await expect(page.locator('#main li.row.swipe-open')).toHaveCount(0);
  });

  test('Projekte lassen sich nicht wegwischen', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await expect(page.locator('#main li.row .swipe-del')).toHaveCount(0);
    const anzahl = await page.locator('#main li.row').count();
    await wischen(page.locator('#main li.row').first());
    await expect(page.locator('#main li.row.swipe-open')).toHaveCount(0);
    await expect(page.locator('#main li.row')).toHaveCount(anzahl);
  });
});

test.describe('Papierkorb auf dem iPad', () => {
  test.use(IPAD);

  // Echte Finger-Ereignisse über das Chrome-Protokoll
  // Danach eine kurze menschliche Pause wie im alten Test 15: Die App ignoriert einen echten Fingertipp
  // unmittelbar nach dem Loslassen (Schutz vor dem „Geister-Klick“ des Browsers).
  const wischenFinger = async (page, titel) => {
    const [x, y] = await mitte(karte(page, titel).locator('.row-title'));
    await fingerZiehen(page, x, y, -150, 0);
    await page.waitForTimeout(350);
  };

  test('hineinlegen, Rückgängig, zurückholen, leeren', async ({ page }) => {
    await page.clock.install();
    await gehe(page, 'test/#next');
    await karte(page, 'Altglas').locator('.row-title').tap(); await page.locator('#e-title').waitFor();
    await page.locator('[data-action=trash]').tap();
    await expect(karte(page, 'Altglas')).toHaveCount(0);
    await page.locator('[data-action=undo]').tap();
    await expect(karte(page, 'Altglas')).toHaveCount(1);

    await wischenFinger(page, 'Altglas');
    await expect(karte(page, 'Altglas')).toHaveClass(/swipe-open/);
    await page.locator('#main li.row.swipe-open .swipe-del').tap();
    await expect(karte(page, 'Altglas')).toHaveCount(0);
    await page.clock.fastForward(3500);
    await gehe(page, 'test/#done');
    await expect(karte(page, 'Altglas'), 'liegt im Papierkorb').toHaveCount(1);
    await karte(page, 'Altglas').locator('[data-action=restore]').tap();
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Altglas'), 'zurückgeholt in Nächste Schritte').toHaveCount(1);

    await wischenFinger(page, 'Altglas');
    await expect(karte(page, 'Altglas')).toHaveClass(/swipe-open/);
    await page.locator('#main li.row.swipe-open .swipe-del').tap();
    await expect(karte(page, 'Altglas')).toHaveCount(0);
    await page.clock.fastForward(3500);
    await gehe(page, 'test/#done');
    await page.locator('[data-action=empty-trash]').tap();
    await expect(page.locator('#modal'), 'Leeren fragt nach').toContainText('endgültig');
    await page.locator('#modal [data-action=confirm]').tap();
    await expect(karte(page, 'Altglas')).toHaveCount(0);
    await page.reload(); await page.locator('#main h1').waitFor();
    await expect(karte(page, 'Altglas'), 'bleibt weg nach Neuladen').toHaveCount(0);
  });

  test('Projekt löschen: nur in der Projektansicht, mit Bestätigung, Aufgaben endgültig mit', async ({ page }) => {
    await gehe(page, 'test/#projects');
    await expect(page.locator('#main li.row .swipe-del'), 'Projektliste: kein Wischen').toHaveCount(0);
    await page.locator('#main .row-title', { hasText: 'Ferien Tessin' }).tap();
    await page.locator('[data-action=delete-project]').tap();
    await expect(page.locator('#modal')).toContainText('endgültig');
    await page.locator('#modal [data-action=close].btn').tap();
    await expect(page.locator('#main h1'), 'Abbrechen lässt das Projekt bestehen').toContainText('Ferien');
    await page.locator('[data-action=delete-project]').tap();
    await page.locator('#modal [data-action=confirm]').tap();
    await gehe(page, 'test/#projects');
    await expect(page.locator('#main .row-title', { hasText: 'Ferien Tessin' })).toHaveCount(0);
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Hotel in Ascona')).toHaveCount(0);
    await expect(karte(page, 'Zugverbindung')).toHaveCount(0);
    await gehe(page, 'test/#done');
    await expect(karte(page, 'Hotel in Ascona'), 'nicht im Papierkorb (endgültig)').toHaveCount(0);
  });
});

test.describe('Nach 30 Tagen im Papierkorb (0.14, berechnet)', () => {
  test.use(HANDY);
  test('Erledigtes über 30 Tage: im Papierkorb, nicht unter Erledigt; Zurückholen; Projekt nach 31 Tagen', async ({ page }) => {
    await gehe(page, 'test/#done');
    const pneu = page.locator('#main li.row', { hasText: 'Sommerpneus' });
    await expect(page.locator('#main h2.section', { hasText: 'Papierkorb' })).toBeVisible();
    await expect(pneu.locator('[data-action=restore]'), 'im Papierkorb mit Zurückholen').toHaveCount(1);
    await pneu.locator('[data-action=restore]').tap();
    await gehe(page, 'test/#next');
    await expect(karte(page, 'Sommerpneus')).toHaveCount(1);

    // Projekt abschliessen, 31 Tage später liegt es im Papierkorb
    await page.clock.install();
    await gehe(page, 'test/#projects');
    await page.locator('#main .row-title', { hasText: 'Wohnzimmer' }).tap();
    await page.locator('[data-action=close-project]').tap();
    await page.locator('#modal [data-action=close-project-go][data-with="1"]').tap();
    await page.clock.setSystemTime(new Date(Date.now() + 31 * 24 * 3600 * 1000));
    await gehe(page, 'test/#done');
    await expect(page.locator('#main h2.section', { hasText: 'Abgeschlossene Projekte' }), 'nicht mehr unter Erledigt').toHaveCount(0);
    await expect(page.locator('#main .row-title.proj-title', { hasText: 'Wohnzimmer' }), 'als Projekt im Papierkorb').toHaveCount(1);
    await page.locator('[data-action=empty-trash]').tap();
    await expect(page.locator('#modal')).toContainText('samt ihren Aufgaben');
    await page.locator('#modal [data-action=confirm]').tap();
    await expect(page.locator('#main .row-title', { hasText: 'Wohnzimmer' })).toHaveCount(0);
  });
});
