# Übergabe für eine neue Unterhaltung (Stand 18.10.2026)

Zuerst `CLAUDE.md` lesen: Regeln, Ablauf, **erst fragen, dann umsetzen**.

## Stand
- **Live** (`main`) und **Test** (`test`): Version **0.13.0**, freigegeben am 18.10.2026 (Commit `27ccd70`).
  Enthält die Änderungswünsche 1–9 (Liste im Claude-Projekt „Kopf frei – Änderungswünsche“).
- Echte Daten bis 0.13.0 eingefroren; das Einfrier-Skript erzeugt ab 0.13 auch „Geklärt“ und Klären mit Ziel-Kacheln.
- Adresse: Die App wird unter `quillmesh.github.io/head-space/` veröffentlicht. Das iPad des Nutzers hatte am 14.10.
  offenbar eine ältere Adresse offen (zeigte 0.12.0, obwohl 0.12.1 online war). Nutzer klärt das selbst.

## Offene Punkte (vom Nutzer noch nicht freigegeben, nicht ohne OK umsetzen)
1. **Falscher Update-Hinweis in der Live-App.** `build.mjs` setzt die Bau-Nummer (`__APP_BUILD__`, `VERSION` in `sw.js`) aus der Uhrzeit. Jeder Push auf `test` baut die ganze Website neu, also auch Live, und die Live-App meldet dann ein Update ohne Änderung. Vorschlag: Bau-Nummer aus dem Inhalt berechnen (Hash).
2. **Fahne auf dem iPad (0.12.1):** Ursache gefunden: `showPicker()` öffnet auf iOS/iPadOS nichts und meldet keinen Fehler
   (WebKit-Fehler 268114/261703). Lösung (vom Nutzer gewählt): auf iPad/iPhone (`needsDirectDateTap`, Klasse `ios-datum`)
   liegt das durchsichtige Datumsfeld über der Fahne. Noch zu bestätigen auf dem echten iPad. Echte iPad-Simulator-Tests
   auf GitHub wurden angeboten, der Nutzer wollte vorerst nur den schnellen Test.
3. **Nach jeder Freigabe:** echte Daten einfrieren (`node scripts/alte-daten-einfrieren.mjs <commit> <version>`).

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

- **Projektfarbe (0.12):** Name in der Projektliste und Titel der Projektansicht in der Projektfarbe (Variante B, ohne Punkte).
  Knopf „Farbe“ in der Projektansicht, 20 klar unterscheidbare Farben (7 Solarized + 13 ergänzte, kein Rot), Haken = dieses
  Projekt, Ring = schon bei einem anderen Projekt; gleiche Farbe mehrfach erlaubt. Ohne Wahl bleibt die automatische Farbe wie bis 0.11.
- **Abgeschlossene Projekte (0.12):** unter „Erledigt“ nur als Karte (Abschnitt „Abgeschlossene Projekte“, verworfene im eigenen
  Abschnitt), ihre Aufgaben nicht einzeln. Abschliessen mit offenen Aufgaben fragt: „Mit erledigen“ oder „Offen lassen“.
  Haken einer Aufgabe im geschlossenen Projekt zurücknehmen fragt: „Ganzes Projekt wieder aktivieren“ oder „Nur diese Aufgabe“
  (wird vom Projekt gelöst und steht einzeln in Nächste Schritte).
- **Kontexte (0.12):** „Zug“ mit Zugsymbol, „Unterwegs“ mit laufendem Männchen, neu „Einkaufen“ mit Einkaufswagen.
  Zug und Einkaufen werden bei bestehenden Daten einmal automatisch ergänzt (nur wenn nie angelegt; gelöscht bleibt gelöscht).
- **Unteraufgaben (0.12):** nur im Dialog der Aufgabe. Knopf „Unteraufgaben hinzufügen“, weitere mit „+ Unteraufgabe“.
  Abhaken wird sofort gespeichert und bleibt sichtbar (durchgestrichen); Text, neue und entfernte mit „Speichern“.
- **Release Notes (0.12):** `RELEASE-NOTES.md`, bei jeder Version Pflicht. Nach einem Update einmal „Was ist neu“.

- **Klären (0.13, Vorschlag B „Ziel wählen“):** erste Frage „Ist das umsetzbar?“ bleibt. Ja → Kacheln Erledigt / Nächster
  Schritt (Kontext als Symbole, Fällig am, Erst ab, Projekt) / Delegieren (an wen, Fällig am, Nachfassen am) / Projekt
  (Name = Notiz, gewünschtes Ergebnis, erster Schritt). Nein → Kacheln Wegwerfen / Referenz / Irgendwann (optional Datum).
  Entwurf: Artefakt „Klären vereinfachen“. Projektfrist und Kontext des ersten Schritts nicht mehr im Klär-Blatt.
- **Inbox (0.13):** nur „Geklärt“ (Schon erledigt / Löschen, mit Rückgängig) und „Klären“, keine Fahne.
- **Fahne auf iPad/iPhone (0.13):** Solange das Datumsfeld den Fokus hat, wird nicht gespeichert (iPadOS meldet „change“
  schon beim Öffnen mit heute); gespeichert wird beim Schliessen. Schliesst man ohne Wahl, bleibt das vorausgewählte
  Datum von iPadOS (heute) stehen, mit Rückgängig.
- **Projektliste (0.13):** Ergebnis vollständig als Text unter dem Projekt, ohne Box.

## Neue optionale Datenfelder (seit 0.8)
- `Item.order`: eigene Position im Projekt; `null` bedeutet „nach Frist sortieren“.
- `Project.sequential`: seit 0.10 ohne Wirkung.
- `Project.color` (0.12): Schlüssel aus `PROJECT_COLORS` (`logic.ts`), `null` = automatisch.
- `Item.subtasks` (0.12): Liste `{ id, title, done, order, deleted? }`. Geändert nur über das neue Ereignis `item.sub`
  (`{ id, sid, patch }`), je Unteraufgabe einzeln, damit zwei Geräte sich nicht überschreiben. Ältere Versionen
  speichern das unbekannte Ereignis und geben es weiter.

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
