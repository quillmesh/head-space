// Zustand der App: entsteht aus dem Ereignis-Log.
// Jede Änderung = ein Ereignis → sofort angewendet und in IndexedDB gespeichert.

import * as db from './db';
import { ENV, IS_TEST } from './env';
import { decryptJSON, encryptJSON, type EncryptedFile } from './crypto';
import type { EventType, GtdEvent, Item, ListName, Project, State } from './types';
import { Q, isAgedDone, isAgedProject, inClosedProject, nextOccurrence, orderForNew, reorderPatches, today, validRepeat } from './logic';

/** Format der Ereignisse. Nur erhöhen, wenn alte Apps neue Ereignisse nicht mehr verstehen dürften. */
export const EVENT_FORMAT = 1;

export const state: State = { items: new Map(), projects: new Map(), contexts: [] };
export const info = { device: '', eventCount: 0, lastBackup: 0 as number, persistent: true };


const DEFAULT_CONTEXTS = ['@Computer', '@Telefon', '@Unterwegs', '@Zuhause', '@Büro', '@Besprechung', '@Zug', '@Einkaufen'];
/** In 0.12 neu dazugekommene Standard-Kontexte: bei bestehenden Daten einmal ergänzt (addNewDefaultContexts). */
export const NEW_CONTEXTS_012 = ['@Zug', '@Einkaufen'];

let lastTs = 0;
let batching = false;
let pending = false;
const listeners = new Set<() => void>();
let onErr: (msg: string) => void = (m) => console.error(m);

export function onChange(fn: () => void) { listeners.add(fn); }
/** Wird nach jeder lokalen Änderung aufgerufen (z. B. um den Sync anzustossen). */
const localListeners = new Set<() => void>();
export function onLocalChange(fn: () => void) { localListeners.add(fn); }
export function onError(fn: (msg: string) => void) { onErr = fn; }
function notify() {
  if (batching) { pending = true; return; }
  listeners.forEach((fn) => fn());
}

/** Mehrere Änderungen gemeinsam ausführen, die Oberfläche aktualisiert sich nur einmal. */
export function batch(fn: () => void) {
  batching = true;
  try { fn(); } finally {
    batching = false;
    if (pending) { pending = false; notify(); }
  }
}

export function uid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Reducer: Ereignis → Zustand ----------
//
// KOMPATIBILITÄT (bitte bei jeder Erweiterung einhalten):
// 1. Ereignisse werden nie geändert oder gelöscht, nur neue angehängt.
// 2. Neue Felder sind immer optional. Fehlt ein Feld (ältere Daten), setzt normalize*() den Standardwert.
// 3. Unbekannte Felder bleiben erhalten (Spread/Object.assign), damit ältere App-Versionen
//    Daten neuerer Versionen beim Sync nicht beschädigen.
// 4. Unbekannte Ereignistypen werden übersprungen, aber gespeichert und weiter synchronisiert.
// 5. Felder werden nie umbenannt oder in ihrer Bedeutung geändert. Stattdessen: neues Feld.

/** Standardwerte für Felder, die ältere Versionen noch nicht kannten. */
export function normalizeItem(d: Partial<Item> & { id: string }, ts: number): Item {
  return {
    title: '', notes: '', list: 'inbox', context: null, projectId: null, waitingFor: null,
    tickler: null, due: null, completed: null, prevList: null, order: null, subtasks: [], repeat: null, series: null,
    ...d,
    created: d.created ?? ts,
    updated: ts,
  } as Item;
}

export function normalizeProject(d: Partial<Project> & { id: string }, ts: number): Project {
  return {
    title: '', outcome: '', status: 'active', due: null, completed: null, sequential: false, color: null, droppedAt: null,
    ...d,
    created: d.created ?? ts,
    updated: ts,
  } as Project;
}

/**
 * Endgültig Gelöschtes bleibt gelöscht (0.10): Änderungen, die danach eintreffen (z. B. von einem
 * anderen Gerät, das noch nicht abgeglichen hatte), werden ignoriert. Ausnahme: ausdrückliches
 * Wiederherstellen (Patch mit deleted = null/false, z. B. „Zurück auf früheren Stand“).
 * Da alle Geräte die Ereignisse in derselben Reihenfolge abspielen, ist das Ergebnis überall gleich.
 */
