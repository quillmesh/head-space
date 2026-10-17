// Erfassen und Klären (GTD-Kern): Inbox füllen, jeden Klär-Weg einmal, einzelne Einträge klären,
// Fristen beim Klären setzen, Fristen-Ansicht. Startet in der leeren Live-App (eigene Datenbank pro Test).
// Klären seit 0.13 (Vorschlag B): „Ist das umsetzbar?“, dann ein Blatt mit Zielen (Kacheln).
import { test, expect, COMPUTER, IPAD, HANDY } from './fixtures.mjs';
import { gehe, karte, iso } from './hilfen.mjs';

const erfassen = async (page, titel) => { for (const t of titel) { await page.fill('#capture-input', t); await page.keyboard.press('Enter'); } };
/** Klär-Dialog: „Umsetzbar? Ja“ und ein Ziel wählen (done, next, deleg, proj) */
const ziel = async (page, z) => { await page.click('[data-step=yes]'); await page.click(`[data-action=clarify-goal][data-val=${z}]`); };
/** „Umsetzbar? Nein“ und ein Ziel wählen (trash, ref, some) */
const nichtUmsetzbar = async (page, z) => { await page.click('[data-step=not]'); await page.click(`[data-action=clarify-not][data-val=${z}]`); };
const ablegen = (page, form) => page.click(`form[data-form=${form}] button[type=submit]`);

