// Golden Files: echte Daten älterer Versionen müssen von der aktuellen App genau so gelesen werden.
//
// tests/unit/alte-daten/v<Version>.json stammt aus scripts/alte-daten-einfrieren.mjs (die alte Version
// wurde gebaut und hat die Daten im Browser selbst erzeugt). Diese Dateien werden nie geändert.
//
// Zwei Prüfungen je Version:
// 1. Was die alte Version in einer Liste angezeigt hat, liegt auch heute in dieser Liste (nicht gelöscht).
// 2. Der ganze Zustand ist genau der eingefrorene (v<Version>.erwartet.json). Ändert sich das Lesen alter
//    Daten absichtlich (neues Feld mit Standardwert), die Abweichung prüfen und mit
//    ALTE_DATEN_EINFRIEREN=1 bun test tests/unit/alte-daten.test.ts   neu einfrieren.
import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../../src/store';
import * as db from '../../src/db';
import type { GtdEvent, ListName } from '../../src/types';

const DIR = join(import.meta.dir, 'alte-daten');
const files = readdirSync(DIR).filter((f) => /^v[\d.]+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const VIEW_LIST: Record<string, ListName> = { inbox: 'inbox', next: 'next', waiting: 'waiting', someday: 'someday', reference: 'reference' };

const snapshot = () => JSON.parse(JSON.stringify({
  items: [...S.state.items.values()].map(({ updated: _u, ...i }) => i).sort((a, b) => a.id.localeCompare(b.id)),
  projects: [...S.state.projects.values()].map(({ updated: _u, ...p }) => p).sort((a, b) => a.id.localeCompare(b.id)),
  contexts: [...S.state.contexts].sort(),
}));

beforeEach(() => { db.resetMemoryForTests(); S.resetForTests(); });

describe('Alte Daten (Golden Files)', () => {
  test('mindestens die Versionen 0.1, 0.5, 0.8, 0.9, 0.10, 0.11, 0.12, 0.13 und 0.14 sind eingefroren', () => {
    expect(files).toEqual(expect.arrayContaining(['v0.1.0.json', 'v0.5.0.json', 'v0.8.0.json', 'v0.9.0.json', 'v0.10.0.json', 'v0.11.0.json', 'v0.12.0.json', 'v0.13.0.json', 'v0.14.0.json']));
  });

  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { version: string; ansichten: Record<string, string[]>; ereignisse: GtdEvent[] };
    describe(`Version ${fx.version}`, () => {
      const load = async () => { await db.putEvents(fx.ereignisse); await S.init(); };

      test('was die alte Version zeigte, steht heute in derselben Liste', async () => {
        await load();
        const items = [...S.state.items.values()].filter((i) => !i.deleted);
        for (const [view, titles] of Object.entries(fx.ansichten)) {
          for (const t of titles) {
            if (view === 'projects') {
              expect({ view, t, found: [...S.state.projects.values()].some((p) => !p.deleted && p.title === t) }).toEqual({ view, t, found: true });
            } else if (VIEW_LIST[view]) {
              expect({ view, t, found: items.some((i) => i.title === t && i.list === VIEW_LIST[view]) }).toEqual({ view, t, found: true });
            }
          }
        }
      });

      test('nichts geht verloren: alle Ereignisse bleiben gespeichert, auch unbekannte', async () => {
        await load();
        expect((await db.allEvents()).map((e) => e.id).sort()).toEqual(fx.ereignisse.map((e) => e.id).sort());
      });

      test('Zustand entspricht genau dem eingefrorenen', async () => {
        await load();
        const expectedFile = join(DIR, f.replace('.json', '.erwartet.json'));
        if (process.env.ALTE_DATEN_EINFRIEREN === '1' || !existsSync(expectedFile)) {
          if (process.env.CI) throw new Error(`${expectedFile} fehlt. Lokal mit ALTE_DATEN_EINFRIEREN=1 erzeugen und einchecken.`);
          writeFileSync(expectedFile, JSON.stringify(snapshot(), null, 1) + '\n');
        }
        expect(snapshot()).toEqual(JSON.parse(readFileSync(expectedFile, 'utf8')));
      });
    });
  }
});
