// Darstellung der Karten ohne Browser: welche Symbole und Farbstufen erscheinen (Entscheidungen des Nutzers).
// Farben, Abstände und Ausrichtung brauchen echtes CSS und bleiben in den End-to-End-Tests (e2e/).
import { afterAll, beforeAll, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import { renderForTests as R } from '../../src/ui';
import type { Item } from '../../src/types';

beforeAll(() => setSystemTime(new Date('2026-10-11T09:00:00')));
afterAll(() => setSystemTime());
beforeEach(async () => { db.resetMemoryForTests(); S.resetForTests(); await S.init(); });

const card = (title: string, extra: Partial<Item>) => R.row(S.state.items.get(S.capture(title, extra))!, { check: true });
/** HTML eines Platzes (slot-ctx, slot-due, slot-rem, slot-rest) */
const slot = (html: string, name: string) => {
  const m = html.match(new RegExp(`<span class="slot ${name}">([\\s\\S]*?)</span>(?=<span class="slot|\\s*</div>)`));
  if (!m) throw new Error(`Platz ${name} fehlt in:\n${html}`);
  return m[1];
};

describe('Frist (Fahne)', () => {
  test.each([
    ['2026-10-10', 'due-overdue', 'überfällig: rot'],
    ['2026-10-11', 'due-today', 'heute: rot'],
    ['2026-10-13', 'due-soon', 'in 2 Tagen: orange'],
    ['2026-10-17', 'due-week', 'diese Woche'],
    ['2026-12-01', 'due-later', 'später'],
  ])('%s → %s (%s)', (due, cls) => {
    const d = slot(card('A', { list: 'next', due }), 'slot-due');
    expect(d).toContain(`due-${cls.slice(4)}`);
    expect(d).toContain('data-action="due-pick"');
  });
  test('heute zeigt „Heute“ statt Datum', () => {
    expect(slot(card('A', { list: 'next', due: '2026-10-11' }), 'slot-due')).toContain('Heute');
  });
  test('ohne Frist: blasse Fahne zum direkten Setzen', () => {
    expect(slot(card('A', { list: 'next' }), 'slot-due')).toContain('due-none');
  });
});

describe('Kontext-Platz', () => {
  test('Kontext als Symbol, Name als Hinweis, ohne „@“', () => {
    const h = card('A', { list: 'next', context: '@Computer' });
    expect(slot(h, 'slot-ctx')).toContain('ico-computer');
    expect(slot(h, 'slot-ctx')).toContain('title="Computer"');
    expect(h).not.toContain('@Computer');
  });
  test('offene Aufgabe ohne Kontext: Fragezeichen', () => {
    expect(slot(card('A', { list: 'next' }), 'slot-ctx')).toContain('ctx-none');
    expect(slot(card('A', { list: 'someday' }), 'slot-ctx')).toContain('ctx-none');
  });
  test('„Warten auf“: immer Sanduhr mit Name, auch mit Kontext', () => {
    const h = card('A', { list: 'waiting', waitingFor: 'Lisa', context: '@Telefon' });
    expect(slot(h, 'slot-ctx')).toContain('ctx-wait');
    expect(slot(h, 'slot-ctx')).toContain('wait-who">Lisa');
    expect(slot(h, 'slot-ctx')).not.toContain('ico-telefon');
  });
  test('Inbox ohne Kontext: leerer Platz (kein Fragezeichen)', () => {
    expect(slot(card('A', { list: 'inbox' }), 'slot-ctx')).toBe('');
  });
});

describe('Nachfassen (Glocke) und Erst ab (Mond)', () => {
  test('Nachfassen bei „Warten auf“: Glocke, nach Dringlichkeit gefärbt', () => {
    const r = slot(card('A', { list: 'waiting', waitingFor: 'Lisa', tickler: '2026-10-11' }), 'slot-rem');
    expect(r).toContain('rem-follow');
    expect(r).toContain('due-today');
    expect(r).toContain('Nachfassen am');
  });
  test('Erst ab: Mond, immer neutral, auch wenn heute', () => {
    const r = slot(card('A', { list: 'next', tickler: '2026-10-11' }), 'slot-rem');
    expect(r).toContain('rem-defer');
    expect(r).toContain('due-later');
    expect(r).not.toContain('due-today');
  });
});

describe('Weitere Angaben', () => {
  test('Notiz als Symbol', () => {
    expect(slot(card('A', { list: 'next', notes: 'x' }), 'slot-rest')).toContain('note-ico');
  });
  test('Projekt als Überzeile', () => {
    const pid = S.createProject({ title: 'Velo winterfit' });
    const h = card('Kette ölen', { list: 'next', projectId: pid });
    expect(h).toContain('row-eyebrow">Velo winterfit');
  });
  test('Titel wird maskiert (kein HTML aus Daten)', () => {
    expect(card('<img src=x onerror=alert(1)>', { list: 'next' })).not.toContain('<img');
  });
  test('Projekte haben keinen Löschen-Knopf zum Wischen, Aufgaben schon', () => {
    const p = S.state.projects.get(S.createProject({ title: 'P' }))!;
    expect(R.projectRow(p, '')).not.toContain('swipe-del');
    expect(card('A', { list: 'next' })).toContain('swipe-del');
  });
});
