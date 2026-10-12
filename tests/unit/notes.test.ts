// Release Notes (0.12): Datei lesen, was nach einem Update gezeigt wird
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cmpVersion, lastSeenVersion, notesSince, parseNotes } from '../../src/notes';

const ROOT = join(import.meta.dir, '..', '..');
const md = readFileSync(join(ROOT, 'RELEASE-NOTES.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('RELEASE-NOTES.md', () => {
  test('die aktuelle Version hat einen Eintrag mit mindestens einem Punkt (Pflicht bei jeder Version)', () => {
    const n = parseNotes(md).find((x) => x.version === pkg.version);
    expect(n?.points.length ?? 0).toBeGreaterThan(0);
  });
  test('keine Version doppelt, keine neuer als package.json', () => {
    const vs = parseNotes(md).map((n) => n.version);
    expect(new Set(vs).size).toBe(vs.length);
    for (const v of vs) expect(cmpVersion(v, pkg.version)).toBeLessThanOrEqual(0);
  });
});

describe('Lesen', () => {
  const sample = `# Titel\nText\n\n## 0.9.0\n- alt\n\n## 0.10.0\n- **neu** eins\n- zwei\n  Fortsetzung\n`;
  test('Abschnitte und Punkte, neueste zuerst; Fortsetzungszeilen gehören zum Punkt', () => {
    expect(parseNotes(sample)).toEqual([
      { version: '0.10.0', points: ['**neu** eins', 'zwei Fortsetzung'] },
      { version: '0.9.0', points: ['alt'] },
    ]);
  });
  test('Versionen numerisch vergleichen', () => {
    expect(cmpVersion('0.10.0', '0.9.2')).toBeGreaterThan(0);
    expect(cmpVersion('0.12.0', '0.12.0')).toBe(0);
  });
});

describe('Was nach einem Update gezeigt wird', () => {
  const notes = parseNotes(`## 0.13.0\n- c\n## 0.12.1\n- b\n## 0.12.0\n- a\n## 0.11.0\n- alt`);
  test('alle Versionen seit der zuletzt gesehenen, bis und mit der laufenden', () => {
    expect(notesSince(notes, '0.11.0', '0.12.1').map((n) => n.version)).toEqual(['0.12.1', '0.12.0']);
  });
  test('neues Gerät (nie eine Version gesehen) oder gleiche Version: nichts', () => {
    expect(notesSince(notes, null, '0.12.0')).toEqual([]);
    expect(notesSince(notes, '0.12.0', '0.12.0')).toEqual([]);
    expect(notesSince(notes, '0.12.0', 'dev')).toEqual([]);
  });
  test('zuletzt gesehen: gemerkt, sonst die Version vor der laufenden laut Versions-Log', () => {
    expect(lastSeenVersion('0.11.0', [], '0.12.0')).toBe('0.11.0');
    expect(lastSeenVersion(null, [{ v: '0.10.0' }, { v: '0.11.0' }, { v: '0.12.0' }], '0.12.0')).toBe('0.11.0');
    expect(lastSeenVersion(undefined, [{ v: '0.12.0' }], '0.12.0')).toBeNull();
  });
});
