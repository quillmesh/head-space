// Reine Logik ohne Oberfläche: Datum, Abfragen auf den Zustand, Hilfsfunktionen.
// Wird von ui.ts genutzt und in tests/unit/ direkt geprüft.

import * as S from './store';
import type { Item, Project, Repeat } from './types';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function today(): string {
  return isoDate(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export type DueState = 'overdue' | 'today' | 'soon' | 'week' | 'later';
export function dueState(iso: string): DueState {
  const t = today();
  if (iso < t) return 'overdue';
  if (iso === t) return 'today';
  if (iso <= addDays(t, 3)) return 'soon';
  if (iso <= addDays(t, 7)) return 'week';
  return 'later';
}
export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('de-CH', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtTs(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
}
export function daysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / 86_400_000);
}

/**
 * iPad und iPhone (WebKit auf iOS): showPicker() ist vorhanden, öffnet aber nichts und meldet keinen Fehler
 * (WebKit-Fehler 268114, 261703). Dort muss der Finger das Datumsfeld direkt treffen. Safari auf dem iPad
 * meldet sich als Mac („MacIntel“), aber mit Touch. Alle Browser auf iOS nutzen WebKit.
 */
export function needsDirectDateTap(platform: string | undefined, maxTouchPoints: number | undefined): boolean {
  const p = platform ?? '';
  return /^(iPhone|iPad|iPod)/.test(p) || (p === 'MacIntel' && (maxTouchPoints ?? 0) > 1);
}

// ---------- Alter: Inbox rot ab Tag 8, Erledigtes nach 30 Tagen im Papierkorb (0.14, berechnet) ----------

/** Tage, nach denen ein ungeklärter Inbox-Eintrag rot wird (ab dem 8. Tag) */
export const INBOX_STALE_DAYS = 7;
/** Tage in „Erledigt“, danach erscheint ein Eintrag oder Projekt im Papierkorb */
export const DONE_KEEP_DAYS = 30;
const dayOf = (ts: number) => isoDate(new Date(ts));

/** Inbox-Eintrag seit mehr als 7 Tagen ungeklärt; „Wieder vorgelegt“ zählt ab dem Vorlage-Tag. */
export function isStale(i: Item): boolean {
  let start: string | null = null;
  if (i.list === 'inbox') start = dayOf(i.created);
  else if (i.list === 'someday' && i.tickler && i.tickler <= today()) start = i.tickler;
  return !!start && addDays(start, INBOX_STALE_DAYS) <= today();
}

/** Länger als 30 Tage erledigt bzw. geschlossen: gehört (berechnet) in den Papierkorb */
const agedOut = (ts: number | null | undefined) => !!ts && addDays(dayOf(ts), DONE_KEEP_DAYS) < today();
export const isAgedDone = (i: Item) => i.list === 'done' && !i.deleted && agedOut(i.completed);
/** Zeitpunkt, an dem ein Projekt abgeschlossen bzw. verworfen wurde */
export const closedAt = (p: Project) => (p.status === 'done' ? p.completed : p.status === 'dropped' ? (p.droppedAt ?? p.updated) : null);
export const isAgedProject = (p: Project) => !p.deleted && (p.status === 'done' || p.status === 'dropped') && agedOut(closedAt(p));

// ---------- Wiederholungen (0.14) ----------

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** Datum aus Jahr, Monat (0–11, darf überlaufen) und Tag; Tag zu gross → letzter Tag des Monats */
function ymd(y: number, m: number, d: number): string {
  const first = new Date(y, m, 1);
  const yy = first.getFullYear(), mm = first.getMonth();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`;
}
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
/** Wochentag 0 = Montag … 6 = Sonntag */
export const weekday = (iso: string) => (new Date(iso + 'T00:00:00').getDay() + 6) % 7;

export function validRepeat(r: unknown): r is Repeat {
  const o = r as Repeat;
  if (!o || typeof o !== 'object') return false;
  if (o.kind === 'week') return Array.isArray(o.days) && o.days.length > 0 && o.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (o.kind === 'month') return Number.isInteger(o.day) && o.day >= 1 && o.day <= 31;
  if (o.kind === 'year') return Number.isInteger(o.month) && o.month >= 1 && o.month <= 12 && Number.isInteger(o.day) && o.day >= 1 && o.day <= 31;
  return false;
}

/**
 * Nächster Termin der Regel nach `after` (inclusive = auch `after` selbst).
 * Tag 31 in kürzeren Monaten: letzter Tag des Monats; 29. Februar in anderen Jahren: 28.
 */
export function nextOccurrence(r: Repeat, after: string, inclusive = false): string {
  const ok = (iso: string) => (inclusive ? iso >= after : iso > after);
  if (r.kind === 'week') {
    for (let i = inclusive ? 0 : 1; i <= 7; i++) { const d = addDays(after, i); if (r.days.includes(weekday(d))) return d; }
    return addDays(after, 7);
  }
  const a = new Date(after + 'T00:00:00');
  if (r.kind === 'month') {
    for (let k = 0; k < 3; k++) { const iso = ymd(a.getFullYear(), a.getMonth() + k, r.day); if (ok(iso)) return iso; }
  } else {
    for (let k = 0; k < 3; k++) { const iso = ymd(a.getFullYear() + k, r.month - 1, r.day); if (ok(iso)) return iso; }
  }
  return after;
}

/** Ab wann eine Wiederholung sichtbar ist: wöchentlich 7 Tage, monatlich/jährlich 1 Monat vor dem Termin */
export function visibleFrom(i: Item): string | null {
  if (!i.repeat || !i.due) return null;
  if (i.repeat.kind === 'week') return addDays(i.due, -7);
  const d = new Date(i.due + 'T00:00:00');
  return ymd(d.getFullYear(), d.getMonth() - 1, d.getDate());
}
/** Wiederholung, deren Vorlaufzeit noch nicht begonnen hat */
export const notYetVisible = (i: Item) => { const v = visibleFrom(i); return !!v && v > today(); };
/** Pro Serie nur die nächste offene Wiederholung zeigen (früheste Frist) */
/** Serie einer Aufgabe: die erste Aufgabe hat keine eigene Angabe, ihre ID ist die Serie */
export const seriesOf = (i: Item) => i.series ?? (i.repeat ? i.id : null);
export function laterInSeries(i: Item): boolean {
  const s = seriesOf(i);
  if (!s || !isOpen(i)) return false;
  return all().some((o) => o.id !== i.id && seriesOf(o) === s && o.list === i.list && isOpen(o) &&
    ((o.due ?? '9999') < (i.due ?? '9999') || ((o.due ?? '9999') === (i.due ?? '9999') && o.id < i.id)));
}
/** Satz zur Regel: „Jeden Mo, Mi und Fr“, „Jeden Monat am 25.“, „Jedes Jahr am 22. Okt.“ */
export function repeatText(r: Repeat): string {
  if (r.kind === 'week') {
    const ds = [...r.days].sort().map((d) => WEEKDAYS[d]);
    if (ds.length === 7) return 'Jeden Tag';
    return `Jeden ${ds.length > 1 ? `${ds.slice(0, -1).join(', ')} und ${ds[ds.length - 1]}` : ds[0]}`;
  }
  if (r.kind === 'month') return `Jeden Monat am ${r.day}.`;
  return `Jedes Jahr am ${new Date(2000, r.month - 1, r.day).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })}`;
}

// ---------- Abfragen ----------

export const all = () => [...S.state.items.values()].filter((i) => !i.deleted);
export const project = (id: string | null) => (id ? S.state.projects.get(id) : undefined);
export const byCreated = (a: Item, b: Item) => a.created - b.created;
/** Fällige zuerst (frühestes Datum oben), danach in Erfassungsreihenfolge */
export const byDue = (a: Item, b: Item) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || byCreated(a, b);
export const isOpen = (i: Item) => i.list !== 'done' && i.list !== 'trash';
/** Gehört zu einem abgeschlossenen oder verworfenen Projekt (0.12) */
export const inClosedProject = (i: Item) => {
  const p = i.projectId ? S.state.projects.get(i.projectId) : undefined;
  return !!p && !p.deleted && (p.status === 'done' || p.status === 'dropped');
};
/** Unteraufgaben in Anzeige-Reihenfolge, ohne gelöschte */
export const subtasksOf = (i: Item) => (i.subtasks ?? []).filter((s) => !s.deleted).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

/** Projektschritte: eigene Reihenfolge zuerst, Einträge ohne Position danach nach Frist. */
export const byProjectOrder = (a: Item, b: Item) => {
  const ao = a.order ?? null, bo = b.order ?? null;
  if (ao !== null && bo !== null) return ao - bo || byDue(a, b);
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  return byDue(a, b);
};

/**
 * Neue Positionen nach dem Ziehen. items = aktuelle Anzeige-Reihenfolge.
 * Haben alle schon eine Position, ändert sich nur der verschobene Eintrag (Mitte zwischen den Nachbarn);
 * sonst werden alle in Tausenderschritten neu nummeriert.
 */
export function reorderPatches(items: Item[], id: string, toIndex: number): { id: string; order: number }[] {
  const from = items.findIndex((i) => i.id === id);
  if (from < 0) return [];
  const arr = items.filter((i) => i.id !== id);
  const to = Math.max(0, Math.min(toIndex, arr.length));
  arr.splice(to, 0, items[from]);
  const allOrdered = items.every((i) => typeof i.order === 'number');
  if (allOrdered) {
    if (to === from) return [];
    const prev = arr[to - 1]?.order, next = arr[to + 1]?.order;
    let order: number;
    if (prev != null && next != null) order = (prev + next) / 2;
    else if (next != null) order = next - 1000;
    else order = (prev ?? 0) + 1000;
    if (prev == null || next == null || Math.abs(next - prev) > 1e-6) return [{ id, order }];
  }
  return arr.map((it, i) => ({ id: it.id, order: (i + 1) * 1000 })).filter((p, i) => arr[i].order !== p.order);
}

/** Position für einen neuen Schritt bei eigener Reihenfolge; null ohne eigene Reihenfolge (dann gilt die Frist). */
export function orderForNew(items: Item[], due: string | null): number | null {
  const ordered = items.filter((i) => typeof i.order === 'number');
  if (!ordered.length) return null;
  // direkt nach dem letzten Schritt mit gleicher oder früherer Frist; ohne Frist ans Ende
  let idx = ordered.length;
  if (due) { idx = 0; ordered.forEach((i, k) => { if (i.due && i.due <= due) idx = k + 1; }); }
  const prev = ordered[idx - 1]?.order ?? null, next = ordered[idx]?.order ?? null;
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (next !== null) return next - 1000;
  return (prev ?? 0) + 1000;
}

/**
 * Konflikte zwischen eigener Reihenfolge und Fristen: ein Eintrag steht hinter Einträgen
 * mit späterer Frist. Ergebnis: Eintrag → die Einträge davor, die stören.
 */
export function orderConflicts(items: Item[]): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  items.forEach((it, i) => {
    if (!it.due) return;
    const above = items.slice(0, i).filter((o) => o.due && o.due > it.due!);
    if (above.length) out.set(it.id, above);
  });
  return out;
}

/**
 * Bearbeiten speichert nur, was sich wirklich geändert hat (0.10). So überschreibt eine Änderung
 * auf einem Gerät nicht unbemerkt andere Felder, die ein anderes Gerät inzwischen geändert hat
 * (z. B. „in den Papierkorb“). Leer, null und fehlend gelten als gleich.
 */
export function changedFields<T extends object>(before: T, patch: Partial<T>): Partial<T> {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
  const out: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) {
    if (JSON.stringify(norm(before[k])) !== JSON.stringify(norm(patch[k]))) out[k] = patch[k];
  }
  return out;
}

export const Q = {
  inbox: () => all().filter((i) => i.list === 'inbox').sort(byCreated),
  resurfaced: () => all().filter((i) => i.list === 'someday' && i.tickler && i.tickler <= today()).sort(byCreated),
  next: () =>
    all().filter((i) => {
      if (i.list !== 'next') return false;
      if (i.tickler && i.tickler > today()) return false;
      if (notYetVisible(i) || laterInSeries(i)) return false; // Wiederholungen (0.14)
      const p = project(i.projectId);
      return !p || p.status === 'active';
    }).sort(byDue),
  dueItems: () => all().filter((i) => i.due && isOpen(i) && !notYetVisible(i) && !laterInSeries(i)).sort(byDue),
  /** Dringend (Zahl im Menü): überfällige oder heute fällige Aufgaben. Projekte zählen nicht (0.10). */
  urgent: () => Q.dueItems().filter((i) => i.due! <= today()).length,
  waiting: () => all().filter((i) => i.list === 'waiting').sort((a, b) => (a.tickler ?? '9').localeCompare(b.tickler ?? '9') || byDue(a, b)),
  /** Wiedervorlage; dazu Wiederholungen, deren Vorlauf noch nicht begonnen hat (sichtbar ab …) */
  tickler: () =>
    all().filter((i) => ((i.tickler && i.tickler > today()) || (i.list === 'next' && notYetVisible(i) && !laterInSeries(i))) && ['next', 'someday', 'waiting', 'reference'].includes(i.list))
      .sort((a, b) => (a.tickler ?? visibleFrom(a) ?? '').localeCompare(b.tickler ?? visibleFrom(b) ?? '')),
  someday: () => all().filter((i) => i.list === 'someday' && !i.tickler).sort(byCreated),
  reference: () => all().filter((i) => i.list === 'reference').sort((a, b) => a.title.localeCompare(b.title, 'de')),
  /** Erledigte einzelne Aufgaben. Aufgaben abgeschlossener oder verworfener Projekte stehen nur im Projekt (0.12). */
  done: () => all().filter((i) => i.list === 'done' && !inClosedProject(i) && !isAgedDone(i)).sort((a, b) => (b.completed ?? 0) - (a.completed ?? 0)),
  /** Papierkorb: Weggeworfenes und (berechnet, 0.14) seit über 30 Tagen Erledigtes */
  trash: () => all().filter((i) => (i.list === 'trash' || isAgedDone(i)) && !inClosedProject(i)),
  /** Abgeschlossene und verworfene Projekte, die seit über 30 Tagen geschlossen sind (Papierkorb, 0.14) */
  trashedProjects: () => [...S.state.projects.values()].filter(isAgedProject).sort((a, b) => (closedAt(b) ?? 0) - (closedAt(a) ?? 0)),
  /** Abgeschlossene bzw. verworfene Projekte, zuletzt geschlossene zuerst (0.12) */
  closedProjects: (status: 'done' | 'dropped') =>
    [...S.state.projects.values()].filter((p) => !p.deleted && p.status === status && !isAgedProject(p))
      .sort((a, b) => (b.completed ?? b.updated) - (a.completed ?? a.updated) || a.title.localeCompare(b.title, 'de')),
  /** Offene Aufgaben eines Projekts (für die Rückfrage beim Abschliessen) */
  openInProject: (pid: string) => all().filter((i) => i.projectId === pid && isOpen(i) && i.list !== 'reference'),
  projects: (status: Project['status']) =>
    [...S.state.projects.values()].filter((p) => !p.deleted && p.status === status && !isAgedProject(p)).sort((a, b) => a.title.localeCompare(b.title, 'de')),
  /** Schritte eines Projekts: eigene Reihenfolge, sonst früheste Frist zuoberst, ohne Datum danach */
  projectItems: (pid: string) => all().filter((i) => i.projectId === pid).sort(byProjectOrder),
  /** GTD-Regel: Jedes aktive Projekt braucht einen nächsten Schritt (oder wartet auf jemanden). */
  stalled: (p: Project) => !all().some((i) => i.projectId === p.id && (i.list === 'next' || i.list === 'waiting')),
};

export const toClarify = () => [...Q.resurfaced(), ...Q.inbox()];

/**
 * Wählbare Projektfarben (0.12): 20 klar unterscheidbare Farben im Solarized-Stil, die 7 Solarized-Farben zuerst.
 * Gespeichert wird der Schlüssel (Project.color), nie der Farbwert. Rot fehlt: Rot heisst „überfällig“.
 */
export const PROJECT_COLORS: readonly { key: string; name: string; hex: string }[] = [
  { key: 'orange', name: 'Orange', hex: '#cb4b16' }, { key: 'gelb', name: 'Gelb', hex: '#b58900' },
  { key: 'gruen', name: 'Grün', hex: '#859900' }, { key: 'cyan', name: 'Cyan', hex: '#2aa198' },
  { key: 'blau', name: 'Blau', hex: '#268bd2' }, { key: 'violett', name: 'Violett', hex: '#6c71c4' },
  { key: 'magenta', name: 'Magenta', hex: '#d33682' }, { key: 'wald', name: 'Wald', hex: '#3d7a2a' },
  { key: 'petrol', name: 'Petrol', hex: '#1f6f78' }, { key: 'marine', name: 'Marine', hex: '#2b4f8f' },
  { key: 'purpur', name: 'Purpur', hex: '#7b3f9e' }, { key: 'rosa', name: 'Rosa', hex: '#e47fb0' },
  { key: 'himmel', name: 'Himmel', hex: '#6cb4ee' }, { key: 'minze', name: 'Minze', hex: '#4fb58a' },
  { key: 'limette', name: 'Limette', hex: '#b4c43c' }, { key: 'honig', name: 'Honig', hex: '#e3a72f' },
  { key: 'lachs', name: 'Lachs', hex: '#ec8a5a' }, { key: 'braun', name: 'Braun', hex: '#8b5a2b' },
  { key: 'schiefer', name: 'Schiefer', hex: '#586e75' }, { key: 'wein', name: 'Wein', hex: '#9c2f5b' },
];
/** Automatische Farben bis 0.11 (pc-0 … pc-6) und die Palettenfarbe, der sie entsprechen */
const AUTO_KEYS = ['blau', 'magenta', 'gruen', 'orange', 'violett', 'cyan', 'gelb'] as const;
export const isColorKey = (k: unknown): k is string => typeof k === 'string' && PROJECT_COLORS.some((c) => c.key === k);

/** Automatische Farbe: nach Reihenfolge der Erstellung, 7 Farben im Kreis (wie bis 0.11). -1 = unbekannt. */
function autoIndex(pid: string): number {
  const ordered = [...S.state.projects.values()].sort((a, b) => a.created - b.created);
  const i = ordered.findIndex((p) => p.id === pid);
  return i < 0 ? -1 : i % 7;
}

/** CSS-Klasse der Projektfarbe: selbst gewählt (pcx pc-<Schlüssel>) oder automatisch (pc-0 … pc-6, unverändert). */
export function projColor(pid: string | null | undefined): string {
  if (!pid) return 'pc-none';
  const p = S.state.projects.get(pid);
  if (p && isColorKey(p.color)) return `pcx pc-${p.color}`;
  const i = autoIndex(pid);
  return i < 0 ? 'pc-none' : `pc-${i}`;
}

/** Palettenschlüssel, der für ein Projekt gerade gilt (auch bei automatischer Farbe) */
export function colorKeyOf(pid: string): string | null {
  const p = S.state.projects.get(pid);
  if (p && isColorKey(p.color)) return p.color;
  const i = autoIndex(pid);
  return i < 0 ? null : AUTO_KEYS[i];
}

/** Farben, die andere (nicht gelöschte) Projekte schon verwenden: Ring in der Farbwahl */
export function usedColorKeys(exceptPid: string): Set<string> {
  const used = new Set<string>();
  for (const p of S.state.projects.values()) {
    if (p.deleted || p.id === exceptPid) continue;
    const k = colorKeyOf(p.id);
    if (k) used.add(k);
  }
  return used;
}

export function initials(title: string): string {
  const words = title.split(/[\s–-]+/).filter((w) => /^\p{L}/u.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}



// ---------- Wiederherstellungspunkte ----------

export interface RestorePoint { ts: number; label: string; kind: 'update' | 'day' | 'rewind'; changes: number }

const fmtWhen = (ts: number) => new Date(ts).toLocaleString('de-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Sinnvolle Zeitpunkte zum Zurückkehren: vor jedem Update, jeweils Tagesende der letzten 7 Tage
 * und vor jedem früheren Zurücksetzen. Nur Punkte, nach denen sich etwas geändert hat. Neueste zuerst.
 */
export function restorePoints(
  events: { ts: number }[],
  versionLog: { v: string; at: number }[],
  rewinds: { at: number; to: number; when?: number }[],
  now = Date.now(),
): RestorePoint[] {
  const tss = events.map((e) => e.ts).sort((a, b) => a - b);
  const after = (t: number) => { let lo = 0, hi = tss.length; while (lo < hi) { const m = (lo + hi) >> 1; if (tss[m] <= t) lo = m + 1; else hi = m; } return tss.length - lo; };
  const out: RestorePoint[] = [];
  for (const v of versionLog.slice(1)) out.push({ ts: v.at - 1, label: `Vor dem Update auf Version ${v.v} (${fmtWhen(v.at)})`, kind: 'update', changes: 0 });
  for (const r of rewinds) out.push({ ts: r.at - 1, label: `Vor dem Zurücksetzen am ${fmtWhen(r.when ?? r.at)}`, kind: 'rewind', changes: 0 });
  const d = new Date(now);
  for (let i = 1; out.filter((p) => p.kind === 'day').length < 7 && i <= 60; i++) {
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 23, 59, 59, 999).getTime();
    if (after(end) > 0 && tss.length && tss[0] <= end) {
      out.push({ ts: end, label: `Ende ${new Date(end).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long' })}`, kind: 'day', changes: 0 });
    }
  }
  for (const p of out) p.changes = after(p.ts);
  return out.filter((p) => p.changes > 0).sort((a, b) => b.ts - a.ts);
}