test.describe('Am Computer', () => {
  test.use(COMPUTER);

  test('Inbox erfassen und jeden Klär-Weg einmal gehen', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Zahnarzt anrufen', 'Ferien Tessin planen', 'Offerte Fenster', 'Altes Kabel', 'Wlan-Passwort Ferienhaus', 'Segelkurs machen', 'Mail an Lisa beantworten']);
    await expect(page.locator('#main .row')).toHaveCount(7);
    await expect(page.locator('#capture-input'), 'Eingabefeld nach Erfassen leer').toHaveValue('');

    await page.click('[data-action=clarify-first]');
    // 1 nächster Schritt mit Kontext (Symbol antippen)
    await ziel(page, 'next');
    await page.click('.ctx-chip[data-ctx="@Telefon"]');
    await expect(page.locator('.ctx-chip-name')).toHaveText('Telefon');
    await ablegen(page, 'clarify-yes');
    // 2 Projekt: Name = Notiz, erster Schritt wird zur Aufgabe
    await ziel(page, 'proj');
    await page.fill('#p-outcome', 'Hotel und Zug gebucht'); await page.fill('#p-next', 'Hotels in Ascona vergleichen');
    await ablegen(page, 'clarify-yes');
    // 3 delegieren mit Nachfassen heute
    await ziel(page, 'deleg');
    await page.fill('#d-who', 'Schreinerei Meier'); await page.fill('#d-date', iso(0));
    await ablegen(page, 'clarify-yes');
    // 4 wegwerfen, 5 Referenz, 6 irgendwann mit Wiedervorlage (ein Blatt, Ziel wählen, ablegen)
    await nichtUmsetzbar(page, 'trash'); await ablegen(page, 'clarify-not');
    await nichtUmsetzbar(page, 'ref'); await ablegen(page, 'clarify-not');
    await nichtUmsetzbar(page, 'some'); await page.fill('#someday-date', '2027-03-01'); await ablegen(page, 'clarify-not');
    // 7 in 2 Minuten erledigt
    await ziel(page, 'done'); await ablegen(page, 'clarify-yes');

    await expect(page.locator('#modal'), 'Dialog nach letztem Eintrag zu').toBeHidden();
    await expect(page.locator('h1')).toHaveText('Nächste Schritte');
    await expect(page.locator('#main .row')).toHaveCount(2);
    await page.click('.filter[data-ctx="@Telefon"]');
    await expect(page.locator('#main .row'), 'Kontextfilter').toHaveCount(1);

    await page.click('[data-view=projects]');
    await expect(page.locator('#main .row')).toHaveCount(1);
    await expect(page.locator('#main .row-title.proj-title'), 'Projektname = Notiz').toHaveText('Ferien Tessin planen');
    await page.click('[data-action=open-project]');
    await expect(karte(page, 'Hotels in Ascona vergleichen'), 'erster Schritt').toHaveCount(1);
    await page.fill('#step-input', 'Zug reservieren'); await page.keyboard.press('Enter');
    await expect(page.locator('#main .row')).toHaveCount(2);
    for (let n = 2; n > 0; n--) { await page.locator('#main .check').first().click(); await expect(page.locator('#main .check:not(.is-done)')).toHaveCount(n - 1); }
    await expect(page.locator('form[data-form=next-step]'), 'letzter Schritt erledigt: Dialog für den nächsten').toBeVisible();
    await page.click('[data-action=next-step-later]');
    await expect(page.locator('.callout.warn'), 'Warnung: Projekt ohne nächsten Schritt').toBeVisible();

    await page.click('[data-view=waiting]');
    await expect(page.locator('.slot-rem .due.rem.due-today, .slot-rem .due.rem.due-overdue'), 'Nachfassen fällig: rot').toHaveCount(1);
    await page.click('[data-view=tickler]');
    await expect(page.locator('#main .row'), 'Wiedervorlage: Segelkurs').toHaveCount(1);
    await page.click('[data-view=reference]');
    await expect(page.locator('#main .row')).toHaveCount(1);
    await page.click('[data-view=done]');
    await expect(page.locator('#main .rows').first().locator('.row'), 'Erledigt: 3').toHaveCount(3);
    await expect(page.getByText('Papierkorb').first()).toBeVisible();

    // Bearbeiten, Neuladen, Schnellerfassung mit Taste N
    await page.click('[data-view=reference]');
    await page.click('#main .row-main');
    await page.fill('#e-notes', 'Netz: Casa-Ticino, Passwort im Passwortmanager');
    await page.click('form[data-form=edit] button[type=submit]');
    await expect(page.locator('.row-notes')).toContainText('Casa-Ticino');
    await page.reload(); await page.click('[data-view=reference]');
    await expect(page.locator('.row-notes'), 'nach Neuladen noch da').toHaveCount(1);
    await page.keyboard.press('n');
    await page.fill('#quick-input', 'Milch kaufen'); await page.keyboard.press('Enter');
    await page.click('[data-view=inbox]');
    await expect(page.locator('#main .row'), 'Schnellerfassung landet in der Inbox').toHaveCount(1);
  });

  test('Fristen beim Klären, Fristen-Ansicht und Warnzahl im Menü', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Zahnarzt anrufen', 'Fenster ersetzen', 'Mama anrufen']);
    await page.click('[data-action=clarify-first]');
    await ziel(page, 'next');
    await page.fill('#n-due', iso(0)); await page.click('.ctx-chip[data-ctx="@Telefon"]');
    await ablegen(page, 'clarify-yes');
    await ziel(page, 'proj');
    await page.fill('#p-next', 'Masse der Fenster aufnehmen');
    await ablegen(page, 'clarify-yes');
    // Projektfrist danach in der Projektansicht (das Klär-Blatt fragt sie nicht mehr ab)
    await ziel(page, 'next');
    await page.click('.ctx-chip[data-ctx="@Telefon"]'); await ablegen(page, 'clarify-yes');
    await page.click('[data-view=projects]'); await page.click('[data-action=open-project]'); await page.click('[data-action=edit-project]');
    await page.fill('#pf-due', iso(60)); await page.click('form[data-form=project] button[type=submit]');

    await page.click('[data-view=next]');
    await expect(page.locator('#main .rows').first().locator('.row-title').first(), 'fällige Aufgabe zuoberst').toHaveText('Zahnarzt anrufen');
    await expect(page.locator('.due.due-today')).toHaveCount(1);
    await expect(page.locator('.nav-item[data-view=due] .badge.warn'), 'rote Zahl im Menü').toHaveText('1');
    await page.click('[data-view=due]');
    await expect(page.locator('h2.section').filter({ hasText: /^Heute/ })).toHaveCount(1);
    await expect(page.locator('.row-icon'), 'Fristen: keine Projekte').toHaveCount(0);
    await page.locator('#main .row-main', { hasText: 'Zahnarzt' }).click();
    await page.fill('#e-due', iso(-10)); await page.click('form[data-form=edit] button[type=submit]');
    await expect(page.locator('.due.due-overdue')).toHaveCount(1);
    await expect(page.locator('h2.section').filter({ hasText: /^Überfällig/ })).toHaveCount(1);

    await page.click('[data-view=projects]');
    await expect(page.locator('#main .due-later, #main .due-week, #main .due-soon'), 'Projektliste zeigt Frist').toHaveCount(1);
    await page.click('[data-action=open-project]'); await page.click('[data-action=edit-project]');
    await expect(page.locator('#pf-due')).toHaveValue(iso(60));
    await page.fill('#pf-due', ''); await page.click('form[data-form=project] button[type=submit]');
    await expect(page.locator('.head-meta'), 'Projekt-Frist entfernt').toHaveCount(0);
  });
});

