// Ereignis-Log, Aktionen, Rückwärtskompatibilität und Backup
import { beforeEach, describe, expect, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import * as L from '../../src/logic';
import type { GtdEvent } from '../../src/types';

beforeEach(async () => {
  db.resetMemoryForTests();
  S.resetForTests();
  await S.init();
});

const ev = (id: string, ts: number, type: string, data: unknown, device = 'fremd'): GtdEvent => ({ id, ts, device, type, data });

describe('Start', () => {
  test('neues Gerät: Geräte-ID und Standard-Kontexte (ab 0.12 mit Zug und Einkaufen)', () => {
    expect(S.info.device.length).toBeGreaterThan(8);
    expect(S.state.contexts).toContain('@Telefon');
    expect(S.state.contexts).toEqual(['@Computer', '@Telefon', '@Unterwegs', '@Zuhause', '@Büro', '@Besprechung', '@Zug', '@Einkaufen']);
  });
  test('ohne IndexedDB: läuft im Arbeitsspeicher und meldet das', () => {
    expect(S.info.persistent).toBe(false);
  });
});

describe('Aufgaben', () => {
  test('capture: Standardwerte, Titel getrimmt, landet in der Inbox', () => {
    const id = S.capture('  Milch kaufen  ');
    const it = S.state.items.get(id)!;
    expect(it).toMatchObject({ title: 'Milch kaufen', list: 'inbox', notes: '', context: null, projectId: null, due: null, tickler: null, completed: null });
  });
  test('patchItem ändert nur genannte Felder; unbekannte ID wird ignoriert', () => {
    const id = S.capture('A', { context: '@Telefon' });
    S.patchItem(id, { due: '2030-01-01' });
    expect(S.state.items.get(id)).toMatchObject({ context: '@Telefon', due: '2030-01-01' });
    const before = S.info.eventCount;
    S.patchItem('gibt-es-nicht', { title: 'x' });
    expect(S.info.eventCount).toBe(before);
  });
  test('erledigen und zurückholen stellt die alte Liste wieder her', () => {
    const id = S.capture('A', { list: 'waiting' });
    S.completeItem(id);
    expect(S.state.items.get(id)).toMatchObject({ list: 'done', prevList: 'waiting' });
    expect(S.state.items.get(id)!.completed).toBeGreaterThan(0);
    S.restoreItem(id);
    expect(S.state.items.get(id)).toMatchObject({ list: 'waiting', completed: null });
  });
  test('zurückholen ohne frühere Liste landet bei Nächste Schritte', () => {
    const id = S.capture('A', { list: 'done' });
    S.restoreItem(id);
    expect(S.state.items.get(id)!.list).toBe('next');
  });
  test('Papierkorb und endgültig leeren (Titel und Notizen werden entfernt)', () => {
    const id = S.capture('Geheim', { notes: 'PIN 1234' });
    S.trashItem(id);
    expect(S.state.items.get(id)).toMatchObject({ list: 'trash', prevList: 'inbox' });
    S.emptyTrash();
    expect(S.state.items.get(id)).toMatchObject({ deleted: true, title: '', notes: '' });
  });
});

describe('Projekte und Kontexte', () => {
  test('createProject mit Standardwerten, patchProject', () => {
    const id = S.createProject({ title: ' Velo ' });
    expect(S.state.projects.get(id)).toMatchObject({ title: 'Velo', outcome: '', status: 'active', due: null });
    S.patchProject(id, { status: 'done', completed: 5 });
    expect(S.state.projects.get(id)).toMatchObject({ status: 'done', completed: 5 });
  });
  test('Kontexte: @ wird ergänzt, keine Doppelten, entfernen', () => {
    expect(S.normalizeContext(' Einkaufen ')).toBe('@Einkaufen');
    expect(S.normalizeContext('@@Garten')).toBe('@Garten');
    expect(S.normalizeContext('  ')).toBe('');
    S.addContext('Einkaufen'); S.addContext('@Einkaufen');
    expect(S.state.contexts.filter((c) => c === '@Einkaufen').length).toBe(1);
    S.removeContext('@Einkaufen');
    expect(S.state.contexts).not.toContain('@Einkaufen');
  });
});

describe('Endgültig gelöscht bleibt gelöscht (0.10)', () => {
  test('spätere Änderung eines anderen Geräts wird ignoriert', async () => {
    const id = S.capture('Geheim', { list: 'trash', notes: 'PIN' });
    S.emptyTrash();
    await S.mergeEvents([ev('x1', Date.now() + 1000, 'item.patch', { id, patch: { title: 'Neuer Titel', list: 'next' } })]);
    expect(S.state.items.get(id)).toMatchObject({ deleted: true, title: '', notes: '', list: 'trash' });
  });
  test('frühere Änderung, die erst später ankommt: Löschen gilt trotzdem (gleiches Ergebnis auf allen Geräten)', async () => {
    const id = S.capture('Geheim', { list: 'trash' });
    S.emptyTrash();
    await S.mergeEvents([ev('x2', 5, 'item.patch', { id, patch: { title: 'Alt' } })]);
    expect(S.state.items.get(id)).toMatchObject({ deleted: true, title: '' });
  });
  test('gelöschtes Projekt: spätere Änderung wird ignoriert', async () => {
    const p = S.createProject({ title: 'Umzug' });
    S.deleteProject(p);
    await S.mergeEvents([ev('x3', Date.now() + 1000, 'project.patch', { id: p, patch: { title: 'Wieder da' } })]);
    expect(S.state.projects.get(p)).toMatchObject({ deleted: true, title: '' });
  });
  test('ausdrückliches Wiederherstellen (früherer Stand) bleibt möglich', async () => {
    const id = S.capture('Wichtig', { list: 'trash' });
    S.emptyTrash();
    await S.mergeEvents([ev('x4', Date.now() + 1000, 'item.patch', { id, patch: { deleted: null, title: 'Wichtig', list: 'next' } })]);
    expect(S.state.items.get(id)).toMatchObject({ deleted: null, title: 'Wichtig', list: 'next' });
  });
});

describe('Projekt löschen (0.10)', () => {
  test('Projekt und alle seine Aufgaben endgültig: Titel, Notizen, Ziel entfernt; anderes unberührt', () => {
    const p = S.createProject({ title: 'Umzug', outcome: 'Neue Wohnung bezogen' });
    const q = S.createProject({ title: 'Anderes' });
    const a = S.capture('Kisten packen', { list: 'next', projectId: p, notes: 'geheim' });
    const b = S.capture('Offerte', { list: 'waiting', projectId: p });
    const c = S.capture('Erledigt im Projekt', { list: 'done', projectId: p });
    const fremd = S.capture('Gehört zu Anderes', { list: 'next', projectId: q });
    const frei = S.capture('Ohne Projekt', { list: 'next' });
    S.deleteProject(p);
    expect(S.state.projects.get(p)).toMatchObject({ deleted: true, title: '', outcome: '' });
    for (const id of [a, b, c]) expect(S.state.items.get(id)).toMatchObject({ deleted: true, title: '', notes: '' });
    expect(S.state.items.get(fremd)!.title).toBe('Gehört zu Anderes');
    expect(S.state.items.get(fremd)!.deleted).toBeFalsy();
    expect(S.state.items.get(frei)!.title).toBe('Ohne Projekt');
    expect(S.state.projects.get(q)!.title).toBe('Anderes');
  });
  test('ein Schritt: die Oberfläche wird nur einmal benachrichtigt', () => {
    const p = S.createProject({ title: 'P' });
    S.capture('A', { list: 'next', projectId: p }); S.capture('B', { list: 'next', projectId: p });
    let calls = 0; S.onChange(() => calls++);
    S.deleteProject(p);
    expect(calls).toBe(1);
  });
});

describe('Projekt gelöscht, während ein anderes Gerät einen Schritt hinzufügt (0.11)', () => {
  // Gerät A löscht das Projekt, Gerät B fügt gleichzeitig (ohne Abgleich dazwischen) einen Schritt hinzu.
  // Entscheid des Nutzers: Der verwaiste Schritt wird mitgelöscht, egal in welcher Reihenfolge die Uhren stehen.
  const setup = async () => {
    const p = S.createProject({ title: 'Umzug' });
    S.capture('Kisten packen', { list: 'next', projectId: p });
    await S.whenSaved();
    return p;
  };
  const schrittVonB = (p: string, ts: number) =>
    ev('b1', ts, 'item.create', { id: 'von-b', title: 'Möbel ausmessen', notes: 'Notiz von B', list: 'next', projectId: p });

  test('Schritt von B ist älter als das Löschen (B-Uhr zurück): wird mitgelöscht', async () => {
    const p = await setup();
    const vorher = Date.now() - 1000;
    S.deleteProject(p);
    await S.mergeEvents([schrittVonB(p, vorher)]);
    expect(S.state.items.get('von-b')).toMatchObject({ deleted: true, title: '', notes: '' });
  });
  test('Schritt von B ist jünger als das Löschen (B-Uhr vor): wird mitgelöscht', async () => {
    const p = await setup();
    S.deleteProject(p);
    await S.mergeEvents([schrittVonB(p, Date.now() + 60_000)]);
    expect(S.state.items.get('von-b')).toMatchObject({ deleted: true, title: '', notes: '' });
  });
  test('Aufgabe wird in ein gelöschtes Projekt verschoben: wird mitgelöscht', async () => {
    const p = await setup();
    const frei = S.capture('Frei', { list: 'next' });
    await S.whenSaved();
    S.deleteProject(p);
    await S.mergeEvents([ev('b2', Date.now() + 60_000, 'item.patch', { id: frei, patch: { projectId: p } })]);
    expect(S.state.items.get(frei)).toMatchObject({ deleted: true, title: '' });
  });
  test('andere Projekte und Aufgaben ohne Projekt bleiben unberührt', async () => {
    const p = await setup();
    const q = S.createProject({ title: 'Anderes' });
    const fremd = S.capture('Gehört zu Anderes', { list: 'next', projectId: q });
    S.deleteProject(p);
    await S.mergeEvents([schrittVonB(p, Date.now() - 1000)]);
    expect(S.state.items.get(fremd)).toMatchObject({ title: 'Gehört zu Anderes' });
    expect(S.state.items.get(fremd)!.deleted).toBeFalsy();
  });
});

describe('Ereignisse', () => {
  test('Zeitstempel sind streng aufsteigend, auch bei vielen Änderungen pro Millisekunde', async () => {
    for (let i = 0; i < 50; i++) S.capture(`x${i}`);
    const evs = await db.allEvents();
    for (let i = 1; i < evs.length; i++) expect(evs[i].ts).toBeGreaterThan(evs[i - 1].ts);
    expect(evs.every((e) => e.v === S.EVENT_FORMAT && e.device === S.info.device)).toBe(true);
  });
  test('batch benachrichtigt die Oberfläche nur einmal', () => {
    let calls = 0;
    S.onChange(() => calls++);
    S.batch(() => { S.capture('a'); S.capture('b'); S.capture('c'); });
    expect(calls).toBe(1);
  });
  test('lokale Änderungen lösen den Sync-Auslöser aus, fremde (zusammengeführte) nicht', async () => {
    let local = 0;
    S.onLocalChange(() => local++);
    S.capture('lokal');
    expect(local).toBe(1);
    await S.mergeEvents([ev('f1', Date.now(), 'item.create', { id: 'fx', title: 'fremd' })]);
    expect(local).toBe(1);
  });
});

describe('Rückwärtskompatibilität', () => {
  test('alte Einträge ohne neue Felder bekommen Standardwerte', () => {
    const it = S.normalizeItem({ id: 'a', title: 'alt', list: 'next' } as any, 100);
    expect(it).toMatchObject({ due: null, tickler: null, notes: '', context: null, projectId: null, prevList: null, created: 100 });
  });
  test('unbekannte Felder bleiben erhalten', () => {
    const it = S.normalizeItem({ id: 'a', title: 'x', energie: 'hoch' } as any, 1) as any;
    expect(it.energie).toBe('hoch');
    const p = S.normalizeProject({ id: 'p', title: 'y', farbe: 'blau' } as any, 1) as any;
    expect(p).toMatchObject({ status: 'active', outcome: '', due: null, farbe: 'blau' });
  });
  test('Daten von Version 0.1 werden vollständig gelesen', async () => {
    const t = 1_700_000_000_000;
    await S.mergeEvents([
      ev('o1', t, 'project.create', { id: 'p1', title: 'Steuern', outcome: '', status: 'active', created: t, updated: t, completed: null }),
      ev('o2', t + 1, 'item.create', { id: 'i1', title: 'Belege', notes: '', list: 'next', context: '@Telefon', projectId: 'p1', waitingFor: null, tickler: null, created: t, updated: t, completed: null }),
      ev('o3', t + 2, 'item.patch', { id: 'i1', patch: { list: 'done', completed: t + 2 } }),
    ]);
    expect(S.state.items.get('i1')).toMatchObject({ title: 'Belege', list: 'done', due: null, projectId: 'p1' });
    expect(S.state.projects.get('p1')).toMatchObject({ title: 'Steuern', due: null });
  });
  test('unbekannte Ereignistypen werden gespeichert, aber nicht ausgewertet', async () => {
    const n = await S.mergeEvents([ev('z1', Date.now(), 'zukunft.funktion', { foo: 1 })]);
    expect(n).toBe(1);
    expect((await db.allEvents()).some((e) => e.id === 'z1')).toBe(true);
  });
  test('beschädigte Ereignisse werden übersprungen, der Rest funktioniert', async () => {
    const n = await S.mergeEvents([
      ev('k1', Date.now(), 'item.create', null),
      ev('k2', Date.now() + 1, 'item.create', { title: 'ohne id' }),
      ev('k3', Date.now() + 2, 'item.patch', { id: 'gibt-es-nicht', patch: { title: 'x' } }),
      { id: 'k4' } as any,
      ev('k5', Date.now() + 3, 'item.create', { id: 'gut', title: 'gut' }),
    ]);
    expect(n).toBe(4); // k4 hat keinen Typ/Zeitstempel und wird verworfen
    expect(S.state.items.get('gut')!.title).toBe('gut');
  });
});

describe('Zusammenführen (Grundlage für Sync und Backup)', () => {
  test('bekannte Ereignisse werden nicht doppelt übernommen', async () => {
    const e = [ev('m1', Date.now(), 'item.create', { id: 'm', title: 'eins' })];
    expect(await S.mergeEvents(e)).toBe(1);
    expect(await S.mergeEvents(e)).toBe(0);
  });
  test('gleiches Feld auf zwei Geräten geändert: neuerer Zeitstempel gewinnt, unabhängig von der Ankunft', async () => {
    const t = Date.now();
    await S.mergeEvents([ev('c', t, 'item.create', { id: 'w', title: 'Start' })]);
    await S.mergeEvents([ev('b', t + 20, 'item.patch', { id: 'w', patch: { title: 'Gerät B (neuer)' } })]);
    await S.mergeEvents([ev('a', t + 10, 'item.patch', { id: 'w', patch: { title: 'Gerät A (älter)', due: '2030-01-01' } })]);
    expect(S.state.items.get('w')).toMatchObject({ title: 'Gerät B (neuer)', due: '2030-01-01' });
  });
});

describe('Verschlüsseltes Backup', () => {
  test('Export enthält keinen Klartext; Import auf leerem Gerät stellt alles her', async () => {
    S.capture('Arzttermin vereinbaren', { notes: 'geheim' });
    const text = await S.exportBackup('richtig-langes-passwort');
    expect(text).not.toContain('Arzttermin');
    expect(text).not.toContain('geheim');
    expect(S.info.lastBackup).toBeGreaterThan(0);
    db.resetMemoryForTests(); S.resetForTests(); await S.init();
    const { added } = await S.importBackup(text, 'richtig-langes-passwort');
    expect(added).toBeGreaterThan(0);
    expect([...S.state.items.values()].some((i) => i.title === 'Arzttermin vereinbaren')).toBe(true);
  }, 20_000);
  test('Import ist idempotent und überschreibt nichts', async () => {
    S.capture('A');
    const text = await S.exportBackup('richtig-langes-passwort');
    S.capture('nur lokal');
    expect((await S.importBackup(text, 'richtig-langes-passwort')).added).toBe(0);
    expect([...S.state.items.values()].some((i) => i.title === 'nur lokal')).toBe(true);
  }, 20_000);
  test('falsche Passphrase und fremde Dateien werden verständlich abgelehnt', async () => {
    const text = await S.exportBackup('richtig-langes-passwort');
    await expect(S.importBackup(text, 'falsch')).rejects.toThrow('Passphrase falsch');
    await expect(S.importBackup('kein json', 'x')).rejects.toThrow('nicht gelesen');
    await expect(S.importBackup('{"format":"anderes"}', 'x')).rejects.toThrow('keine Backup-Datei');
  }, 20_000);
});

describe('Speichern', () => {
  test('whenSaved wartet, bis alle Änderungen gespeichert sind', async () => {
    for (let i = 0; i < 20; i++) S.capture(`s${i}`);
    await S.whenSaved();
    const titles = (await db.allEvents()).map((e) => (e.data as any)?.title);
    for (let i = 0; i < 20; i++) expect(titles).toContain(`s${i}`);
  });
});

describe('Neue Kontexte Zug und Einkaufen (0.12)', () => {
  const oldData = async () => {
    db.resetMemoryForTests(); S.resetForTests();
    await db.putEvents(['@Computer', '@Telefon', '@Unterwegs'].map((name, i) => ev(`c${i}`, 1000 + i, 'context.add', { name })));
    await S.init();
  };
  test('bestehende Daten: einmal ergänzt; init allein ändert nichts', async () => {
    await oldData();
    expect(S.state.contexts).toEqual(['@Computer', '@Telefon', '@Unterwegs']);
    expect(await S.addNewDefaultContexts()).toEqual(['@Zug', '@Einkaufen']);
    expect(S.state.contexts).toEqual(['@Computer', '@Telefon', '@Unterwegs', '@Zug', '@Einkaufen']);
    expect(await S.addNewDefaultContexts()).toEqual([]);
  });
  test('gelöscht bleibt gelöscht, auch auf einem anderen Gerät, das noch nicht ergänzt hatte', async () => {
    await oldData();
    await S.addNewDefaultContexts();
    S.removeContext('@Zug');
    await S.whenSaved();
    const log = await db.allEvents();
    // anderes Gerät: bekommt die Ereignisse, hat selbst noch nie ergänzt
    db.resetMemoryForTests(); S.resetForTests();
    await db.putEvents(log); await S.init();
    expect(await S.addNewDefaultContexts()).toEqual(['@Einkaufen'].filter((c) => !S.state.contexts.includes(c)));
    expect(S.state.contexts).not.toContain('@Zug');
    expect(S.state.contexts).toContain('@Einkaufen');
  });
  test('neues Gerät: nichts doppelt', async () => {
    expect(await S.addNewDefaultContexts()).toEqual([]);
    expect(S.state.contexts.filter((c) => c === '@Zug').length).toBe(1);
  });
});

describe('Unteraufgaben (0.12)', () => {
  test('anlegen, abhaken, umbenennen, löschen; Reihenfolge nach Anlegen', () => {
    const id = S.capture('A');
    const s1 = S.addSubtask(id, ' Erstens ');
    const s2 = S.addSubtask(id, 'Zweitens');
    S.patchSubtask(id, s1, { done: true });
    S.patchSubtask(id, s2, { title: 'Zwei' });
    const it = S.state.items.get(id)!;
    expect(it.subtasks!.map((s) => [s.title, s.done])).toEqual([['Erstens', true], ['Zwei', false]]);
    S.patchSubtask(id, s1, { deleted: true });
    expect(L.subtasksOf(S.state.items.get(id)!).map((s) => s.title)).toEqual(['Zwei']);
  });
  test('alte Einträge ohne Feld: leere Liste', () => {
    const id = S.capture('A');
    expect(S.state.items.get(id)!.subtasks).toEqual([]);
  });
  test('zwei Geräte ändern verschiedene Unteraufgaben gleichzeitig: beides bleibt', async () => {
    const id = S.capture('A');
    const a = S.addSubtask(id, 'a');
    const b = S.addSubtask(id, 'b');
    await S.whenSaved();
    const base = await db.allEvents();
    const t = base[base.length - 1].ts;
    const n = await S.mergeEvents([
      ev('x1', t + 10, 'item.sub', { id, sid: a, patch: { done: true } }, 'A'),
      ev('x2', t + 11, 'item.sub', { id, sid: b, patch: { title: 'B neu' } }, 'B'),
    ]);
    expect(n).toBe(2);
    expect(S.state.items.get(id)!.subtasks!.map((s) => [s.title, s.done])).toEqual([['a', true], ['B neu', false]]);
  });
  test('Ereignis verändert nie die gespeicherten Daten eines früheren Ereignisses', async () => {
    const id = S.capture('A');
    const s1 = S.addSubtask(id, 'x');
    await S.whenSaved();
    const before = JSON.stringify(await db.allEvents());
    S.patchSubtask(id, s1, { done: true });
    await S.whenSaved();
    expect(JSON.stringify((await db.allEvents()).slice(0, -1))).toBe(before);
  });
  test('Papierkorb leeren und Projekt löschen entfernen auch die Unteraufgaben; spätere Änderungen werden ignoriert', () => {
    const id = S.capture('Geheim');
    const s1 = S.addSubtask(id, 'PIN 1234');
    S.trashItem(id); S.emptyTrash();
    expect(S.state.items.get(id)!.subtasks).toEqual([]);
    S.patchSubtask(id, s1, { title: 'wieder da?' });
    expect(S.state.items.get(id)!.subtasks).toEqual([]);
    const p = S.createProject({ title: 'P' });
    const j = S.capture('Schritt', { list: 'next', projectId: p });
    S.addSubtask(j, 'geheim');
    S.deleteProject(p);
    expect(S.state.items.get(j)!.subtasks).toEqual([]);
  });
  test('ältere App-Version: unbekanntes Ereignis bleibt gespeichert (Format unverändert)', () => {
    expect(S.EVENT_FORMAT).toBe(1);
  });
});

describe('Projekt abschliessen und zurückholen (0.12)', () => {
  test('mit offenen Aufgaben: erledigen oder offen lassen; Rückgängig stellt alles her', () => {
    const p = S.createProject({ title: 'P' });
    const a = S.capture('offen', { list: 'next', projectId: p });
    const w = S.capture('wartet', { list: 'waiting', projectId: p });
    const r = S.capture('Referenz', { list: 'reference', projectId: p });
    expect(L.Q.openInProject(p).map((i) => i.title).sort()).toEqual(['offen', 'wartet']);
    const u = S.completeProject(p, true)!;
    expect(S.state.projects.get(p)!.status).toBe('done');
    expect([a, w].map((id) => S.state.items.get(id)!.list)).toEqual(['done', 'done']);
    expect(S.state.items.get(r)!.list).toBe('reference');
    S.undoCompleteProject(p, u);
    expect(S.state.projects.get(p)!.status).toBe('active');
    expect([a, w].map((id) => S.state.items.get(id)!.list)).toEqual(['next', 'waiting']);
    S.completeProject(p, false);
    expect(S.state.items.get(a)!.list).toBe('next');
  });
  test('zurückholen: ganzes Projekt wieder aktiv', () => {
    const p = S.createProject({ title: 'P' });
    const a = S.capture('A', { list: 'next', projectId: p });
    S.completeItem(a); S.completeProject(p, false);
    S.reopenFromClosedProject(a, 'project');
    expect(S.state.projects.get(p)).toMatchObject({ status: 'active', completed: null });
    expect(S.state.items.get(a)).toMatchObject({ list: 'next', projectId: p });
  });
  test('zurückholen: nur die Aufgabe, vom Projekt gelöst; Projekt bleibt abgeschlossen', () => {
    const p = S.createProject({ title: 'P' });
    const a = S.capture('A', { list: 'next', projectId: p });
    S.completeItem(a); S.completeProject(p, false);
    S.reopenFromClosedProject(a, 'item');
    expect(S.state.projects.get(p)!.status).toBe('done');
    expect(S.state.items.get(a)).toMatchObject({ list: 'next', projectId: null, order: null });
    expect(L.Q.next().map((i) => i.title)).toEqual(['A']);
  });
});

describe('Zweimal angelegt (0.14)', () => {
  test('Ein zweites „anlegen“ mit derselben ID ändert nichts (zwei Geräte legen dieselbe Wiederholung an)', async () => {
    const id = S.capture('Serie', { list: 'next', repeat: { kind: 'week', days: [0] }, due: L.addDays(L.today(), -1) });
    const n = S.completeItem(id)!;
    S.patchItem(n, { title: 'geändert' });
    await S.whenSaved();
    const evs = await db.allEvents();
    const created = evs.find((e) => e.type === 'item.create' && e.data.id === n)!;
    await S.mergeEvents([{ ...created, id: 'anderes-geraet', device: 'B', ts: evs[evs.length - 1].ts + 5 }]);
    expect(S.state.items.get(n)!.title).toBe('geändert');
  });
});
