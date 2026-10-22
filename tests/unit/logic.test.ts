// Datum, Abfragen (Listen) und Hilfsfunktionen
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import * as L from '../../src/logic';

const T = L.today();
const d = (n: number) => L.addDays(T, n);

beforeEach(async () => {
  db.resetMemoryForTests();
  S.resetForTests();
  await S.init();
});

describe('Projektansicht', () => {
  test('Schritte nach Frist sortiert, früheste zuoberst, ohne Datum danach (nach Erfassung)', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('ohne 1', { list: 'next', projectId: p });
    S.capture('spät', { list: 'next', projectId: p, due: d(9) });
    S.capture('ohne 2', { list: 'next', projectId: p });
    S.capture('früh', { list: 'next', projectId: p, due: d(-2) });
    S.capture('mitte', { list: 'next', projectId: p, due: d(3) });
    expect(L.Q.projectItems(p).map((i) => i.title)).toEqual(['früh', 'mitte', 'spät', 'ohne 1', 'ohne 2']);
  });
});

describe('Bearbeiten speichert nur Geändertes (0.10)', () => {
  test('nur Felder mit anderem Wert; leer und null gelten als gleich', () => {
    const before = { title: 'A', notes: '', list: 'trash', context: null, due: '2026-01-01', waitingFor: null } as any;
    const form = { title: 'B', notes: '', list: 'trash', context: null, due: '2026-01-01', waitingFor: null } as any;
    expect(L.changedFields(before, form)).toEqual({ title: 'B' });
    expect(L.changedFields(before, { ...form, title: 'A' })).toEqual({});
    expect(L.changedFields({ ...before, waitingFor: undefined }, { waitingFor: null } as any)).toEqual({});
    expect(L.changedFields(before, { due: null } as any)).toEqual({ due: null });
  });
});