test.describe('Einzeln klären auf dem iPad', () => {
  test.use(IPAD);
  const fokus = (page) => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}:${a.getAttribute('type') ?? ''}` : ''; });
  const klaeren = (page, t) => karte(page, t).locator('[data-action=clarify]');

  test('„Klären“ bei einem Eintrag: nur dieser, kein Datumsfeld fokussiert (sonst öffnet das iPad den Kalender)', async ({ page }) => {
    await page.clock.install();
    await gehe(page, '');
    await erfassen(page, ['Erster', 'Zweiter', 'Dritter']);
    await klaeren(page, 'Zweiter').tap();
    await expect(page.locator('#clarify-title')).toHaveValue('Zweiter');
    await expect(page.locator('.sheet-head .eyebrow'), 'kein „x von y“').not.toContainText(/von/i);
    await expect(page.locator('[data-action=clarify-skip]'), 'kein „Überspringen“').toHaveCount(0);
    await page.locator('[data-step=not]').tap();
    await page.locator('[data-action=clarify-not][data-val=some]').tap();
    await page.locator('#someday-date').waitFor();
    expect(await fokus(page)).not.toMatch(/:date$/);
    await page.locator('[data-action=clarify-not][data-val=ref]').tap();
    await page.locator('form[data-form=clarify-not] button[type=submit]').tap();
    await expect(page.locator('#modal'), 'Dialog zu, nicht der nächste Eintrag').toBeHidden();
    await expect(page.locator('#main .row-title')).toHaveText(['Erster', 'Dritter']);
    await expect(page.locator('#undo')).toContainText('Referenz');

    await klaeren(page, 'Erster').tap();
    await page.locator('[data-step=yes]').tap();
    await page.locator('[data-action=clarify-goal][data-val=next]').tap();
    await page.locator('#n-due').waitFor();
    expect(await fokus(page)).not.toMatch(/:date$/);
    await page.locator('form[data-form=clarify-yes] button[type=submit]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await expect(page.locator('h1'), 'man bleibt in der Inbox').toHaveText('Inbox');
  });

  test('„Klären starten“ geht alle der Reihe nach durch, mit Zähler', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Dritter', 'Vierter']);
    await page.locator('[data-action=clarify-first]').tap();
    await expect(page.locator('.sheet-head .eyebrow')).toContainText(/1 von 2/i);
    await page.locator('[data-step=not]').tap(); await page.locator('[data-action=clarify-not][data-val=ref]').tap();
    await page.locator('form[data-form=clarify-not] button[type=submit]').tap();
    await expect(page.locator('.sheet-head .eyebrow'), 'danach automatisch der nächste').toContainText(/1 von 1/i);
  });
});

test.describe('Inbox auf dem Handy (0.13)', () => {
  test.use(HANDY);

  test('nur „Geklärt“ und „Klären“, kein Datum; Geklärt: schon erledigt oder löschen, mit Rückgängig', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Paket abgeholt', 'Alte Idee']);
    await expect(page.locator('#main .row .due, #main .row .due-input'), 'keine Fahne in der Inbox').toHaveCount(0);
    const knoepfe = karte(page, 'Paket abgeholt').locator('.inbox-btns button');
    await expect(knoepfe, 'Geklärt links von Klären').toHaveText(['Geklärt', 'Klären']);

    await karte(page, 'Paket abgeholt').locator('[data-action=quick-done]').tap();
    await page.locator('#modal [data-action=quick-go][data-to=done]').tap();
    await expect(page.locator('#undo')).toContainText('Erledigt');
    await expect(karte(page, 'Paket abgeholt')).toHaveCount(0);

    await karte(page, 'Alte Idee').locator('[data-action=quick-done]').tap();
    await page.locator('#modal [data-action=quick-go][data-to=trash]').tap();
    await expect(page.locator('#undo')).toContainText('Gelöscht');
    await page.locator('[data-action=undo]').tap();
    await expect(karte(page, 'Alte Idee'), 'Rückgängig holt sie zurück in die Inbox').toHaveCount(1);
    await karte(page, 'Alte Idee').locator('[data-action=quick-done]').tap();
    await page.locator('#modal [data-action=quick-go][data-to=trash]').tap();
    await expect(karte(page, 'Alte Idee')).toHaveCount(0);

    await gehe(page, '#done');
    await expect(page.locator('#main .rows').first().locator('.row-title')).toHaveText(['Paket abgeholt']);
    await expect(page.locator('#main h2.section', { hasText: 'Papierkorb' })).toContainText('1');
  });

  test('Klären: nach „Ja“ ein Blatt mit vier Zielen, die Kachel zeigt nur ihre Felder', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Zahnarzt anrufen']);
    await karte(page, 'Zahnarzt').locator('[data-action=clarify]').tap();
    await page.locator('[data-step=yes]').tap();
    await expect(page.locator('#modal .tile')).toHaveText([/Erledigt/, /Nächster Schritt/, /Delegieren/, /Projekt/]);
    await expect(page.locator('form[data-form=clarify-yes] button[type=submit]'), 'erst nach der Wahl').toBeDisabled();
    await page.locator('[data-action=clarify-goal][data-val=deleg]').tap();
    await expect(page.locator('#d-who')).toBeVisible();
    await expect(page.locator('.ctx-chip'), 'Delegieren ohne Kontext').toHaveCount(0);
    await page.locator('[data-action=clarify-goal][data-val=next]').tap();
    await expect(page.locator('#d-who')).toHaveCount(0);
    await page.locator('.ctx-chip[data-ctx="@Telefon"]').tap();
    await expect(page.locator('.ctx-chip[data-ctx="@Telefon"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.ctx-chip[data-ctx="@Telefon"]').tap();
    await expect(page.locator('.ctx-chip-name'), 'nochmals tippen hebt auf').toHaveText('Ohne Kontext');
    await page.locator('.ctx-chip[data-ctx="@Telefon"]').tap();
    await page.locator('form[data-form=clarify-yes] button[type=submit]').tap();
    await gehe(page, '#next');
    await expect(karte(page, 'Zahnarzt').locator('svg.ico-telefon')).toHaveCount(1);
  });
});