function ignoreOnDeleted(target: { deleted?: boolean | null }, patch: Record<string, unknown> | undefined): boolean {
  return !!target.deleted && !(patch && 'deleted' in patch && !patch.deleted);
}

function apply(e: GtdEvent, st: State = state) {
  try { applyUnsafe(e, st); } catch (err) { console.warn('Ereignis übersprungen', e?.id, err); }
}

/**
 * Aufgaben eines gelöschten Projekts sind mitgelöscht (0.11), auch wenn ein anderes Gerät gleichzeitig
 * einen Schritt hinzugefügt hat, den das löschende Gerät noch nicht kannte („verwaister Schritt“).
 * Das ergibt sich beim Abspielen aus den Ereignissen; es entsteht kein neues Ereignis. Weil alle Geräte
 * dieselben Ereignisse in derselben Reihenfolge abspielen, ist das Ergebnis überall gleich.
 * Ausdrückliches Wiederherstellen (Patch mit deleted = null/false) bleibt möglich.
 */
function inDeletedProject(it: Item, st: State): boolean {
  return !it.deleted && !!it.projectId && !!st.projects.get(it.projectId)?.deleted;
}
function deleteWithProject(it: Item) {
  Object.assign(it, { deleted: true, title: '', notes: '', subtasks: [] });
}

function applyUnsafe(e: GtdEvent, st: State) {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  switch (e.type) {
    case 'item.create':
      // Schon vorhanden (0.14): zwei Geräte haben dieselbe Wiederholung angelegt (gleiche ID aus Serie + Datum).
      // Die erste gilt, damit spätere Änderungen daran nicht durch ein zweites Anlegen verloren gehen.
      if (typeof d.id === 'string' && !st.items.has(d.id)) {
        const it = normalizeItem(d, e.ts);
        if (inDeletedProject(it, st)) deleteWithProject(it); // Schritt zu einem schon gelöschten Projekt
        st.items.set(d.id, it);
      }
      break;
    case 'item.patch': {
      const it = st.items.get(d.id);
      if (it && !ignoreOnDeleted(it, d.patch)) {
        Object.assign(it, d.patch, { updated: e.ts });
        const restoring = d.patch && 'deleted' in d.patch && !d.patch.deleted;
        if (!restoring && d.patch && 'projectId' in d.patch && inDeletedProject(it, st)) deleteWithProject(it); // in gelöschtes Projekt verschoben
      }
      break;
    }
    case 'project.create':
      if (typeof d.id === 'string') st.projects.set(d.id, normalizeProject(d, e.ts));
      break;
    case 'project.patch': {
      const p = st.projects.get(d.id);
      if (p && !ignoreOnDeleted(p, d.patch)) {
        Object.assign(p, d.patch, { updated: e.ts });
        // Projekt gelöscht: auch Schritte, die das löschende Gerät noch nicht kannte
        if (d.patch?.deleted) for (const it of st.items.values()) if (inDeletedProject(it, st) && it.projectId === p.id) deleteWithProject(it);
      }
      break;
    }
    case 'item.sub': {
      // Unteraufgabe anlegen oder ändern (0.12). Jede Unteraufgabe für sich, damit gleichzeitige Änderungen
      // auf zwei Geräten an verschiedenen Unteraufgaben beide erhalten bleiben. Nie das Array im Ereignis verändern.
      const it = st.items.get(d.id);
      if (!it || it.deleted || typeof d.sid !== 'string') break;
      const patch = d.patch && typeof d.patch === 'object' ? d.patch : {};
      const subs = Array.isArray(it.subtasks) ? it.subtasks : [];
      const old = subs.find((x) => x.id === d.sid);
      const next = { id: d.sid, title: '', done: false, order: e.ts, ...old, ...patch };
      it.subtasks = old ? subs.map((x) => (x.id === d.sid ? next : x)) : [...subs, next];
      it.updated = e.ts;
      break;
    }
    case 'context.add':
      if (!st.contexts.includes(d.name)) st.contexts.push(d.name);
      break;
    case 'context.remove':
      st.contexts = st.contexts.filter((c) => c !== d.name);
      break;
    default:
      // Ereignis einer neueren App-Version: bleibt gespeichert, wird hier nicht ausgewertet.
      break;
  }
}

