# Hinweise für Claude

Persönliche GTD-App „Kopf frei“ des Nutzers (wuscha93). Sprache: Deutsch (Schweiz, „ss“ statt „ß“ in UI-Texten).

Zu Beginn einer neuen Unterhaltung auch `docs/UEBERGABE.md` lesen (Stand, offene Punkte, Entscheidungen).

## Zusammenarbeit (Wunsch des Nutzers, gilt immer)
- **Nichts annehmen und umsetzen, ohne zu fragen.** Ist etwas unklar oder gibt es mehrere sinnvolle Lösungen
  (Gestaltung, Verhalten, Wortwahl, wo etwas gilt), zuerst nachfragen und auf die Antwort warten.
- Bei Gestaltungsfragen zuerst Vorschläge als Screenshots zeigen; umsetzen erst nach ausdrücklichem OK.
- Weicht die Umsetzung in einem Detail von dem ab, was der Nutzer gesehen oder gesagt hat, vorher fragen –
  nicht nachträglich erwähnen.
- **Änderungswünsche:** Sagt der Nutzer, einen Wunsch aufzuschreiben, ihn im Claude-Projekt in
  `claude/Kopf frei – Änderungswünsche.md` eintragen (nicht im Repo): fortlaufende Nummer (nie neu vergeben),
  Datum, Wunsch in seinen Worten, Status (offen / in Arbeit / im Test (x.y.z) / live (x.y.z) / verworfen).
  Nur aufschreiben, **nicht umsetzen**, bis er es ausdrücklich sagt. Status bei jedem Schritt nachführen.

## Vor jeder Änderung
- README-Abschnitt „Regeln für Erweiterungen“ einhalten. Der Nutzer arbeitet mit echten Daten weiter; **jede Änderung muss alte Daten lesen können**.
- Neue Felder: optional + Standardwert in `normalizeItem`/`normalizeProject`. Nie Felder umbenennen, nie Ereignisse ändern.
- `DB_VERSION` nur erhöhen für neue Object Stores (additiv).
- Keine externen Abhängigkeiten zur Laufzeit; CSP in `build.mjs` nicht lockern.

## Tests (Pflicht) – Aufbau und Begründung in `docs/TESTKONZEPT.md`
- Jede Funktion hat **Unit-Tests** (`tests/unit/*.test.ts`, `bun test`, < 2 s) für die Logik und, wo es um Bedienung geht,
  **End-to-End-Tests** (`e2e/<funktion>.spec.mjs`, Playwright Test). Neue Prüfungen in die Datei der Funktion, nicht nach Version.
- Neue oder geänderte Funktion → zuerst Test schreiben, der ohne die Änderung fehlschlägt.
- Bedienung auf dem Handy mit **echten Touch-Ereignissen** testen (`tap()`, Geräte `HANDY`/`IPAD` aus `e2e/fixtures.mjs`).
- **Keine festen Wartezeiten** (`waitForTimeout`): selbst wartende `expect(...)`, für Zeitabläufe `page.clock`
  (Unit: `setSystemTime`/`jest.useFakeTimers`). Ausnahme nur mit Begründung im Kommentar.
- Daten in Tests **relativ zu heute** (`iso(n)`), nie feste Kalenderdaten.
- Darstellung ohne CSS (welches Symbol, welche Farbstufe) in `tests/unit/karten.test.ts`; Farben/Ausrichtung in `e2e/darstellung.spec.mjs`.
- Sync-Regeln: `tests/unit/sync-zufall.test.ts` (Zufallsabläufe auf zwei Geräten). Neue Regel → dort als Prüfung ergänzen.
- Alte Daten: nach jeder freigegebenen Version `node scripts/alte-daten-einfrieren.mjs <commit> <version>` und die Datei einchecken.
- Logik gehört in `src/logic.ts`, `store.ts`, `sync.ts` usw., nicht in `ui.ts`, damit sie ohne Browser testbar ist.
- GitHub Actions führt alle Tests vor dem Veröffentlichen aus; schlägt einer fehl, wird nichts veröffentlicht.
  Bei Fehlern liegen Bericht und Traces als Artifact „playwright-bericht“ am Lauf.

## Umgebungen
- **Live** = Branch `main` → https://wuscha93.github.io/head-space/ (echte Daten, Sync mit `head-space-data`)
- **Test** = Branch `test` → https://wuscha93.github.io/head-space/test/ (eigene Datenbank, Beispieldaten, **kein Sync**)
- Beide liegen auf derselben Domain. Alles, was im Browser gespeichert wird, ist über `src/env.ts` getrennt
  (Datenbankname, localStorage-Schlüssel, Cache-Präfix, Service-Worker-Bereich). Daran nichts ändern, ohne `e2e/umgebungen.spec.mjs` zu erweitern.

## Ablauf
1. Ändern **auf Branch `test`**, dann `tests/run.sh` (Typen + Unit + End-to-End; alle müssen bestehen).
2. Version in `package.json` erhöhen (Patch für Korrekturen, Minor für Funktionen).
3. Commit und `git push origin test` → GitHub testet und veröffentlicht nur die **Test-App**.
4. Nutzer prüft in der Test-App. **Erst wenn er „freigeben“ schreibt:** `test` in `main` übernehmen
   (`git checkout main && git merge --ff-only test && git push origin main`) → Live-App zeigt „Neue Version verfügbar“.
   Geht `--ff-only` nicht (Korrektur direkt auf `main`), zuerst `main` in `test` mergen, dann vorspulen.
5. Nie direkt auf `main` entwickeln (Ausnahme: dringende Korrektur, die der Nutzer ausdrücklich live will).

## Nie
- Nutzerdaten, Tokens oder Passphrasen ins Repo oder in Logs.
- Das Daten-Repo `head-space-data` anfassen (gehört nur der App).
