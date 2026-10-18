# Testkonzept „Kopf frei“ (ab 0.11.0)

Ziel: Fehler auf der **billigsten Ebene** finden, die sie noch findet. Logik und Datenregeln ohne Browser in
Millisekunden, Bedienung und Gestaltung im echten Browser mit echten Touch-Ereignissen.
Oberste Priorität bleibt die **Datenkonsistenz zwischen Geräten**.

## Ebenen

| Ebene | Wo | Werkzeug | Zeit | Prüft |
|---|---|---|---|---|
| Typen | `src/` | TypeScript | ~5 s | Schreibfehler, falsche Felder |
| Unit | `tests/unit/*.test.ts` | `bun test` | < 1 s | Logik, Speicher, Sync, Verschlüsselung, Zurücksetzen |
| Darstellung | `tests/unit/karten.test.ts` | `bun test` | ms | welches Symbol / welche Farbstufe in einer Karte |
| Alte Daten | `tests/unit/alte-daten.test.ts` + `alte-daten/` | `bun test` | ms | echte Daten von 0.1, 0.5, 0.8, 0.9, 0.10, 0.11, 0.12, 0.13 werden genau so gelesen |
| Sync-Zufall | `tests/unit/sync-zufall.test.ts` | `bun test` | ~0,2 s | 150 zufällige Abläufe auf zwei Geräten mit verstellten Uhren |
| Neuerungen | `tests/unit/notes.test.ts` | `bun test` | ms | RELEASE-NOTES.md hat einen Eintrag für die Version in package.json; was nach einem Update gezeigt wird |
| End-to-End | `e2e/<funktion>.spec.mjs` | Playwright Test | ~1½ min | Bedienung, Touch, CSS, Service Worker, Sync im Browser |

### Zufallstests für den Sync (property-based)
Statt einzelner Fälle erzeugt der Test viele zufällige Abläufe (erfassen, ändern, erledigen, Papierkorb, leeren,
Projekte, ziehen, löschen, Unteraufgaben, Projektfarbe, Projekt abschliessen und Aufgabe zurückholen; Abgleich zu zufälligen Zeitpunkten; Uhr von Gerät B bis ±10 min falsch) und prüft Regeln,
die immer gelten müssen: beide Geräte gleich, Reihenfolge des Eintreffens egal, Abgleich idempotent, endgültig
Gelöschtes bleibt leer, keine offene Aufgabe in einem gelöschten Projekt (verwaister Schritt, Entscheid 0.11). Bei einem Fehler wird der Ablauf automatisch auf die wenigsten Schritte verkleinert
(„Shrinking“) und mit Startwert ausgegeben: `SYNC_SEED=<Zahl> bun test tests/unit/sync-zufall.test.ts`.
Mehr Abläufe: `SYNC_RUNS=5000`.

### Golden Files (alte Daten)
`scripts/alte-daten-einfrieren.mjs <commit> <version>` baut eine alte Version, lässt sie im Browser echte Daten
erzeugen (Beispiele, Bearbeiten, Projekt, Ziehen, „Nur die nächste“, Erledigen, Wischen, Papierkorb) und speichert
Ereignisse und das, was die alte Version angezeigt hat. Diese Dateien werden nie geändert. Ändert sich das Lesen
absichtlich, `ALTE_DATEN_EINFRIEREN=1 bun test tests/unit/alte-daten.test.ts` und die Abweichung prüfen.

### End-to-End mit Playwright Test
- Jeder Test hat eine eigene, frische Umgebung (eigene Datenbank). Fehler sind damit eindeutig einem Test zuzuordnen.
- `e2e/fixtures.mjs`: Geräte `HANDY`, `IPAD`, `COMPUTER`; Seitenfehler lassen den Test scheitern; `geraet()` öffnet ein
  weiteres Gerät (Sync).
- Keine festen Wartezeiten: `expect(...)` wartet selbst. Zeitabläufe (3 Sekunden Rückgängig, automatischer Sync)
  mit der simulierten Uhr `page.clock`.
- Bei Fehlern: Trace mit DOM, Netzwerk und Bildern je Schritt. Lokal unter `test-results/`, auf GitHub als
  Artifact „playwright-bericht“. Ansehen: https://trace.playwright.dev (Datei hineinziehen).