function rebuild(evs: GtdEvent[]) {
  state.items.clear();
  state.projects.clear();
  state.contexts = [];
  evs.forEach((e) => apply(e));
  info.eventCount = evs.length;
  lastTs = evs.length ? evs[evs.length - 1].ts : 0;
}

function emit(type: EventType, data: unknown): GtdEvent {
  let ts = Date.now();
  if (ts <= lastTs) ts = lastTs + 1; // streng monoton, damit die Reihenfolge eindeutig ist
  lastTs = ts;
  const e: GtdEvent = { id: uid(), ts, device: info.device, type, data, v: EVENT_FORMAT };
  apply(e);
  info.eventCount++;
  track(db.putEvents([e]).catch((err) => onErr('Speichern fehlgeschlagen: ' + (err?.message ?? err))));
  notify();
  localListeners.forEach((fn) => fn());
  return e;
}

// ---------- Laufende Speichervorgänge ----------

const pendingWrites = new Set<Promise<unknown>>();
function track(p: Promise<unknown>) {
  pendingWrites.add(p);
  void p.finally(() => pendingWrites.delete(p));
}
/** Wartet, bis alle Änderungen dauerhaft gespeichert sind (z. B. vor einem Update-Neustart). */
export async function whenSaved(): Promise<void> {
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
}

// ---------- Start ----------

export async function init() {
  await db.open();
  info.persistent = db.persistent;
  let device = await db.getMeta<string>('device');
  if (!device) { device = uid(); await db.setMeta('device', device); }
  info.device = device;
  info.lastBackup = (await db.getMeta<number>('lastBackup')) ?? 0;
  const evs = await db.allEvents();
  rebuild(evs);
  if (evs.length === 0) batch(() => DEFAULT_CONTEXTS.forEach((c) => emit('context.add', { name: c })));
  notify();
}

// ---------- Aktionen ----------

export function capture(title: string, extra: Partial<Item> = {}): string {
  const id = extra.id ?? uid();
  const item: Item = {
    title: title.trim(), notes: '', list: 'inbox', context: null, projectId: null,
    waitingFor: null, tickler: null, due: null, created: Date.now(), updated: Date.now(), completed: null, ...extra, id,
  };
  emit('item.create', item);
  return id;
}

export function patchItem(id: string, patch: Partial<Item>) {
  if (!state.items.has(id)) return;
  emit('item.patch', { id, patch });
}

/**
 * Erledigen. Bei einer Wiederholung (0.14) entsteht die nächste: nächster Termin nach dem späteren von heute
 * und der Frist (verspätet erledigt → nächster Termin nach heute). Feste ID aus Serie und Datum, damit zwei
 * Geräte dieselbe Wiederholung nicht doppelt anlegen. Gibt die ID der neuen Wiederholung zurück.
 */
export function completeItem(id: string, opts: { noRepeat?: boolean } = {}): string | null {
  const it = state.items.get(id);
  if (!it) return null;
  let created: string | null = null;
  const wasList = it.list;
  batch(() => {
    patchItem(id, { list: 'done', completed: Date.now(), prevList: it.list });
    if (!opts.noRepeat && wasList === 'next' && validRepeat(it.repeat)) {
      const t = today();
      const from = it.due && it.due > t ? it.due : t;
      const due = nextOccurrence(it.repeat, from);
      const series = it.series ?? it.id;
      const nid = `${series}~${due}`;
      if (!state.items.has(nid)) {
        capture(it.title, {
          id: nid, list: 'next', context: it.context, projectId: it.projectId, notes: it.notes, due, repeat: it.repeat, series,
          subtasks: (it.subtasks ?? []).filter((x) => !x.deleted).map((x) => ({ ...x, done: false })),
        });
        created = nid;
      }
    }
  });
  return created;
}

export function restoreItem(id: string) {
  const it = state.items.get(id);
  if (!it) return;
  const back: ListName = it.prevList && it.prevList !== 'done' && it.prevList !== 'trash' ? it.prevList : 'next';
  patchItem(id, { list: back, completed: null, prevList: null });
}

export function trashItem(id: string) {
  const it = state.items.get(id);
  if (!it) return;
  patchItem(id, { list: 'trash', prevList: it.list });
}