describe('Datum', () => {
  test('isoDate formatiert lokal als JJJJ-MM-TT', () => {
    expect(L.isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  test('addDays über Monats-, Jahres- und Schaltjahrgrenzen', () => {
    expect(L.addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(L.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(L.addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(L.addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(L.addDays('2026-10-25', 1)).toBe('2026-10-26'); // Zeitumstellung
  });
  test('dueState: alle Stufen', () => {
    expect(L.dueState(d(-1))).toBe('overdue');
    expect(L.dueState(T)).toBe('today');
    expect(L.dueState(d(1))).toBe('soon');
    expect(L.dueState(d(3))).toBe('soon');
    expect(L.dueState(d(4))).toBe('week');
    expect(L.dueState(d(7))).toBe('week');
    expect(L.dueState(d(8))).toBe('later');
  });
  test('fmtDate: ohne Jahr im laufenden Jahr, mit Jahr sonst, leer bei null', () => {
    const year = new Date().getFullYear();
    expect(L.fmtDate(`${year}-03-07`)).not.toContain(String(year));
    expect(L.fmtDate(`${year + 1}-03-07`)).toContain(String(year + 1));
    expect(L.fmtDate(null)).toBe('');
  });
  test('daysSince', () => {
    expect(L.daysSince(Date.now() - 3 * 86_400_000 - 1000)).toBe(3);
    expect(L.daysSince(Date.now())).toBe(0);
  });
});

describe('Hilfsfunktionen', () => {
  test('esc entschärft HTML', () => {
    expect(L.esc('<img src=x onerror="alert(1)">&\'')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
    expect(L.esc(null)).toBe('');
  });
  test('initials: Anfangsbuchstaben, nur Wörter mit Buchstaben', () => {
    expect(L.initials('Velo winterfit machen')).toBe('VW');
    expect(L.initials('Steuererklärung 2025 einreichen')).toBe('SE');
    expect(L.initials('Übergabe – Ölwechsel')).toBe('ÜÖ');
    expect(L.initials('')).toBe('');
  });
  test('projColor: nach Erstellungsreihenfolge, 7 Farben im Kreis', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) { ids.push(S.createProject({ title: `P${i}` })); await Bun.sleep(2); }
    expect(L.projColor(ids[0])).toBe('pc-0');
    expect(L.projColor(ids[6])).toBe('pc-6');
    expect(L.projColor(ids[7])).toBe('pc-0');
    expect(L.projColor(null)).toBe('pc-none');
    expect(L.projColor('gibt-es-nicht')).toBe('pc-none');
  });
});

describe('Listen (Abfragen)', () => {
  test('Inbox in Erfassungsreihenfolge, gelöschte und andere Listen ausgeschlossen', async () => {
    const a = S.capture('A'); await Bun.sleep(2);
    const b = S.capture('B'); await Bun.sleep(2);
    S.capture('C', { list: 'next' });
    const x = S.capture('X'); S.patchItem(x, { deleted: true });
    expect(L.Q.inbox().map((i) => i.id)).toEqual([a, b]);
  });
  test('Nächste Schritte: Frist zuerst, „Erst ab“ in der Zukunft verborgen, Projekte nur aktiv', async () => {
    const pSome = S.createProject({ title: 'Irgendwann', status: 'someday' });
    const pAct = S.createProject({ title: 'Aktiv' });
    const ohne = S.capture('ohne Frist', { list: 'next' }); await Bun.sleep(2);
    const spaet = S.capture('später fällig', { list: 'next', due: d(9) });
    const frueh = S.capture('früh fällig', { list: 'next', due: d(1) });
    S.capture('noch nicht', { list: 'next', tickler: d(2) });
    const heuteAb = S.capture('ab heute', { list: 'next', tickler: T });
    S.capture('im Irgendwann-Projekt', { list: 'next', projectId: pSome });
    const imAktiv = S.capture('im aktiven Projekt', { list: 'next', projectId: pAct });
    const ids = L.Q.next().map((i) => i.id);
    expect(ids.slice(0, 2)).toEqual([frueh, spaet]);
    expect(ids).toContain(ohne);
    expect(ids).toContain(heuteAb);
    expect(ids).toContain(imAktiv);
    expect(ids.length).toBe(5);
  });
  test('Wieder vorgelegt: Irgendwann mit erreichtem Datum, kommt vor der Inbox beim Klären', () => {
    const inbox = S.capture('neu');
    const back = S.capture('wieder da', { list: 'someday', tickler: T });
    S.capture('noch weg', { list: 'someday', tickler: d(5) });
    expect(L.Q.resurfaced().map((i) => i.id)).toEqual([back]);
    expect(L.toClarify().map((i) => i.id)).toEqual([back, inbox]);
  });
  test('Irgendwann ohne Datum, Wiedervorlage mit Datum in der Zukunft (sortiert)', () => {
    const ohne = S.capture('Idee', { list: 'someday' });
    const w2 = S.capture('w2', { list: 'next', tickler: d(10) });
    const w1 = S.capture('w1', { list: 'waiting', tickler: d(3) });
    S.capture('inbox mit Datum', { list: 'inbox', tickler: d(3) });
    expect(L.Q.someday().map((i) => i.id)).toEqual([ohne]);
    expect(L.Q.tickler().map((i) => i.id)).toEqual([w1, w2]);
  });
  test('Warten auf: nach Nachfass-Datum sortiert', () => {
    const ohne = S.capture('ohne', { list: 'waiting', waitingFor: 'A' });
    const spaet = S.capture('spät', { list: 'waiting', tickler: d(5) });
    const frueh = S.capture('früh', { list: 'waiting', tickler: d(1) });
    expect(L.Q.waiting().map((i) => i.id)).toEqual([frueh, spaet, ohne]);
  });
  test('Referenz alphabetisch, Erledigt neueste zuerst, Papierkorb', async () => {
    S.capture('Zebra', { list: 'reference' });
    S.capture('Apfel', { list: 'reference' });
    expect(L.Q.reference().map((i) => i.title)).toEqual(['Apfel', 'Zebra']);
    const a = S.capture('a', { list: 'next' }); const b = S.capture('b', { list: 'next' });
    S.completeItem(a); await Bun.sleep(3); S.completeItem(b);
    expect(L.Q.done().map((i) => i.id)).toEqual([b, a]);
    S.trashItem(a);
    expect(L.Q.trash().map((i) => i.id)).toEqual([a]);
  });
  test('Fristen: nur offene Aufgaben, keine Projekte; Dringendes gezählt', () => {
    S.capture('überfällig', { list: 'next', due: d(-2) });
    S.capture('heute', { list: 'waiting', due: T });
    S.capture('bald', { list: 'next', due: d(2) });
    const erledigt = S.capture('erledigt', { list: 'next', due: d(-5) }); S.completeItem(erledigt);
    S.createProject({ title: 'Projekt heute', due: T });
    S.createProject({ title: 'Projekt überfällig', due: d(-1) });
    expect(L.Q.dueItems().length).toBe(3);
    expect(L.Q.urgent()).toBe(2);
  });
  test('Projekte: nach Status und alphabetisch, gelöschte ausgeblendet', () => {
    S.createProject({ title: 'Beta' }); S.createProject({ title: 'Alpha' });
    const weg = S.createProject({ title: 'Weg' }); S.patchProject(weg, { deleted: true });
    S.createProject({ title: 'Später', status: 'someday' });
    expect(L.Q.projects('active').map((p) => p.title)).toEqual(['Alpha', 'Beta']);
    expect(L.Q.projects('someday').map((p) => p.title)).toEqual(['Später']);
  });
  test('Projekt ohne nächsten Schritt gilt als festgefahren (Warten auf zählt als Schritt)', () => {
    const p = S.createProject({ title: 'P' });
    const proj = () => S.state.projects.get(p)!;
    expect(L.Q.stalled(proj())).toBe(true);
    const w = S.capture('wartet', { list: 'waiting', projectId: p });
    expect(L.Q.stalled(proj())).toBe(false);
    S.completeItem(w);
    expect(L.Q.stalled(proj())).toBe(true);
    S.capture('Schritt', { list: 'next', projectId: p });
    expect(L.Q.stalled(proj())).toBe(false);
    expect(L.Q.projectItems(p).length).toBe(2);
  });
});

describe('Projektfarben wählen (0.12)', () => {
  test('Palette: 20 verschiedene Farben, eindeutige Schlüssel, kein Rot', () => {
    expect(L.PROJECT_COLORS.length).toBe(20);
    expect(new Set(L.PROJECT_COLORS.map((c) => c.key)).size).toBe(20);
    expect(new Set(L.PROJECT_COLORS.map((c) => c.hex)).size).toBe(20);
    expect(L.PROJECT_COLORS.map((c) => c.hex)).not.toContain('#dc322f');
    for (const c of L.PROJECT_COLORS) expect(c.key).toMatch(/^[a-z]+$/);
  });
  test('ohne gewählte Farbe bleibt die automatische Farbe wie bis 0.11', () => {
    const a = S.createProject({ title: 'A' });
    expect(L.projColor(a)).toBe('pc-0');
    expect(L.colorKeyOf(a)).toBe('blau');
  });
  test('gewählte Farbe gilt; unbekannter Schlüssel (z. B. von neuerer Version) fällt auf automatisch zurück', () => {
    const a = S.createProject({ title: 'A' });
    S.patchProject(a, { color: 'marine' });
    expect(L.projColor(a)).toBe('pcx pc-marine');
    expect(L.colorKeyOf(a)).toBe('marine');
    S.patchProject(a, { color: 'gibt-es-nicht' });
    expect(L.projColor(a)).toBe('pc-0');
  });
  test('benutzte Farben anderer Projekte (für den Ring); gleiche Farbe mehrfach erlaubt', () => {
    const a = S.createProject({ title: 'A' });
    const b = S.createProject({ title: 'B' });
    const c = S.createProject({ title: 'C' });
    S.patchProject(b, { color: 'wein' });
    S.patchProject(c, { color: 'wein' });
    expect([...L.usedColorKeys(a)].sort()).toEqual(['wein']);
    expect([...L.usedColorKeys(b)].sort()).toEqual(['blau', 'wein']);
    S.deleteProject(c);
    expect([...L.usedColorKeys(b)]).toEqual(['blau']);
  });
});

describe('Abgeschlossene Projekte unter „Erledigt“ (0.12)', () => {
  test('erledigte Aufgaben abgeschlossener oder verworfener Projekte stehen nicht einzeln in „Erledigt“', () => {
    const p = S.createProject({ title: 'P' });
    const q = S.createProject({ title: 'Q' });
    const i1 = S.capture('aus P', { list: 'next', projectId: p });
    const i2 = S.capture('aus Q', { list: 'next', projectId: q });
    const i3 = S.capture('einzeln', { list: 'next' });
    [i1, i2, i3].forEach((id) => S.completeItem(id));
    expect(L.Q.done().map((i) => i.title).sort()).toEqual(['aus P', 'aus Q', 'einzeln']);
    S.completeProject(p, false);
    S.patchProject(q, { status: 'dropped' });
    expect(L.Q.done().map((i) => i.title)).toEqual(['einzeln']);
    expect(L.Q.closedProjects('done').map((x) => x.title)).toEqual(['P']);
    expect(L.Q.closedProjects('dropped').map((x) => x.title)).toEqual(['Q']);
    expect(L.Q.projectItems(p).map((i) => i.title)).toEqual(['aus P']);
  });
  test('Papierkorb zeigt Aufgaben geschlossener Projekte nicht einzeln', () => {
    const p = S.createProject({ title: 'P' });
    const i = S.capture('weg', { list: 'next', projectId: p });
    S.trashItem(i);
    expect(L.Q.trash().length).toBe(1);
    S.completeProject(p, false);
    expect(L.Q.trash().length).toBe(0);
  });
});

describe('Datumsfeld direkt antippen (iPad/iPhone)', () => {
  test('iPhone, iPod, iPad (alte Kennung) und iPad als „Mac mit Touch“', () => {
    for (const p of ['iPhone', 'iPod touch', 'iPad']) expect(L.needsDirectDateTap(p, 5)).toBe(true);
    expect(L.needsDirectDateTap('MacIntel', 5)).toBe(true);
  });
  test('Mac ohne Touch, Windows, Android, Linux: nein (dort wirkt showPicker)', () => {
    expect(L.needsDirectDateTap('MacIntel', 0)).toBe(false);
    expect(L.needsDirectDateTap('Win32', 10)).toBe(false);
    expect(L.needsDirectDateTap('Linux armv8l', 5)).toBe(false);
    expect(L.needsDirectDateTap(undefined, undefined)).toBe(false);
  });
});

describe('Inbox rot ab dem 8. Tag (0.14)', () => {
  const vor = (n: number) => Date.now() - n * 86_400_000;
  test('erfasst vor 6 oder 7 Tagen: nicht rot; vor 7 Tagen und mehr am 8. Tag: rot', () => {
    // „ab dem 8. Tag“: erfasst am Tag 1, am Tag 8 (7 Tage später) rot
    expect(L.isStale(S.state.items.get(S.capture('a', { created: vor(6) }))!)).toBe(false);
    expect(L.isStale(S.state.items.get(S.capture('b', { created: vor(7) }))!)).toBe(true);
    expect(L.isStale(S.state.items.get(S.capture('c', { created: vor(30) }))!)).toBe(true);
    expect(L.isStale(S.state.items.get(S.capture('d'))!)).toBe(false);
  });
  test('nur in der Inbox; „Wieder vorgelegt“ zählt ab dem Vorlage-Tag', () => {
    expect(L.isStale(S.state.items.get(S.capture('n', { list: 'next', created: vor(30) }))!)).toBe(false);
    expect(L.isStale(S.state.items.get(S.capture('w1', { list: 'someday', tickler: d(-3), created: vor(60) }))!)).toBe(false);
    expect(L.isStale(S.state.items.get(S.capture('w2', { list: 'someday', tickler: d(-7), created: vor(60) }))!)).toBe(true);
    expect(L.isStale(S.state.items.get(S.capture('w3', { list: 'someday', tickler: d(5), created: vor(60) }))!)).toBe(false);
  });
});

describe('Nach 30 Tagen von „Erledigt“ in den Papierkorb (0.14, berechnet)', () => {
  const vor = (n: number) => Date.now() - n * 86_400_000;
  test('Aufgaben: bis 30 Tage unter Erledigt, danach im Papierkorb; nichts wird gespeichert', () => {
    const a = S.capture('neu erledigt', { list: 'done', completed: vor(30) });
    const b = S.capture('alt erledigt', { list: 'done', completed: vor(31), prevList: 'next' });
    const n = S.info.eventCount;
    expect(L.Q.done().map((i) => i.id)).toEqual([a]);
    expect(L.Q.trash().map((i) => i.id)).toEqual([b]);
    expect(S.info.eventCount, 'keine neuen Ereignisse').toBe(n);
    S.restoreItem(b);
    expect(S.state.items.get(b)).toMatchObject({ list: 'next', completed: null });
    expect(L.Q.trash()).toEqual([]);
  });
  test('Projekte: abgeschlossen oder verworfen vor über 30 Tagen → Papierkorb; Leeren löscht samt Aufgaben', () => {
    const p = S.createProject({ title: 'alt' });
    const t = S.capture('Schritt', { list: 'done', projectId: p, completed: vor(40) });
    S.patchProject(p, { status: 'done', completed: vor(35) });
    const q = S.createProject({ title: 'verworfen' });
    S.patchProject(q, { status: 'dropped', droppedAt: vor(10) });
    expect(L.Q.trashedProjects().map((x) => x.title)).toEqual(['alt']);
    expect(L.Q.closedProjects('done')).toEqual([]);
    expect(L.Q.closedProjects('dropped').map((x) => x.title)).toEqual(['verworfen']);
    expect(L.Q.trash(), 'Aufgaben geschlossener Projekte nicht einzeln').toEqual([]);
    const loose = S.capture('weg', { list: 'done', completed: vor(50) });
    S.emptyTrash();
    expect(S.state.projects.get(p)!.deleted).toBe(true);
    expect(S.state.items.get(t)).toMatchObject({ deleted: true, title: '' });
    expect(S.state.items.get(loose)!.deleted).toBe(true);
    expect(S.state.projects.get(q)!.deleted ?? false).toBe(false);
  });
  test('verworfen ohne Zeitpunkt (ältere Versionen): letzte Änderung zählt', () => {
    const q = S.createProject({ title: 'alt verworfen' });
    S.patchProject(q, { status: 'dropped' });
    expect(L.closedAt(S.state.projects.get(q)!)).toBe(S.state.projects.get(q)!.updated);
  });
});

describe('Wiederholungen (0.14)', () => {
  const W = (...days: number[]) => ({ kind: 'week' as const, days });
  test('wöchentlich: nächster passender Wochentag; inklusive für den ersten Termin', () => {
    // 2026-10-19 ist ein Montag
    expect(L.weekday('2026-10-19')).toBe(0);
    expect(L.nextOccurrence(W(0, 2, 4), '2026-10-19')).toBe('2026-10-21');
    expect(L.nextOccurrence(W(0, 2, 4), '2026-10-19', true)).toBe('2026-10-19');
    expect(L.nextOccurrence(W(0), '2026-10-19')).toBe('2026-10-26');
    expect(L.nextOccurrence(W(6), '2026-10-24')).toBe('2026-10-25');
  });
  test('monatlich: Tag 31 im kurzen Monat = letzter Tag; über den Jahreswechsel', () => {
    expect(L.nextOccurrence({ kind: 'month', day: 31 }, '2026-02-10')).toBe('2026-02-28');
    expect(L.nextOccurrence({ kind: 'month', day: 15 }, '2026-12-20')).toBe('2027-01-15');
    expect(L.nextOccurrence({ kind: 'month', day: 15 }, '2026-12-15', true)).toBe('2026-12-15');
  });
  test('jährlich: selber Tag; 29. Februar in anderen Jahren am 28.', () => {
    expect(L.nextOccurrence({ kind: 'year', month: 10, day: 22 }, '2026-10-22')).toBe('2027-10-22');
    expect(L.nextOccurrence({ kind: 'year', month: 2, day: 29 }, '2026-03-01')).toBe('2027-02-28');
  });
  test('sichtbar: wöchentlich 7 Tage, monatlich und jährlich 1 Monat vorher', () => {
    const w = S.state.items.get(S.capture('w', { list: 'next', repeat: W(0), due: d(8) }))!;
    expect(L.notYetVisible(w)).toBe(true);
    const w2 = S.state.items.get(S.capture('w2', { list: 'next', repeat: W(0), due: d(7) }))!;
    expect(L.notYetVisible(w2)).toBe(false);
    expect(L.visibleFrom({ repeat: { kind: 'year', month: 3, day: 31 }, due: '2027-03-31' } as any)).toBe('2027-02-28');
    expect(L.Q.next().map((i) => i.title)).toEqual(['w2']);
    expect(L.Q.tickler().map((i) => i.title), 'noch nicht sichtbare unter Wiedervorlage').toEqual(['w']);
  });
  test('erledigen legt die nächste an (gleiche Serie, feste ID); verspätet: nächster Termin nach heute', () => {
    const id = S.capture('Pflanzen giessen', { list: 'next', repeat: W(0, 1, 2, 3, 4, 5, 6), due: d(-3), context: '@Zuhause' });
    const n = S.completeItem(id)!;
    expect(n).toBe(`${id}~${d(1)}`);
    expect(S.state.items.get(n)).toMatchObject({ list: 'next', due: d(1), series: id, context: '@Zuhause', title: 'Pflanzen giessen' });
    const m = S.completeItem(n)!;
    expect(S.state.items.get(m)!.due, 'früh erledigt: nach der Frist').toBe(d(2));
  });
  test('pro Serie nur die nächste offene; Projekt abschliessen legt keine neue an', () => {
    const id = S.capture('A', { list: 'next', repeat: W(0, 1, 2, 3, 4, 5, 6), due: d(0) });
    const n = S.completeItem(id)!;
    S.restoreItem(id); // zurückgeholt: zwei offene in der Serie
    expect(L.Q.next().filter((i) => i.title === 'A').map((i) => i.id)).toEqual([id]);
    expect(L.laterInSeries(S.state.items.get(n)!)).toBe(true);
    const p = S.createProject({ title: 'P' });
    const r = S.capture('R', { list: 'next', projectId: p, repeat: W(0), due: d(0) });
    S.completeProject(p, true);
    expect([...S.state.items.values()].filter((i) => i.series === r)).toEqual([]);
  });
  test('ungültige Regel wiederholt nicht; Satz zur Regel', () => {
    const id = S.capture('x', { list: 'next', repeat: { kind: 'week', days: [] } as any, due: d(0) });
    expect(S.completeItem(id)).toBeNull();
    expect(L.repeatText(W(0, 2, 4))).toBe('Jeden Mo, Mi und Fr');
    expect(L.repeatText(W(6))).toBe('Jeden So');
    expect(L.repeatText({ kind: 'month', day: 25 })).toBe('Jeden Monat am 25.');
    expect(L.repeatText({ kind: 'year', month: 10, day: 22 })).toMatch(/^Jedes Jahr am 22\. Okt/);
  });
});
