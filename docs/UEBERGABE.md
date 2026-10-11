# Übergabe für eine neue Unterhaltung (Stand 11.10.2026)

Zuerst `CLAUDE.md` lesen: Regeln, Ablauf, **erst fragen, dann umsetzen**.

## Stand
- **Live** (`main`): Version **0.9.0**
- **Test** (`test`): Version **0.10.0**, wartet auf „freigeben“ des Nutzers

## Offene Punkte (vom Nutzer noch nicht freigegeben, nicht ohne OK umsetzen)
1. **Falscher Update-Hinweis in der Live-App.** `build.mjs` setzt die Bau-Nummer (`__APP_BUILD__`, `VERSION` in `sw.js`) aus der Uhrzeit. Jeder Push auf `test` baut die ganze Website neu, also auch Live, und die Live-App meldet dann ein Update ohne Änderung. Vorschlag: Bau-Nummer aus dem Inhalt berechnen (Hash).
2. **Tests aufräumen.** Es gibt 15 End-to-End-Tests, teils doppelt oder veraltet (z. B. Sprachtests, obwohl die Spracheingabe aus ist). Dem Nutzer vorher eine Liste zeigen, was wegfällt und was bleibt.
3. **Fahne auf dem iPad.** In 0.9 korrigiert, weil das unsichtbare Datumsfeld hinter der Fahne `appearance: none` hatte. Der Nutzer hat noch nicht bestätigt, dass es auf dem echten iPad geht.
4. **Spracheingabe pausiert.** Der Code bleibt. Einschalten nur über localStorage `kopf-frei-voice-enabled = 1` (für Tests). Ursprüngliches Problem: Android 10, Chrome, installierte App, `error: aborted` nach etwa 8 ms ohne `audiostart`.

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

## Neue optionale Datenfelder (seit 0.8)
- `Item.order`: eigene Position im Projekt; `null` bedeutet „nach Frist sortieren“.
- `Project.sequential`: seit 0.10 ohne Wirkung.

## Praktische Hinweise für die Arbeit hier
- **Tests lokal:**
  ```
  PLAYWRIGHT_MODULE=/home/claude/.npm-global/lib/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers tests/run.sh [Nummern]
  ```
  WebKit läuft nur auf GitHub (`E2E_WEBKIT=1`).
- **Die veröffentlichte Seite prüfen:** github.io ist aus der Sandbox nicht per curl erreichbar. Mit WebFetch geht es, mit angehängtem `?x=…`, damit kein Cache greift.
- **CI-Lauf abwarten:** über die Run-ID des eigenen Commits (`headSha`). Die Logs sind nicht lesbar, nur die Anmerkungen (annotations).
- **Server beenden:** nicht mit `pkill -f "http.server …"`. Das Muster trifft die eigene Shell.
- **Simuliertes GitHub in den Tests:** braucht eindeutige SHA-1 pro Datei. Früher führte ein Präfix des Pfads dazu, dass Pakete verwechselt wurden.
- **Laufzeit:** Der volle Testlauf dauert lokal etwa 2 Minuten, auf GitHub etwa 3½ Minuten (mit WebKit und Knopf-Test).