/** Papierkorb leeren: Weggeworfenes, seit über 30 Tagen Erledigtes und ebenso lange geschlossene Projekte samt Aufgaben (0.14) */
export function emptyTrash() {
  batch(() => {
    for (const p of [...state.projects.values()]) if (isAgedProject(p)) deleteProject(p.id);
    for (const it of state.items.values()) {
      if (it.deleted || inClosedProject(it)) continue;
      if (it.list === 'trash' || isAgedDone(it)) patchItem(it.id, { deleted: true, title: '', notes: '', subtasks: [] });
    }
  });
}

export function createProject(p: Partial<Project> & { title: string }): string {
  const id = uid();
  const project: Project = {
    id, title: p.title.trim(), outcome: p.outcome?.trim() ?? '', status: p.status ?? 'active', due: p.due ?? null,
    created: Date.now(), updated: Date.now(), completed: null, ...(p.sequential ? { sequential: true } : {}),
  };
  emit('project.create', project);
  return id;
}

/** Offene nächste Schritte eines Projekts in Anzeige-Reihenfolge */
const projectSteps = (pid: string) => Q.projectItems(pid).filter((i) => i.list === 'next');

/** Schritt in der Projektansicht an eine neue Position ziehen (eigene Reihenfolge). */
export function moveProjectItem(pid: string, id: string, toIndex: number) {
  const patches = reorderPatches(projectSteps(pid), id, toIndex);
  batch(() => patches.forEach((p) => patchItem(p.id, { order: p.order })));
}

/**
 * Projekt löschen (nur über die Projektansicht, mit Bestätigung): Projekt und alle seine
 * Aufgaben endgültig. Inhalte werden geleert, damit sie auch im Sync nicht mehr lesbar sind.
 */
export function deleteProject(pid: string) {
  if (!state.projects.has(pid)) return;
  batch(() => {
    for (const it of state.items.values()) {
      if (it.projectId === pid && !it.deleted) patchItem(it.id, { deleted: true, title: '', notes: '', subtasks: [] });
    }
    patchProject(pid, { deleted: true, title: '', outcome: '' });
  });
}

/** Eigene Reihenfolge verwerfen: wieder nach Frist. */
export function resetProjectOrder(pid: string) {
  batch(() => Q.projectItems(pid).forEach((i) => { if (i.order != null) patchItem(i.id, { order: null }); }));
}

/** Neuer Schritt im Projekt; bei eigener Reihenfolge nach Frist eingeordnet. */
export function addProjectStep(pid: string, title: string, extra: Partial<Item> = {}): string {
  const order = orderForNew(projectSteps(pid), extra.due ?? null);
  return capture(title, { list: 'next', projectId: pid, ...extra, ...(order !== null ? { order } : {}) });
}

// ---------- Unteraufgaben (0.12) ----------

/** Neue Unteraufgabe; gibt ihre ID zurück */
export function addSubtask(itemId: string, title: string): string {
  const sid = uid();
  if (state.items.has(itemId)) emit('item.sub', { id: itemId, sid, patch: { title: title.trim(), done: false } });
  return sid;
}
/** Unteraufgabe ändern (Titel, abgehakt, gelöscht) */
export function patchSubtask(itemId: string, sid: string, patch: { title?: string; done?: boolean; deleted?: boolean }) {
  if (!state.items.has(itemId)) return;
  emit('item.sub', { id: itemId, sid, patch });
}

// ---------- Projekte abschliessen und wieder öffnen (0.12) ----------

/**
 * Projekt abschliessen. withOpen: offene Aufgaben mit erledigen (Rückfrage in der Oberfläche).
 * Gibt zurück, was zum Rückgängigmachen nötig ist.
 */
export function completeProject(pid: string, withOpen: boolean): { prev: Pick<Project, 'status' | 'completed'>; completed: string[] } | null {
  const p = state.projects.get(pid);
  if (!p) return null;
  const prev = { status: p.status, completed: p.completed };
  const completed: string[] = [];
  batch(() => {
    if (withOpen) {
      for (const it of Q.openInProject(pid)) { completeItem(it.id, { noRepeat: true }); completed.push(it.id); }
    }
    patchProject(pid, { status: 'done', completed: Date.now() });
  });
  return { prev, completed };
}