- WebKit (Safari-Kern) läuft auf GitHub für Tests mit `@webkit` im Namen (zurzeit der Knopf-Test auf dem iPad).
- Browser-Funktionen nie nur als Attrappe prüfen, die „wurde aufgerufen“ meldet: Bis 0.12.0 ersetzten alle Tests
  `showPicker()` und prüften nur den Aufruf. Auf iPad/iPhone ruft die App die Funktion zwar auf, sie öffnet dort
  aber nichts (WebKit-Fehler 268114). Seit 0.12.1 bildet ein Test das echte iPad-Verhalten nach.
- Ein Test ist nur etwas wert, wenn er ohne die Funktion rot wird. Bei neuen Regeln einmal absichtlich ausschalten und prüfen.

| Datei | Inhalt |
|---|---|
| `erfassen-klaeren` | Inbox, alle Klär-Wege (ab 0.13: Ziel-Kacheln), einzeln klären, Fristen beim Klären, Fristen-Ansicht, „Geklärt“, Inbox ohne Datum |
| `erledigen-rueckgaengig` | Erledigen, Rückgängig-Leiste, „Nächster Schritt“, Projekteintrag übernehmen |
| `fristen-kalender` | Fahne in der Karte, Ersatzdialog, nur „input“ (iPad), Rad-Auswahl, iPad/iPhone mit wirkungslosem `showPicker()` (WebKit-Fehler): Finger trifft das Datumsfeld, kein Dialog dazu, Auswahl bleibt offen bis zum Schliessen (0.13) |
| `projekte` | Schritt mit Frist, Ziehen mit dem Finger, Warndreieck, Pfeiltasten, Wischen vs. Griff, Projektfarbe zeigen und wählen, Abschliessen mit Rückfrage, „Erledigt“ mit Projekt-Karte, Zurückholen |
| `unteraufgaben` | Unteraufgaben einschalten, „+“, sofort abhaken (bleibt sichtbar), entfernen, umbenennen |
| `neuerungen` | „Was ist neu“: neues Gerät ohne Fenster, nach Update einmal |
| `loeschen-papierkorb` | Wischen, Rückgängig, Papierkorb leeren, Projekt löschen |
| `darstellung` | Farben, Grössen, „auf einer Linie“, kompakte Handy-Karten, Dialog-Felder, Hell/Dunkel, Kontext-Symbole (Zug, Unterwegs, Einkaufen), Filterleiste ohne Querscrollen, Projektergebnis vollständig ohne Box |
| `sync` | alte Datenbank v1, Einrichten, zwei Geräte, verschlüsselt, Löschen über zwei Geräte, verwaister Schritt |
| `update-offline` | Service Worker, Update-Hinweis, veralteter Zwischenspeicher, App reparieren (eigener Server) |
| `umgebungen` | Live und Test getrennt (Daten, Einstellungen, Service Worker, Caches, Backup) |
| `backup-zuruecksetzen` | verschlüsseltes Backup, Import auf neuem Gerät, „Zurück auf Stand vom …“ |
| `knoepfe` | jede Knopfart reagiert auf Antippen, einmal pro Gerät dort geprüft, wo sie zuerst vorkommt (Handy, iPad, iPad mit WebKit) |

## Herkunft
Bis 0.10.0 gab es 15 eigene Skripte (`tests/1-…` bis `tests/15-…`), nach Versionen geordnet. In 0.10.1 wurden alle
Prüfungen in die Dateien oben übernommen, in 0.11.0 die alten Skripte gelöscht (Zuordnung vom Nutzer bestätigt).
Weggefallen sind nur Bildschirmfotos ohne Prüfung und, mit der Spracheingabe, deren Tests.

Beim Umzug korrigiert: Test 2 setzte die Projektfrist fest auf den 20.12.2026 und wäre ab dem 21.12.2026 ohne Fehler
der App gescheitert. Alle Daten sind jetzt relativ zu heute.

## Laufzeit (gemessen 11.10.2026, gleiche Maschine, 2 Kerne, 2 parallel)

| | 0.10.0 | 0.11.0 |
|---|---|---|
| Unit | 18 s, 119 Tests | 0,7 s, 147 Tests |
| End-to-End | 115 s, 15 Skripte | 90 s, 51 Tests (Knopf-Test je Gerät ca. 27 s) |
