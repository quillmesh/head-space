# Übergabe für eine neue Unterhaltung (Stand 11.10.2026, abends)

Zuerst `CLAUDE.md` lesen: Regeln, Ablauf, **erst fragen, dann umsetzen**.

## Stand
- **Live** (`main`): Version **0.9.0**
- **Test** (`test`): Version **0.11.0**, wartet auf „freigeben“ des Nutzers (enthält 0.10: Papierkorb, Projekt löschen; 0.11: neues Testkonzept, Spracheingabe entfernt, verwaiste Schritte)

## Offene Punkte (vom Nutzer noch nicht freigegeben, nicht ohne OK umsetzen)
1. **Falscher Update-Hinweis in der Live-App.** `build.mjs` setzt die Bau-Nummer (`__APP_BUILD__`, `VERSION` in `sw.js`) aus der Uhrzeit. Jeder Push auf `test` baut die ganze Website neu, also auch Live, und die Live-App meldet dann ein Update ohne Änderung. Vorschlag: Bau-Nummer aus dem Inhalt berechnen (Hash).
2. **Fahne auf dem iPad.** In 0.9 korrigiert, weil das unsichtbare Datumsfeld hinter der Fahne `appearance: none` hatte. Der Nutzer hat noch nicht bestätigt, dass es auf dem echten iPad geht.
3. **Nach der Freigabe:** echte Daten der freigegebenen Version einfrieren (`node scripts/alte-daten-einfrieren.mjs <commit> 0.11.0`).

## Entscheidungen des Nutzers (gelten)
- **Kontexte:** Strichsymbole (Stil A, 22 px), Anzeige ohne „@“. Gespeichert bleibt „@Computer“.
- **Kontext-Platz:**
  - „Warten auf“ zeigt immer die Sanduhr, auch mit Kontext.
  - Offene Aufgaben ohne Kontext zeigen ein Fragezeichen.
- **Daten in der Karte:**
  - Frist = Fahne, Nachfassen = Glocke, Erst ab = Mond.
  - Alle in gleichen Boxen, 6 px gerundet, ohne Titel darüber.
  - Rot bei überfällig oder heute, orange bei bald.
  - „Erst ab“ ist immer neutral gefärbt.
- **Handy:** kompakte Karten (Variante A).
  - Alles in einer Zeile unter dem Titel.
  - Bei „Warten auf“ steht der Name neben der Sanduhr.
  - „Notiz“ wird als Symbol gezeigt.
  - Die blasse Fahne bleibt.
- **Projekte:**
  - Reihenfolge per Griff ⋮⋮ (Finger, Maus, Pfeiltasten). Die eigene Reihenfolge hat Vorrang vor den Fristen.
  - Oranges Warndreieck beim Schritt mit der früheren Frist, Tippen erklärt den Konflikt.
  - Beim Hinzufügen eines Schritts gleich die Frist wählen (Fahne).
- **„Alle / Nur die nächste“** ist entfernt (0.10). Das Feld `Project.sequential` bleibt gespeichert, hat aber keine Wirkung.
- **Fristen-Liste und rote Zahl im Menü:** nur Aufgaben, keine Projekte.
- **Löschen:**
  - Wischen legt eine Aufgabe in den Papierkorb, mit 3 Sekunden Rückgängig.
  - Im Papierkorb und bei Projekten gibt es kein Wischen.
  - Endgültig gelöscht wird erst mit „Papierkorb leeren“.
- **Projekt löschen:**
  - Nur über den Knopf in der Projektansicht, mit Bestätigung.
  - Alle Aufgaben des Projekts werden endgültig mitgelöscht.
- **Datenkonsistenz zwischen Geräten hat oberste Priorität.**
  - Bearbeiten speichert nur geänderte Felder (`changedFields`).
  - Änderungen an endgültig Gelöschtem werden ignoriert, ausser ausdrücklichem Wiederherstellen (`ignoreOnDeleted` in `store.ts`).
- **Dialoge:** Felder gleich hoch, zwei gleich breite Spalten.
- **Spracheingabe** wird nicht weiterverfolgt: in 0.11 komplett entfernt (Code und Tests). Gespeicherte Altwerte (`voiceCloud` in der Datenbank, `kopf-frei-voice-*` im localStorage) bleiben liegen und werden ignoriert.
- **Verwaister Schritt** (ein Gerät löscht ein Projekt, das andere fügt gleichzeitig einen Schritt hinzu): wird mitgelöscht (Regel beim Abspielen in `store.ts`, `inDeletedProject`).
- **Testkonzept:** Variante B umgesetzt (`docs/TESTKONZEPT.md`); alte Tests gelöscht; Knopf-Test prüft jede Knopfart einmal pro Gerät.

## Neue optionale Datenfelder (seit 0.8)
- `Item.order`: eigene Position im Projekt; `null` bedeutet „nach Frist sortieren“.
- `Project.sequential`: seit 0.10 ohne Wirkung.

## Praktische Hinweise für die Arbeit hier
- **Tests lokal:**
  ```
  PLAYWRIGHT_MODULE=/home/claude/.npm-global/lib/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers tests/run.sh [Dateinamen aus e2e/]
  ```
  WebKit läuft nur auf GitHub (`E2E_WEBKIT=1`). npm ist aus der Sandbox gesperrt; `playwright` (enthält `playwright/test`) ist global vorhanden,
  `tests/run.sh` verlinkt es nach `node_modules/`. Die Sandbox hat nur 2 Kerne.
- **Testkonzept:** `docs/TESTKONZEPT.md` (seit 0.10.1, Playwright Test in `e2e/`, Zufallstests, alte Daten).
- **Die veröffentlichte Seite prüfen:** github.io ist aus der Sandbox nicht per curl erreichbar. Mit WebFetch geht es, mit angehängtem `?x=…`, damit kein Cache greift.
- **CI-Lauf abwarten:** über die Run-ID des eigenen Commits (`headSha`). Die Logs sind nicht lesbar, nur die Anmerkungen (annotations).
- **Server beenden:** nicht mit `pkill -f "http.server …"`. Das Muster trifft die eigene Shell.
- **Simuliertes GitHub in den Tests:** braucht eindeutige SHA-1 pro Datei. Früher führte ein Präfix des Pfads dazu, dass Pakete verwechselt wurden.
- **Laufzeit:** Unit unter 1 s; End-to-End lokal etwa 1½ Minuten.
- **CI-Fehler:** Bericht und Traces als Artifact „playwright-bericht“ (zusätzlich zu den Anmerkungen).