/** Rückgängig zu completeProject */
export function undoCompleteProject(pid: string, u: { prev: Pick<Project, 'status' | 'completed'>; completed: string[] }) {
  batch(() => {
    u.completed.forEach((id) => restoreItem(id));
    patchProject(pid, u.prev);
  });
}

/**
 * Erledigte Aufgabe eines abgeschlossenen/verworfenen Projekts zurückholen.
 * 'project': ganzes Projekt wieder aktiv, Aufgabe offen. 'item': nur die Aufgabe, sie wird vom Projekt gelöst.
 */
export function reopenFromClosedProject(itemId: string, mode: 'project' | 'item') {
  const it = state.items.get(itemId);
  if (!it) return;
  const pid = it.projectId;
  batch(() => {
    restoreItem(itemId);
    if (mode === 'project' && pid) patchProject(pid, { status: 'active', completed: null });
    if (mode === 'item') patchItem(itemId, { projectId: null, order: null });
  });
}

/**
 * Neue Standard-Kontexte von 0.12 (Zug, Einkaufen) bei bestehenden Daten einmal ergänzen.
 * Nur wenn der Kontext noch nie angelegt wurde: Wer ihn später löscht, bekommt ihn nicht zurück.
 * Läuft getrennt von init(), damit das Lesen alter Daten selbst nichts verändert.
 */
export async function addNewDefaultContexts(): Promise<string[]> {
  if (await db.getMeta('contexts012')) return [];
  const evs = await db.allEvents();
  const ever = new Set(evs.filter((e) => e.type === 'context.add' && e.data && typeof e.data.name === 'string').map((e) => e.data.name as string));
  const added = NEW_CONTEXTS_012.filter((c) => !ever.has(c) && !state.contexts.includes(c));
  if (added.length) batch(() => added.forEach((c) => emit('context.add', { name: c })));
  await whenSaved();
  await db.setMeta('contexts012', true);
  return added;
}

export function patchProject(id: string, patch: Partial<Project>) {
  if (!state.projects.has(id)) return;
  emit('project.patch', { id, patch });
}

export function normalizeContext(name: string): string {
  const n = name.trim().replace(/^@+/, '');
  return n ? '@' + n : '';
}

export function addContext(name: string): string {
  const n = normalizeContext(name);
  if (n && !state.contexts.includes(n)) emit('context.add', { name: n });
  return n;
}

export function removeContext(name: string) {
  emit('context.remove', { name });
}

// ---------- Zurück auf früheren Stand ----------

/** Feldwerte vergleichen; fehlende Felder (ältere Stände) gelten als null. */
function diffBack<T extends object>(past: T, cur: T): Partial<T> {
  const patch: Partial<T> = {};
  const keys = new Set([...Object.keys(past), ...Object.keys(cur)]) as Set<keyof T>;
  for (const k of keys) {
    if (k === 'created' || k === 'updated') continue;
    const a = past[k] === undefined ? null : past[k];
    const b = cur[k] === undefined ? null : cur[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) (patch as Record<string, unknown>)[k as string] = a;
  }
  return patch;
}

/**
 * Setzt alles auf den Stand zum Zeitpunkt `ts` zurück.
 * Dabei wird nichts gelöscht oder umgeschrieben: Es werden ganz normale Änderungen angehängt,
 * die den alten Stand wiederherstellen. So verstehen es alle App-Versionen und der Sync,
 * und es lässt sich selbst wieder rückgängig machen. Gibt die Zahl geänderter Einträge zurück.
 */
