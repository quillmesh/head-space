# Testkonzept „Kopf frei“ (ab 0.10.1)

Ziel: Fehler auf der **billigsten Ebene** finden, die sie noch findet. Logik und Datenregeln ohne Browser in
Millisekunden, Bedienung und Gestaltung im echten Browser mit echten Touch-Ereignissen.
Oberste Priorität bleibt die **Datenkonsistenz zwischen Geräten**.

## Ebenen

| Ebene | Wo | Werkzeug | Zeit | Prüft |
|---|---|---|---|---|
| Typen | `src/` | TypeScript | ~5 s | Schreibfehler, falsche Felder |
| Unit | `tests/unit/*.test.ts` | `bun test` | < 1 s | Logik, Speicher, Sync, Verschlüsselung |
| Darstellung | `tests/unit/karten.test.ts` | `bun test` | ms | welches Symbol / welche Farbstufe in einer Karte |
| Alte Daten | `tests/unit/alte-daten.test.ts` + `alte-daten/` | `bun test` | ms | echte Daten von 0.1, 0.5, 0.8, 0.9, 0.10 werden genau so gelesen |
| Sync-Zufall | `tests/unit/sync-zufall.test.ts` | `bun test` | ~0,2 s | 150 zufällige Abläufe auf zwei Geräten mit verstellten Uhren |
| End-to-End | `e2e/<funktion>.spec.mjs` | Playwright Test | ~2 min | Bedienung, Touch, CSS, Service Worker, Sync im Browser |

### Zufallstests für den Sync (property-based)
Statt einzelner Fälle erzeugt der Test viele zufällige Abläufe (erfassen, ändern, erledigen, Papierkorb, leeren,
Projekte, ziehen, löschen; Abgleich zu zufälligen Zeitpunkten; Uhr von Gerät B bis ±10 min falsch) und prüft Regeln,
die immer gelten müssen: beide Geräte gleich, Reihenfolge des Eintreffens egal, Abgleich idempotent, endgültig
Gelöschtes bleibt leer. Bei einem Fehler wird der Ablauf automatisch auf die wenigsten Schritte verkleinert
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

| Datei | Inhalt |
|---|---|
| `erfassen-klaeren` | Inbox, alle Klär-Wege, einzeln klären, Fristen beim Klären, Fristen-Ansicht |
| `erledigen-rueckgaengig` | Erledigen, Rückgängig-Leiste, „Nächster Schritt“, Projekteintrag übernehmen |
| `fristen-kalender` | Fahne in der Karte, Ersatzdialog, nur „input“ (iPad), Rad-Auswahl |
| `projekte` | Schritt mit Frist, Ziehen mit dem Finger, Warndreieck, Pfeiltasten, Wischen vs. Griff |
| `loeschen-papierkorb` | Wischen, Rückgängig, Papierkorb leeren, Projekt löschen |
| `darstellung` | Farben, Grössen, „auf einer Linie“, kompakte Handy-Karten, Dialog-Felder, Hell/Dunkel |
| `sync` | alte Datenbank v1, Einrichten, zwei Geräte, verschlüsselt, Löschen über zwei Geräte |
| `update-offline` | Service Worker, Update-Hinweis, veralteter Zwischenspeicher, App reparieren (eigener Server) |
| `umgebungen` | Live und Test getrennt (Daten, Einstellungen, Service Worker, Caches, Backup) |
| `backup-zuruecksetzen` | verschlüsseltes Backup, Import auf neuem Gerät, „Zurück auf Stand vom …“ |
| `knoepfe` | jeder Knopf in jeder Ansicht reagiert auf Antippen (Handy, iPad, iPad mit WebKit) |
| `sprache` | Spracheingabe (pausiert; nur mit `kopf-frei-voice-enabled = 1`) |

## Zuordnung alte Tests → neue Orte

Alle Prüfungen der alten Skripte sind übernommen. Weggefallen sind nur die Bildschirmfotos ohne Prüfung
(sie wurden zum Anschauen abgelegt; Playwright macht bei Fehlern automatisch Bilder und Traces).

| Alt | Neu |
|---|---|
| 1 Grundfunktionen | `erfassen-klaeren` (Klär-Wege), `backup-zuruecksetzen` (Backup, neues Gerät) |
| 2 Fristen + Sprache | `erfassen-klaeren` (Fristen), `sprache` (A–E, Einstellungen) |
| 3 Rückgängig + Zeilen | `erledigen-rueckgaengig`, `fristen-kalender`, `darstellung` (Plätze) |
| 4 Sync + Kompatibilität + Update | `sync` (alte Datenbank, Einrichten), `darstellung` (Hell/Dunkel), `update-offline` |
| 5 Wischen + Sprachfehler | `loeschen-papierkorb` (Wischen), `sprache` (Ausfälle, Diagnose) |
| 6 Test-Umgebung | `umgebungen` |
| 7 Früherer Stand | `backup-zuruecksetzen` |
| 8 Update robust | `update-offline` |
| 9 Klären | `erfassen-klaeren` (einzeln klären) |
| 10 Symbole + Projekt | `darstellung`, `projekte` (Sortierung), `fristen-kalender` (input/change) |
| 11 Projekt-Reihenfolge | `projekte`, `darstellung` (Boxen, Dialog), `sprache` (ausgeschaltet) |
| 12 Alle Knöpfe | `knoepfe` |
| 13 Handy kompakt | `darstellung` |
| 14 Sync löschen | `sync` (Löschen über zwei Geräte) |
| 15 Papierkorb + Wischen | `loeschen-papierkorb`, `projekte` (Wischen vs. Griff) |

Beim Umzug korrigiert: Test 2 setzte die Projektfrist fest auf den 20.12.2026 und wäre ab dem 21.12.2026 ohne Fehler
der App gescheitert. Alle Daten sind jetzt relativ zu heute.

## Laufzeit (gemessen 11.10.2026, gleiche Maschine, 2 Kerne, 2 parallel)

| | vorher | nachher |
|---|---|---|
| Unit | 18 s, 119 Tests | 0,6 s, 154 Tests |
| End-to-End | 115 s, 15 Skripte | 114 s, 87 Tests (davon Knopf-Test ca. 50 s) |
