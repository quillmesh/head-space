// Erfassen und Klären (GTD-Kern): Inbox füllen, jeden Klär-Weg einmal, einzelne Einträge klären,
// Fristen beim Klären setzen, Fristen-Ansicht. Startet in der leeren Live-App (eigene Datenbank pro Test).
import { test, expect, COMPUTER, IPAD } from './fixtures.mjs';
import { gehe, karte, iso } from './hilfen.mjs';

const erfassen = async (page, titel) => { for (const t of titel) { await page.fill('#capture-input', t); await page.keyboard.press('Enter'); } };
/** Klär-Dialog: „Ja, mehrere Schritte?“ … bis „Nächster Schritt“ */
const zuNaechstemSchritt = async (page) => { for (const s of ['multi', 'twomin', 'who', 'next']) await page.click(`[data-step=${s}]`); };

test.describe('Am Computer', () => {
  test.use(COMPUTER);

  test('Inbox erfassen und jeden Klär-Weg einmal gehen', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Zahnarzt anrufen', 'Ferien Tessin planen', 'Offerte Fenster', 'Altes Kabel', 'Wlan-Passwort Ferienhaus', 'Segelkurs machen', 'Mail an Lisa beantworten']);
    await expect(page.locator('#main .row')).toHaveCount(7);
    await expect(page.locator('#capture-input'), 'Eingabefeld nach Erfassen leer').toHaveValue('');

    await page.click('[data-action=clarify-first]');
    // 1 nächster Schritt mit Kontext
    await zuNaechstemSchritt(page);
    await page.selectOption('#n-ctx', '@Telefon'); await page.click('form[data-form=clarify-next] button[type=submit]');
    // 2 Projekt
    await page.click('[data-step=multi]'); await page.click('[data-step=project]');
    await page.fill('#p-outcome', 'Hotel und Zug gebucht'); await page.fill('#p-next', 'Hotels in Ascona vergleichen'); await page.selectOption('#p-ctx', '@Computer');
    await page.click('form[data-form=clarify-project] button[type=submit]');
    // 3 delegieren mit Nachfassen heute
    for (const s of ['multi', 'twomin', 'who', 'delegate']) await page.click(`[data-step=${s}]`);
    await page.fill('#d-who', 'Schreinerei Meier'); await page.fill('#d-date', iso(0));
    await page.click('form[data-form=clarify-delegate] button[type=submit]');
    // 4 wegwerfen, 5 Referenz, 6 irgendwann mit Wiedervorlage
    await page.click('[data-step=not]'); await page.click('[data-action=clarify-trash]');
    await page.click('[data-step=not]'); await page.click('[data-action=clarify-reference]');
    await page.click('[data-step=not]'); await page.fill('#someday-date', '2027-03-01'); await page.click('form[data-form=clarify-someday] button[type=submit]');
    // 7 in 2 Minuten erledigt
    for (const s of ['multi', 'twomin', 'donow']) await page.click(`[data-step=${s}]`);
    await page.click('[data-action=clarify-done]');

    await expect(page.locator('#modal'), 'Dialog nach letztem Eintrag zu').toBeHidden();
    await expect(page.locator('h1')).toHaveText('Nächste Schritte');
    await expect(page.locator('#main .row')).toHaveCount(2);
    await page.click('.filter[data-ctx="@Telefon"]');
    await expect(page.locator('#main .row'), 'Kontextfilter').toHaveCount(1);

    await page.click('[data-view=projects]');
    await expect(page.locator('#main .row')).toHaveCount(1);
    await page.click('[data-action=open-project]');
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
    await zuNaechstemSchritt(page);
    await page.fill('#n-due', iso(0)); await page.selectOption('#n-ctx', '@Telefon');
    await page.click('form[data-form=clarify-next] button[type=submit]');
    await page.click('[data-step=multi]'); await page.click('[data-step=project]');
    await page.fill('#p-due', iso(60)); await page.fill('#p-next', 'Masse der Fenster aufnehmen'); await page.selectOption('#p-ctx', '@Zuhause');
    await page.click('form[data-form=clarify-project] button[type=submit]');
    await zuNaechstemSchritt(page);
    await page.selectOption('#n-ctx', '@Telefon'); await page.click('form[data-form=clarify-next] button[type=submit]');

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
    await page.locator('#someday-date').waitFor();
    expect(await fokus(page)).not.toMatch(/:date$/);
    await page.locator('[data-action=clarify-reference]').tap();
    await expect(page.locator('#modal'), 'Dialog zu, nicht der nächste Eintrag').toBeHidden();
    await expect(page.locator('#main .row-title')).toHaveText(['Erster', 'Dritter']);
    await expect(page.locator('#undo')).toContainText('Referenz');

    await klaeren(page, 'Erster').tap();
    for (const s of ['multi', 'twomin', 'who', 'next']) await page.locator(`[data-step=${s}]`).tap();
    await page.locator('#n-due').waitFor();
    expect(await fokus(page)).not.toMatch(/:date$/);
    await page.locator('form[data-form=clarify-next] button[type=submit]').tap();
    await expect(page.locator('#modal')).toBeHidden();
    await expect(page.locator('h1'), 'man bleibt in der Inbox').toHaveText('Inbox');
  });

  test('„Klären starten“ geht alle der Reihe nach durch, mit Zähler', async ({ page }) => {
    await gehe(page, '');
    await erfassen(page, ['Dritter', 'Vierter']);
    await page.locator('[data-action=clarify-first]').tap();
    await expect(page.locator('.sheet-head .eyebrow')).toContainText(/1 von 2/i);
    await page.locator('[data-step=not]').tap(); await page.locator('[data-action=clarify-reference]').tap();
    await expect(page.locator('.sheet-head .eyebrow'), 'danach automatisch der nächste').toContainText(/1 von 1/i);
  });
});