export async function rewindTo(ts: number): Promise<number> {
  await whenSaved();
  const past: State = { items: new Map(), projects: new Map(), contexts: [] };
  const all = await db.allEvents();
  for (const e of all) if (e.ts <= ts) apply(e, past);
  // Zeitpunkt direkt vor dem Zurücksetzen (letztes Ereignis bisher), damit es sich selbst umkehren lässt
  const lastBefore = all.length ? all[all.length - 1].ts : 0;
  let changes = 0;
  batch(() => {
    for (const [id, cur] of [...state.items]) {
      const old = past.items.get(id);
      if (!old) { if (!cur.deleted) { patchItem(id, { deleted: true }); changes++; } continue; }
      const patch = diffBack(old, cur);
      if (Object.keys(patch).length) { patchItem(id, patch); changes++; }
    }
    for (const [id, cur] of [...state.projects]) {
      const old = past.projects.get(id);
      if (!old) { if (!cur.deleted) { patchProject(id, { deleted: true }); changes++; } continue; }
      const patch = diffBack(old, cur);
      if (Object.keys(patch).length) { patchProject(id, patch); changes++; }
    }
    for (const c of past.contexts) if (!state.contexts.includes(c)) { emit('context.add', { name: c }); changes++; }
    for (const c of [...state.contexts]) if (!past.contexts.includes(c)) { removeContext(c); changes++; }
  });
  if (changes) {
    const log = (await db.getMeta<{ at: number; to: number; when?: number }[]>('rewinds')) ?? [];
    log.push({ at: lastBefore + 1, to: ts, when: Date.now() });
    await db.setMeta('rewinds', log.slice(-20));
  }
  return changes;
}

/** Merkt sich, wann welche App-Version zum ersten Mal lief (für „Vor dem Update auf …“). */
export async function lastEventTs(): Promise<number> {
  await whenSaved();
  const e = await db.allEvents();
  return e.length ? e[e.length - 1].ts : 0;
}

export async function recordVersion(v: string) {
  const log = (await db.getMeta<{ v: string; at: number }[]>('versionLog')) ?? [];
  if (log[log.length - 1]?.v === v) return;
  log.push({ v, at: Date.now() });
  await db.setMeta('versionLog', log.slice(-20));
}

// ---------- Verschlüsseltes Backup ----------

interface BackupPayload { app: 'kopf-frei'; exportedAt: number; device: string; events: GtdEvent[]; env?: 'live' | 'test' }

export async function exportBackup(pass: string): Promise<string> {
  const payload: BackupPayload = { app: 'kopf-frei', exportedAt: Date.now(), device: info.device, events: await db.allEvents(), env: ENV };
  const file = await encryptJSON(payload, pass);
  info.lastBackup = Date.now();
  await db.setMeta('lastBackup', info.lastBackup);
  notify();
  return JSON.stringify(file);
}

/**
 * Stellt ein Backup wieder her, indem die Ereignisse zusammengeführt werden:
 * Was in der Datei steht, kommt dazu; was nur auf diesem Gerät ist, bleibt erhalten.
 * (Genau dieses Prinzip trägt später auch den GitHub-Sync.)
 */
export async function importBackup(text: string, pass: string): Promise<{ added: number }> {
  let file: EncryptedFile;
  try { file = JSON.parse(text); } catch { throw new Error('Die Datei konnte nicht gelesen werden. Ist es ein Backup dieser App?'); }
  const payload = await decryptJSON<BackupPayload>(file, pass);
  if (payload?.app !== 'kopf-frei' || !Array.isArray(payload.events)) throw new Error('Das Backup hat ein unbekanntes Format.');
  // Test-Daten nie in die echten Daten übernehmen (umgekehrt erlaubt: echte Daten zum Testen kopieren)
  if (!IS_TEST && payload.env === 'test') throw new Error('Dieses Backup stammt aus der Test-App und wird nicht in deine echten Daten übernommen.');
  const added = await mergeEvents(payload.events);
  if (added) localListeners.forEach((fn) => fn()); // importierte Ereignisse auch hochladen
  return { added };
}

/** Fügt fremde Ereignisse (Backup, Sync) hinzu. Bekannte IDs werden übersprungen. Gibt die Anzahl neuer zurück. */
export async function mergeEvents(incoming: GtdEvent[]): Promise<number> {
  const current = await db.allEvents();
  const known = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => e && typeof e.id === 'string' && typeof e.ts === 'number' && typeof e.type === 'string' && !known.has(e.id));
  if (!fresh.length) return 0;
  await db.putEvents(fresh);
  rebuild(db.sortEvents([...current, ...fresh]));
  notify();
  return fresh.length;
}

/** Für Hinweise ausserhalb der Ereignisse (Sync-Status): Oberfläche neu zeichnen. */
export const refresh = () => notify();

/** Nur für Tests: Zustand zurücksetzen. */
export function resetForTests() {
  state.items.clear(); state.projects.clear(); state.contexts = [];
  info.eventCount = 0; lastTs = 0;
  listeners.clear(); localListeners.clear();
}
