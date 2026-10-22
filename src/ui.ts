// Oberfläche: Navigation, Listen, Klär-Dialog, Bearbeiten, Einstellungen.
// Bewusst ohne Framework: Ansichten sind Funktionen, die HTML erzeugen;
// Klicks und Formulare laufen über data-action / data-form (Event-Delegation).

import * as S from './store';
import * as Sync from './sync';
import { IS_TEST, storageKey } from './env';
import { seedSample } from './sample';
import { destroy as destroyDb, allEvents as getAllEvents, getMeta, setMeta } from './db';

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '';
import type { Item, ListName, Project, Repeat } from './types';
import { changedFields, restorePoints, Q, addDays, all, colorKeyOf, isStale, nextOccurrence, repeatText, validRepeat, weekday, WEEKDAYS, daysSince, dueState, esc, fmtDate, fmtTs, inClosedProject, initials, isOpen, orderConflicts, project, projColor, PROJECT_COLORS, subtasksOf, today, toClarify, usedColorKeys, type DueState } from './logic';
import { lastSeenVersion, notesSince, parseNotes, type ReleaseNote } from './notes';
import NOTES_MD from '../RELEASE-NOTES.md' with { type: 'text' };
import { ctxBadge, ctxIcon, ctxLabel, ctxWithName, itemSymbol, noneBadge, waitBadge } from './icons';
export { today } from './logic';

// ---------- Hilfsfunktionen ----------

function dueChip(iso?: string | null): string {
  if (!iso) return '';
  const s = dueState(iso);
  const label = s === 'today' ? 'heute fällig' : s === 'overdue' ? `überfällig seit ${fmtDate(iso)}` : `fällig ${fmtDate(iso)}`;
  return `<span class="chip due-${s}">${label}</span>`;
}


// ---------- Zustand der Oberfläche ----------

type View = 'inbox' | 'due' | 'next' | 'projects' | 'project' | 'waiting' | 'tickler' | 'someday' | 'reference' | 'done' | 'settings';
let route: { view: View; id?: string } = { view: 'inbox' };
let ctxFilter = 'all';
let backupText: string | null = null;
let busy = false;

/** Klären (0.13, Vorschlag B): erste Frage, dann ein Blatt mit Zielen */
type Step = 'actionable' | 'not' | 'yes';
type Goal = 'done' | 'next' | 'deleg' | 'proj';
type NotGoal = 'trash' | 'ref' | 'some';
type Modal =
  | null
  | { kind: 'clarify'; id: string; step: Step; hist: Step[]; title: string; series: boolean; goal?: Goal; not?: NotGoal; ctx?: string | null }
  | { kind: 'quick'; id: string }
  | { kind: 'edit'; id: string }
  | { kind: 'project'; id: string | null }
  | { kind: 'capture' }
  | { kind: 'confirm'; text: string; label: string; run: () => void }
  | { kind: 'next-step'; projectId: string; fromId: string }
  | { kind: 'due'; id: string; target: 'item' | 'project' }
  | { kind: 'conflict'; id: string }
  | { kind: 'color'; id: string }
  | { kind: 'close-project'; id: string }
  | { kind: 'reopen'; id: string }
  | { kind: 'notes'; notes: ReleaseNote[] };
let modal: Modal = null;

// ---------- Navigation ----------

const NAV: { group: string; items: { view: View; label: string; count?: () => number; warn?: () => number }[] }[] = [
  { group: 'Erfassen', items: [{ view: 'inbox', label: 'Inbox', count: () => toClarify().length }] },
  {
    group: 'Tun',
    items: [
      { view: 'next', label: 'Nächste Schritte', count: () => Q.next().length },
      { view: 'due', label: 'Fristen', count: () => Q.dueItems().length, warn: Q.urgent },
      { view: 'projects', label: 'Projekte', count: () => Q.projects('active').length, warn: () => Q.projects('active').filter(Q.stalled).length },
      { view: 'waiting', label: 'Warten auf', count: () => Q.waiting().length, warn: () => Q.waiting().filter((i) => i.tickler && i.tickler <= today()).length },
    ],
  },
  {
    group: 'Später',
    items: [
      { view: 'tickler', label: 'Wiedervorlage', count: () => Q.tickler().length },
      { view: 'someday', label: 'Irgendwann/Vielleicht', count: () => Q.someday().length + Q.projects('someday').length },
    ],
  },
  {
    group: 'Ablage',
    items: [
      { view: 'reference', label: 'Referenz', count: () => Q.reference().length },
      { view: 'done', label: 'Erledigt' },
    ],
  },
];

function renderNav() {
  const active = route.view === 'project' ? 'projects' : route.view;
  const groups = NAV.map((g) => `
    <div class="nav-group">
      <div class="nav-label">${g.group}</div>
      ${g.items.map((n) => {
        const c = n.count?.() ?? 0;
        const w = n.warn?.() ?? 0;
        return `<button class="nav-item${active === n.view ? ' is-active' : ''}" data-action="go" data-view="${n.view}" aria-current="${active === n.view ? 'page' : 'false'}">
          <span>${n.label}</span>
          ${w ? `<span class="badge warn" title="${w} brauchen Aufmerksamkeit">${w}</span>` : ''}
          ${n.count && c ? `<span class="count">${c}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');
  document.getElementById('nav')!.innerHTML = `${groups}
    <div class="nav-group nav-foot">
      ${syncIndicator()}
      <button class="nav-item${active === 'settings' ? ' is-active' : ''}" data-action="go" data-view="settings"><span>Einstellungen</span></button>
    </div>`;
}

// ---------- Sync-Anzeige ----------

function ago(ts: number): string {
  if (!ts) return 'noch nie';
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return new Date(ts).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
}

function syncIndicator(): string {
  const st = Sync.status;
  if (st.state === 'off') return '';
  const TEXT: Record<Sync.SyncState, string> = {
    off: '', idle: `Synchronisiert ${ago(st.last)}`, syncing: 'Synchronisiere …', error: 'Sync-Fehler',
    offline: 'Offline, wird nachgeholt', locked: 'Sync gesperrt: Passphrase nötig',
  };
  return `<button class="sync-pill sync-${st.state}" data-action="go" data-view="settings" title="${esc(st.error || TEXT[st.state])}">
    <i aria-hidden="true"></i><span>${TEXT[st.state]}</span></button>`;
}

// ---------- Bausteine ----------

/** Frist (Fahne), Nachfassen (Glocke), Erst ab (Mond „schlummern“): auf einen Blick unterscheidbar */
const FLAG_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 14.5V2M3.5 2.5h8.2l-1.6 3 1.6 3H3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const BELL_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.2H2.8zM6.6 14.2a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const MOON_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9.8 2.6a5.6 5.6 0 1 0 3.6 8.6 4.6 4.6 0 0 1-3.6-8.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 2.2h2.6L11 5h2.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NOTE_SVG = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const WARN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="currentColor"/><path d="M12 9v4.6" stroke="var(--surface)" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.25" fill="var(--surface)"/></svg>`;
const REPEAT_SVG = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M12.5 6A5 5 0 0 0 3.3 5M3.5 10a5 5 0 0 0 9.2 1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 2.5v2.8h2.8M13 13.5v-2.8h-2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const GRIP_SVG = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="5.5" cy="3.5" r="1.3"/><circle cx="10.5" cy="3.5" r="1.3"/><circle cx="5.5" cy="8" r="1.3"/><circle cx="10.5" cy="8" r="1.3"/><circle cx="5.5" cy="12.5" r="1.3"/><circle cx="10.5" cy="12.5" r="1.3"/></g></svg>`;

/**
 * Fälligkeit als eigener Platz in der Zeile. Ein Klick aufs Kalendersymbol öffnet die
 * Datumsauswahl des Systems; die Wahl wird sofort gespeichert (mit Rückgängig).
 */
function dueSlot(kind: 'item' | 'project', id: string, due: string | null | undefined, editable = true): string {
  const st = due ? dueState(due) : 'none';
  const text = !due ? '' : st === 'today' ? 'Heute' : fmtDate(due);
  if (!editable) return `<span class="slot slot-due">${due ? `<span class="due due-${st}">${FLAG_SVG}<span>${text}</span></span>` : ''}</span>`;
  const label = !due ? 'Frist setzen' : `${st === 'overdue' ? 'Überfällig seit' : 'Fällig am'} ${fmtDate(due)}, ändern`;
  // .due-hit: Fahne und Datumsfeld gleich gross übereinander (auf iPad/iPhone trifft der Finger das Feld)
  return `<span class="slot slot-due"><span class="due-hit">
    <button type="button" class="due due-${st}" data-action="due-pick" data-kind="${kind}" data-id="${id}" title="${label}" aria-label="${label}">${FLAG_SVG}${text ? `<span>${text}</span>` : ''}</button>
    <input type="date" class="due-input" tabindex="-1" aria-hidden="true" data-kind="${kind}" data-id="${id}" value="${due ?? ''}">
  </span></span>`;
}

/**
 * Attribute einer Aufgabe in festen Plätzen, damit nichts verrutscht:
 * Kontext | Fällig | Erinnerung (Erst ab / Nachfassen) | Projekt und weitere.
 */
function meta(it: Item, opts: { project?: boolean; list?: boolean; clarify?: boolean } = {}): string {
  const open = isOpen(it) && it.list !== 'reference';
  // Inbox (0.13): kein Datum setzen, nur „Geklärt“ und „Klären“
  const due = open && !opts.clarify;
  // Kontext-Platz: Sanduhr bei „Warten auf“, sonst Kontext oder Fragezeichen
  const sym = itemSymbol(it);
  const ctx = sym === 'waiting' ? waitBadge(it.waitingFor) : sym === 'none' ? noneBadge() : sym ? ctxBadge(sym) : '';
  let rem = '';
  if (open && it.tickler) {
    // gleiche Box wie die Frist; Nachfassen nach Dringlichkeit gefärbt, „Erst ab“ neutral
    const waiting = it.list === 'waiting';
    const label = `${waiting ? 'Nachfassen am' : 'Erst ab'} ${fmtDate(it.tickler)}`;
    const st = waiting ? dueState(it.tickler) : 'later';
    const txt = waiting && st === 'today' ? 'Heute' : fmtDate(it.tickler);
    rem = `<span class="due rem rem-${waiting ? 'follow' : 'defer'} due-${st}" title="${label}" aria-label="${label}">${waiting ? BELL_SVG : MOON_SVG}<span>${txt}</span></span>`;
  }
  const rest: string[] = [];
  const p = project(it.projectId);
  if (p && opts.project !== false) rest.push(`<span class="chip proj"><i class="pdot" aria-hidden="true"></i>${esc(p.title)}</span>`);
  if (it.waitingFor) rest.push(`<span class="chip wait-chip">wartet auf ${esc(it.waitingFor)}</span>`);
  if (opts.list && it.list !== 'next') rest.push(`<span class="chip">${LIST_LABEL[it.list]}</span>`);
  if (it.repeat && isOpen(it)) rest.push(`<span class="rep-ico" title="Wiederholt sich: ${esc(repeatText(it.repeat))}">${REPEAT_SVG}<span class="sr-only">Wiederholt sich: ${esc(repeatText(it.repeat))}</span></span>`);
  if (it.notes && it.list !== 'reference') rest.push(`<span class="chip note-chip" title="Hat Notizen">Notiz</span><span class="note-ico" title="Hat Notizen" aria-hidden="true">${NOTE_SVG}</span>`);
  if (!due && !ctx && !rem && !rest.length) return '';
  return `<div class="row-meta">
    <span class="slot slot-ctx">${ctx}</span>${due ? dueSlot('item', it.id, it.due) : '<span class="slot slot-due"></span>'}<span class="slot slot-rem">${rem}</span><span class="slot slot-rest">${rest.join('')}</span>
  </div>`;
}

/**
 * Karte mit Wisch-Geste: Inhalt liegt in .row-inner, dahinter der Löschen-Knopf.
 * Nach links wischen legt den Knopf frei; Tippen legt die Aufgabe in den Papierkorb (mit Rückgängig).
 * Projekte und Einträge im Papierkorb haben keinen Löschen-Knopf (swipe = false).
 */
function card(cls: string, rowId: string, kind: 'item' | 'project', inner: string, swipe = true): string {
  return `<li class="${cls}" data-row="${rowId}">
    <div class="row-inner">${inner}</div>
    ${swipe ? `<button type="button" class="swipe-del" data-action="swipe-delete" data-kind="${kind}" data-id="${rowId}" tabindex="-1" aria-hidden="true">Löschen</button>` : ''}
  </li>`;
}

type RowOpts = { check?: boolean; clarify?: boolean; project?: boolean; list?: boolean; restore?: boolean; drag?: boolean; conflict?: boolean };
function row(it: Item, opts: RowOpts = {}): string {
  const lead = opts.check
    ? `<button class="check" data-action="complete" data-id="${it.id}" aria-label="Als erledigt markieren"></button>`
    : opts.restore
      ? `<button class="check is-done" data-action="restore" data-id="${it.id}" aria-label="Wiederherstellen" title="Wiederherstellen"></button>`
      : '';
  const p = opts.project !== false ? project(it.projectId) : undefined;
  return card(`row ${projColor(p?.id)}${opts.restore ? ' is-done' : ''}${opts.clarify && isStale(it) ? ' is-stale' : ''}`, it.id, 'item', `
    ${lead}
    <span class="row-badge" aria-hidden="true">${p ? esc(initials(p.title)) : ''}</span>
    <div class="row-main" data-action="edit" data-id="${it.id}">
      ${p ? `<span class="row-eyebrow">${esc(p.title)}</span>` : ''}
      <button type="button" class="row-title" data-action="edit" data-id="${it.id}">${esc(it.title) || '<em>Ohne Titel</em>'}</button>
      ${meta(it, opts)}
      ${it.list === 'reference' && it.notes ? `<span class="row-notes">${esc(it.notes.slice(0, 160))}</span>` : ''}
    </div>
    ${opts.clarify ? `<span class="inbox-btns"><button class="btn small" data-action="quick-done" data-id="${it.id}">Geklärt</button><button class="btn small" data-action="clarify" data-id="${it.id}">Klären</button></span>` : ''}
    ${opts.conflict ? `<button type="button" class="conflict-btn" data-action="conflict" data-id="${it.id}" aria-label="Frist-Konflikt: Erklärung anzeigen" title="Frist-Konflikt">${WARN_SVG}</button>` : ''}
    ${opts.drag ? `<button type="button" class="drag-handle" data-action="noop" data-drag="${it.id}" aria-label="Verschieben (Pfeiltasten oder ziehen)" title="Ziehen zum Verschieben">${GRIP_SVG}</button>` : ''}`);
}

/** Zeile für ein Projekt: Fällig | Status | Ergebnis */
/** Projekte lassen sich nicht wegwischen; Löschen nur in der Projektansicht (mit Bestätigung). */
function projectRow(p: Project, status: string, icon = false): string {
  return card(`row ${projColor(p.id)}`, p.id, 'project', `
    ${icon ? '<span class="row-icon" aria-hidden="true">P</span>' : ''}
    <div class="row-main" data-action="open-project" data-id="${p.id}">
      <button type="button" class="row-title proj-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button>
      <div class="row-meta proj-meta">
        ${dueSlot('project', p.id, p.due)}<span class="slot slot-status">${status}</span><span class="slot slot-rest"></span>
      </div>
      ${p.outcome ? `<p class="proj-outcome">${esc(p.outcome)}</p>` : ''}
    </div>`, false);
}

const list = (items: Item[], opts: RowOpts = {}) => `<ul class="rows">${items.map((i) => row(i, opts)).join('')}</ul>`;

const head = (title: string, lede: string, extra = '') =>
  `<header class="view-head"><div><h1>${title}</h1><p class="lede">${lede}</p></div>${extra}</header>`;

const empty = (title: string, text: string, extra = '') => `<div class="empty"><p class="empty-title">${title}</p><p>${text}</p>${extra}</div>`;

const LIST_LABEL: Record<ListName, string> = {
  inbox: 'Inbox', next: 'Nächster Schritt', waiting: 'Warten auf', someday: 'Irgendwann/Vielleicht',
  reference: 'Referenz', done: 'Erledigt', trash: 'Papierkorb',
};

function contextOptions(selected: string | null, none = 'Ohne Kontext') {
  return `<option value="">${none}</option>` +
    S.state.contexts.map((c) => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(ctxLabel(c))}</option>`).join('');
}
function projectOptions(selected: string | null) {
  return `<option value="">Kein Projekt</option>` +
    Q.projects('active').concat(Q.projects('someday')).map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.title)}</option>`).join('');
}

// ---------- Ansichten ----------

function viewInbox(): string {
  const inbox = Q.inbox();
  const back = Q.resurfaced();
  const n = inbox.length + back.length;
  const nothingYet = all().length === 0;
  return `
    ${head('Inbox', 'Alles raus aus dem Kopf. Jetzt erfassen, später entscheiden.')}
    <form class="capture" data-form="capture">
      <label class="sr-only" for="capture-input">Neuer Eintrag</label>
      <input id="capture-input" name="title" placeholder="Was beschäftigt dich gerade?" autocomplete="off" enterkeyhint="done">
      <button class="btn primary" type="submit">Erfassen</button>
    </form>
    ${n ? `<div class="callout"><span><strong class="num">${n}</strong> ${n === 1 ? 'Eintrag' : 'Einträge'} zu klären</span><button class="btn primary" data-action="clarify-first">Klären starten</button></div>` : ''}
    ${back.length ? `<h2 class="section">Wieder vorgelegt</h2>${list(back, { clarify: true })}` : ''}
    ${inbox.length ? `${back.length ? '<h2 class="section">Neu erfasst</h2>' : ''}${list(inbox, { clarify: true })}` : ''}
    ${!n ? empty(
      nothingYet ? 'Hier landet alles, was dir durch den Kopf geht.' : 'Inbox leer.',
      nothingYet
        ? 'Schreib oben auf, was dich beschäftigt, eine Idee pro Eintrag. Danach gehst du jeden Eintrag mit „Klären“ durch und entscheidest, was er bedeutet.'
        : 'Alles ist geklärt und an seinem Platz. Neues landet wieder hier.',
      nothingYet ? '<button class="btn" data-action="load-examples">Beispieleinträge laden</button>' : '',
    ) : ''}`;
}

function viewNext(): string {
  const items = Q.next();
  const used = S.state.contexts.filter((c) => items.some((i) => i.context === c));
  const hasNone = items.some((i) => !i.context);
  if (ctxFilter !== 'all' && ctxFilter !== '' && !used.includes(ctxFilter)) ctxFilter = 'all';
  const filterBtn = (val: string, label: string, n: number) =>
    `<button class="filter${ctxFilter === val ? ' is-active' : ''}" data-action="ctx" data-ctx="${esc(val)}" aria-pressed="${ctxFilter === val}">${esc(label)} <span class="num">${n}</span></button>`;
  // Kontext-Filter: Symbol (eigene Kontexte: Etikett und Name) und Anzahl
  const ctxBtn = (c: string, n: number) =>
    `<button class="filter filter-ctx${ctxFilter === c ? ' is-active' : ''}" data-action="ctx" data-ctx="${esc(c)}" aria-pressed="${ctxFilter === c}" title="${esc(ctxLabel(c))}">${ctxBadge(c)} <span class="num">${n}</span></button>`;
  const filters = `<div class="filters" role="toolbar" aria-label="Nach Kontext filtern">
    ${filterBtn('all', 'Alle', items.length)}
    ${used.map((c) => ctxBtn(c, items.filter((i) => i.context === c).length)).join('')}
    ${hasNone ? filterBtn('', 'Ohne Kontext', items.filter((i) => !i.context).length) : ''}
  </div>`;
  let body: string;
  if (!items.length) {
    body = empty('Keine nächsten Schritte.', 'Klär deine Inbox oder füg einem Projekt einen konkreten nächsten Schritt hinzu.');
  } else if (ctxFilter === 'all') {
    const groups = used.map((c) => [ctxWithName(c), items.filter((i) => i.context === c)] as const);
    if (hasNone) groups.push(['Ohne Kontext', items.filter((i) => !i.context)]);
    body = groups.map(([title, its]) => `<h2 class="section">${title}</h2>${list(its, { check: true })}`).join('');
  } else {
    body = list(items.filter((i) => (i.context ?? '') === ctxFilter), { check: true });
  }
  return `${head('Nächste Schritte', 'Wähle nach Ort, Werkzeug und Energie, was jetzt dran ist.')}${items.length ? filters : ''}${body}`;
}

function viewDue(): string {
  const its = Q.dueItems();
  // nur Aufgaben; Projekte mit Frist stehen in der Projektliste (0.10)
  if (!its.length) {
    return `${head('Fristen', 'Alles mit Fälligkeitsdatum, nach Dringlichkeit sortiert.')}
      ${empty('Keine Fristen.', 'Setz beim Klären oder Bearbeiten ein Datum unter „Fällig am“, dann erscheint der Eintrag hier.')}`;
  }
  const GROUPS: [string, (s: DueState) => boolean][] = [
    ['Überfällig', (s) => s === 'overdue'],
    ['Heute', (s) => s === 'today'],
    ['Nächste 7 Tage', (s) => s === 'soon' || s === 'week'],
    ['Später', (s) => s === 'later'],
  ];
  const body = GROUPS.map(([label, match]) => {
    const gi = its.filter((i) => match(dueState(i.due!)));
    if (!gi.length) return '';
    const rows = gi.map((i) => row(i, { check: i.list === 'next' || i.list === 'waiting', list: true }));
    return `<h2 class="section">${label} <span class="num">${gi.length}</span></h2><ul class="rows">${rows.join('')}</ul>`;
  }).join('');
  return `${head('Fristen', 'Alles mit Fälligkeitsdatum, nach Dringlichkeit sortiert. Harte Termine gehören laut Buch weiterhin in den Kalender.')}${body}`;
}

function viewProjects(): string {
  const ps = Q.projects('active').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'de'));
  const rows = ps.map((p) => {
    const its = Q.projectItems(p.id);
    const open = its.filter((i) => i.list === 'next' || i.list === 'waiting').length;
    const stalled = Q.stalled(p);
    return projectRow(p, stalled ? '<span class="chip warn">Kein nächster Schritt</span>' : `<span class="chip">${open} offen</span>`);
  }).join('');
  return `${head('Projekte', 'Alles, was mehr als einen Schritt braucht. Jedes aktive Projekt hat einen nächsten Schritt.',
    '<button class="btn" data-action="new-project">Neues Projekt</button>')}
    ${ps.length ? `<ul class="rows">${rows}</ul>` : empty('Noch keine Projekte.', 'Projekte entstehen meistens beim Klären der Inbox: Braucht etwas mehr als einen Schritt, wird es ein Projekt.')}`;
}

function viewProject(id: string): string {
  const p = project(id);
  if (!p) return empty('Projekt nicht gefunden.', '', '<button class="btn" data-action="go" data-view="projects">Zu den Projekten</button>');
  const its = Q.projectItems(id);
  const next = its.filter((i) => i.list === 'next');
  const waiting = its.filter((i) => i.list === 'waiting');
  const other = its.filter((i) => i.list === 'someday' || i.list === 'reference');
  const done = its.filter((i) => i.list === 'done');
  const STATUS: Record<Project['status'], string> = { active: 'Aktiv', someday: 'Irgendwann/Vielleicht', done: 'Abgeschlossen', dropped: 'Verworfen' };
  const closed = p.status === 'done' || p.status === 'dropped';
  const back = p.status === 'someday' ? ['someday', 'Irgendwann/Vielleicht'] : closed ? ['done', 'Erledigt'] : ['projects', 'Projekte'];
  return `
    <button class="back" data-action="go" data-view="${back[0]}">← ${back[1]}</button>
    <header class="view-head ${projColor(p.id)}">
      <div>
        <h1 class="proj-title">${esc(p.title)}</h1>
        <p class="lede">${p.outcome ? `<span class="label">Ergebnis</span> ${esc(p.outcome)}` : 'Noch kein gewünschtes Ergebnis beschrieben.'}</p>
        ${p.due && (p.status === 'active' || p.status === 'someday') ? `<p class="head-meta">${dueChip(p.due)}</p>` : ''}
      </div>
      <div class="head-side">
        <button type="button" class="btn small color-btn" data-action="pick-color" data-id="${p.id}" aria-label="Projektfarbe wählen"><i class="swatch-dot" aria-hidden="true"></i>Farbe</button>
        <span class="pill status-${p.status}">${STATUS[p.status]}</span>
      </div>
    </header>
    ${p.status === 'active' && Q.stalled(p) ? '<div class="callout warn">Dieses Projekt hat keinen nächsten Schritt. Was ist die nächste sichtbare, physische Handlung?</div>' : ''}
    ${p.status === 'active' || p.status === 'someday' ? `
    <form class="capture compact" data-form="project-step" data-id="${p.id}">
      <label class="sr-only" for="step-input">Nächster Schritt</label>
      <input id="step-input" name="title" placeholder="Nächster Schritt, z. B. „Offerte bei Maler anfragen“" autocomplete="off" required>
      <span class="step-due">
        <button type="button" class="btn step-due-btn" data-action="step-due-pick" aria-label="Frist wählen" title="Frist wählen">${FLAG_SVG}<span class="step-due-text"></span></button>
        <input type="date" id="step-due" name="due" class="step-due-input" tabindex="-1" aria-label="Frist">
      </span>
      <label class="sr-only" for="step-ctx">Kontext</label>
      <select id="step-ctx" name="context">${contextOptions(null)}</select>
      <button class="btn primary" type="submit">Hinzufügen</button>
    </form>` : ''}
    ${next.length ? `<h2 class="section">Nächste Schritte</h2>${stepList(p, next)}` : ''}
    ${waiting.length ? `<h2 class="section">Warten auf</h2>${list(waiting, { check: true, project: false })}` : ''}
    ${other.length ? `<h2 class="section">Weiteres</h2>${list(other, { project: false, list: true })}` : ''}
    ${done.length ? `<h2 class="section">Erledigt</h2>${list(done, { restore: true, project: false })}` : ''}
    <div class="actions-row">
      <button class="btn" data-action="edit-project" data-id="${p.id}">Bearbeiten</button>
      ${p.status === 'active' ? `<button class="btn" data-action="project-status" data-id="${p.id}" data-status="someday">Auf Irgendwann verschieben</button>
        <button class="btn" data-action="close-project" data-id="${p.id}">Abschliessen</button>` : ''}
      ${p.status !== 'active' ? `<button class="btn" data-action="project-status" data-id="${p.id}" data-status="active">Aktivieren</button>` : ''}
      <button class="btn danger" data-action="delete-project" data-id="${p.id}">Projekt löschen</button>
    </div>`;
}

/** Schritte eines Projekts: verschiebbar, mit Warnung bei Konflikten mit Fristen */
function stepList(p: Project, next: Item[]): string {
  const conflicts = orderConflicts(next);
  return `<ul class="rows sortable" data-sortable="${p.id}">${next.map((i) => row(i, {
    check: true, project: false, drag: next.length > 1, conflict: conflicts.has(i.id),
  })).join('')}</ul>`;
}

/** Erklärung zum Warndreieck */
function conflictHtml(id: string): string {
  const it = S.state.items.get(id);
  const p = project(it?.projectId ?? null);
  if (!it || !p) return '';
  const above = orderConflicts(Q.projectItems(p.id).filter((i) => i.list === 'next')).get(id) ?? [];
  return `
    <div class="sheet">
      <div class="sheet-head"><h2>Reihenfolge und Frist passen nicht</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <p><strong>${esc(it.title)}</strong> ist am <strong>${fmtDate(it.due ?? null)}</strong> fällig, steht aber hinter ${above.length === 1 ? 'einem Schritt' : `${above.length} Schritten`} mit späterer Frist:</p>
      <ul class="conflict-list">${above.map((o) => `<li>${esc(o.title)} <span class="muted">· fällig ${fmtDate(o.due ?? null)}</span></li>`).join('')}</ul>
      <p class="hint">Deine Reihenfolge gilt. Zieh ihn nach oben, wenn er zuerst dran ist, oder lass es so, wenn die Reihenfolge Absicht ist.</p>
      <div class="actions-row spread">
        <button type="button" class="btn" data-action="order-by-due" data-id="${p.id}">Ganzes Projekt nach Frist sortieren</button>
        <button type="button" class="btn primary" data-action="close">Verstanden</button>
      </div>
    </div>`;
}

function viewWaiting(): string {
  const its = Q.waiting();
  return `${head('Warten auf', 'Was andere für dich erledigen. Fass nach, wenn das Datum erreicht ist.')}
    ${its.length ? list(its, { check: true }) : empty('Du wartest auf niemanden.', 'Delegierte Aufgaben landen hier, mit Person und Datum zum Nachfassen.')}`;
}

function viewTickler(): string {
  const its = Q.tickler();
  return `${head('Wiedervorlage', 'Was erst ab einem bestimmten Tag wichtig wird. Bis dahin bleibt es aus dem Weg.')}
    ${its.length ? list(its, { list: true }) : empty('Nichts auf Wiedervorlage.', 'Setz beim Klären oder Bearbeiten ein Datum unter „Erst ab“, dann taucht der Eintrag an diesem Tag wieder auf.')}`;
}

function viewSomeday(): string {
  const its = Q.someday();
  const ps = Q.projects('someday');
  return `${head('Irgendwann/Vielleicht', 'Ideen und Wünsche ohne Verpflichtung. Schau sie bei der Wochendurchsicht an.')}
    ${ps.length ? `<h2 class="section">Projekte</h2><ul class="rows">${ps.map((p) => card(`row ${projColor(p.id)}`, p.id, 'project', `
        <div class="row-main" data-action="open-project" data-id="${p.id}"><button type="button" class="row-title proj-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button>${p.outcome ? `<p class="proj-outcome">${esc(p.outcome)}</p>` : ''}</div>
        <button class="btn small" data-action="project-status" data-id="${p.id}" data-status="active">Aktivieren</button>`)).join('')}</ul>` : ''}
    ${its.length ? `${ps.length ? '<h2 class="section">Einzelne Ideen</h2>' : ''}${list(its)}` : ''}
    ${!its.length && !ps.length ? empty('Noch leer.', 'Beim Klären kannst du alles, was nicht jetzt dran ist, hierher schieben.') : ''}`;
}

function viewReference(): string {
  const its = Q.reference();
  return `${head('Referenz', 'Nützliches ohne Handlung: Informationen, Notizen, Nachschlagbares.')}
    ${its.length ? list(its) : empty('Keine Referenzen.', 'Beim Klären landet hier, was du aufbewahren willst, aber nicht tun musst.')}`;
}

function viewDone(): string {
  const its = Q.done();
  const trash = Q.trash();
  const shown = its.slice(0, 100);
  const doneP = Q.closedProjects('done');
  const dropped = Q.closedProjects('dropped');
  const oldP = Q.trashedProjects();
  // Abgeschlossene Projekte als eine Karte (0.12); ein Klick zeigt die Aufgaben in der Projektansicht
  const pcard = (p: Project, label: string) => {
    const n = all().filter((i) => i.projectId === p.id).length;
    return card(`row ${projColor(p.id)}`, p.id, 'project', `
      <div class="row-main" data-action="open-project" data-id="${p.id}">
        <button type="button" class="row-title proj-title" data-action="open-project" data-id="${p.id}">${esc(p.title)}</button>
        <div class="row-meta proj-meta"><span class="chip">${label}${p.completed ? ` ${fmtTs(p.completed)}` : ''}</span><span class="chip">${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'}</span></div>
      </div>`, false);
  };
  const anyProjects = doneP.length + dropped.length > 0;
  return `${head('Erledigt', 'Was du abgeschlossen hast. Ein Klick auf den Haken holt einen Eintrag zurück.')}
    ${doneP.length ? `<h2 class="section">Abgeschlossene Projekte <span class="num">${doneP.length}</span></h2><ul class="rows">${doneP.map((p) => pcard(p, 'abgeschlossen')).join('')}</ul>` : ''}
    ${anyProjects && its.length ? '<h2 class="section">Einzelne Aufgaben</h2>' : ''}
    ${its.length ? list(shown, { restore: true }) : anyProjects ? '' : empty('Noch nichts erledigt.', 'Abgehakte Schritte sammeln sich hier.')}
    ${its.length > shown.length ? `<p class="hint">Die letzten ${shown.length} von ${its.length} werden angezeigt.</p>` : ''}
    ${dropped.length ? `<h2 class="section">Verworfene Projekte <span class="num">${dropped.length}</span></h2><ul class="rows">${dropped.map((p) => pcard(p, 'verworfen')).join('')}</ul>` : ''}
    ${trash.length || oldP.length ? `<h2 class="section">Papierkorb <span class="num">${trash.length + oldP.length}</span></h2>
      ${oldP.length ? `<ul class="rows">${oldP.map((p) => pcard(p, p.status === 'done' ? 'abgeschlossen' : 'verworfen')).join('')}</ul>` : ''}
      ${trash.length ? `<ul class="rows">${trash.map((i) => card('row is-done', i.id, 'item', `
        <div class="row-main" data-action="edit" data-id="${i.id}"><button type="button" class="row-title" data-action="edit" data-id="${i.id}">${esc(i.title)}</button></div>
        <button class="btn small" data-action="restore" data-id="${i.id}">Zurückholen</button>`, false)).join('')}</ul>` : ''}
      <p class="hint">Was seit über 30 Tagen erledigt ist, liegt automatisch hier.</p>
      <div class="actions-row"><button class="btn danger" data-action="empty-trash">Papierkorb leeren</button></div>` : ''}`;
}

let syncSetup: { owner: string; repo: string; token: string; probe: Sync.Probe } | null = null;
let syncDraft = { owner: '', repo: 'head-space-data', token: '' };

const TOKEN_HELP = `<details class="help">
  <summary>So erstellst du das Token</summary>
  <ol>
    <li>Auf github.com: Profilbild → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
    <li>Name z. B. „Kopf frei Sync“, Ablaufdatum nach Wunsch (läuft es ab, meldet die App das).</li>
    <li><b>Repository access:</b> „Only select repositories“ → nur dein Daten-Repository wählen.</li>
    <li><b>Permissions → Repository permissions → Contents:</b> „Read and write“. Sonst nichts.</li>
    <li>Token erzeugen, kopieren und hier einfügen. Es wird nur auf diesem Gerät gespeichert.</li>
  </ol>
</details>`;

function syncPanel(): string {
  const st = Sync.status;
  const headTxt = '<h2>Synchronisation über GitHub</h2>';
  if (IS_TEST) {
    return `<section class="panel" id="sync">${headTxt}
      <p class="hint">In der Test-App ist die Synchronisation abgeschaltet. So können Test-Daten nie in dein echtes Daten-Repository gelangen.</p>
    </section>`;
  }
  if (st.state === 'off' && !syncSetup) {
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="hint">Hält deine Geräte auf dem gleichen Stand. Die Daten liegen in einem privaten GitHub-Repository, aber nur verschlüsselt. Ohne deine Passphrase kann niemand sie lesen, auch GitHub nicht.</p>
      <form class="stack" data-form="sync-probe">
        <div class="grid2">
          <div class="field"><label for="sync-owner">GitHub-Benutzername</label><input id="sync-owner" name="owner" value="${esc(syncDraft.owner)}" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
          <div class="field"><label for="sync-repo">Privates Daten-Repository</label><input id="sync-repo" name="repo" value="${esc(syncDraft.repo)}" autocapitalize="off" spellcheck="false" required></div>
        </div>
        <div class="field"><label for="sync-token">Zugangs-Token</label><input id="sync-token" name="token" type="password" value="${esc(syncDraft.token)}" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required></div>
        ${TOKEN_HELP}
        <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Prüfe …' : 'Weiter'}</button>
      </form>
    </section>`;
  }
  if (st.state === 'off' && syncSetup) {
    const fresh = !syncSetup.probe.header;
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="status-line">Repository <strong>${esc(syncSetup.probe.fullName)}</strong> gefunden (privat).</p>
      <form class="stack" data-form="sync-connect">
        ${fresh ? `
          <p class="hint">Das Repository ist noch leer. Leg eine <b>Sync-Passphrase</b> fest. Du brauchst sie auf jedem weiteren Gerät. Geht sie verloren, sind die Daten im Repository nicht mehr lesbar. Bewahr sie im Passwortmanager auf.</p>
          <div class="field"><label for="sync-pass1">Neue Sync-Passphrase</label><input id="sync-pass1" name="pass1" type="password" minlength="10" autocomplete="new-password" required></div>
          <div class="field"><label for="sync-pass2">Passphrase wiederholen</label><input id="sync-pass2" name="pass2" type="password" minlength="10" autocomplete="new-password" required></div>
          <p class="hint">Was schon auf diesem Gerät ist, wird danach hochgeladen.</p>` : `
          <p class="hint">Dieses Repository wird schon von einem anderen Gerät genutzt. Gib die Sync-Passphrase ein, die du dort festgelegt hast. Einträge von diesem Gerät werden mit denen im Repository zusammengeführt.</p>
          <div class="field"><label for="sync-pass1">Sync-Passphrase</label><input id="sync-pass1" name="pass1" type="password" autocomplete="current-password" required></div>`}
        <div class="actions-row">
          <button type="button" class="btn" data-action="sync-back">Zurück</button>
          <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Verbinde …' : 'Verbinden'}</button>
        </div>
      </form>
    </section>`;
  }
  if (st.state === 'locked') {
    return `<section class="panel" id="sync">
      ${headTxt}
      <p class="hint">Der Schlüssel fehlt auf diesem Gerät. Gib die Sync-Passphrase erneut ein.</p>
      <form class="stack" data-form="sync-unlock">
        <div class="field"><label for="sync-unlock-pass">Sync-Passphrase</label><input id="sync-unlock-pass" name="pass" type="password" autocomplete="current-password" required></div>
        <div class="actions-row"><button class="btn primary" type="submit"${busy ? ' disabled' : ''}>Entsperren</button><button type="button" class="btn" data-action="sync-disconnect">Verbindung trennen</button></div>
      </form>
    </section>`;
  }
  const STATE: Record<Sync.SyncState, string> = {
    off: '', locked: '', idle: 'Aktuell', syncing: 'Synchronisiere …', error: 'Fehler', offline: 'Offline',
  };
  return `<section class="panel" id="sync">
    ${headTxt}
    <dl class="facts">
      <dt>Status</dt><dd><span class="sync-pill sync-${st.state} static"><i aria-hidden="true"></i><span>${STATE[st.state]}</span></span></dd>
      <dt>Repository</dt><dd class="mono">${esc(st.repo)}</dd>
      <dt>Zuletzt</dt><dd>${ago(st.last)}</dd>
    </dl>
    ${st.error && st.state !== 'idle' ? `<div class="callout warn">${esc(st.error)}</div>` : ''}
    <p class="hint">Änderungen werden nach wenigen Sekunden hochgeladen. Beim Öffnen der App holt sie die Änderungen der anderen Geräte.</p>
    <div class="actions-row">
      <button class="btn primary" data-action="sync-now"${st.state === 'syncing' ? ' disabled' : ''}>Jetzt synchronisieren</button>
      <button class="btn" data-action="sync-disconnect">Verbindung trennen</button>
    </div>
  </section>`;
}

function viewSettings(): string {
  const lb = S.info.lastBackup;
  const theme = getTheme();
  const themeBtn = (t: Theme, label: string) =>
    `<button type="button" class="seg${theme === t ? ' is-active' : ''}" data-action="theme" data-value="${t}" aria-pressed="${theme === t}">${label}</button>`;
  const testPanel = IS_TEST ? `
    <section class="panel env-panel">
      <h2>Test-Umgebung</h2>
      <p class="hint">Hier probierst du neue Versionen mit Beispieldaten aus. Diese App hat eigene, getrennte Daten und synchronisiert nicht. Deine echte App bleibt unberührt.</p>
      <div class="actions-row">
        <button class="btn" data-action="sample-add">Beispieldaten hinzufügen</button>
        <button class="btn danger" data-action="test-reset">Test-App zurücksetzen</button>
      </div>
    </section>` : '';
  return `${head('Einstellungen', 'Darstellung, Kontexte, Synchronisation und Datensicherung.')}
    ${testPanel}
    <section class="panel">
      <h2>Darstellung</h2>
      <p class="hint">Gilt für dieses Gerät.</p>
      <div class="segmented" role="group" aria-label="Hell oder dunkel">
        ${themeBtn('system', 'Wie System')}${themeBtn('light', 'Hell')}${themeBtn('dark', 'Dunkel')}
      </div>
    </section>
    <section class="panel">
      <h2>Kontexte</h2>
      <p class="hint">Kontexte beschreiben, wo oder womit du etwas tun kannst. So siehst du unterwegs nur, was unterwegs geht.</p>
      <ul class="ctx-list">${S.state.contexts.map((c) => `<li>${ctxWithName(c)}
        <button class="link" data-action="remove-ctx" data-ctx="${esc(c)}" aria-label="${esc(ctxLabel(c))} entfernen">Entfernen</button></li>`).join('')}</ul>
      <form class="capture compact" data-form="add-ctx">
        <label class="sr-only" for="ctx-input">Neuer Kontext</label>
        <input id="ctx-input" name="name" placeholder="z. B. Einkaufen" autocomplete="off" required>
        <button class="btn" type="submit">Hinzufügen</button>
      </form>
    </section>

    ${syncPanel()}

    <section class="panel">
      <h2>Verschlüsseltes Backup</h2>
      <p class="hint">Das Backup wird hier im Gerät mit deiner Passphrase verschlüsselt (AES-256-GCM). Ohne Passphrase ist die Datei unlesbar, auch für dich. Bewahr die Passphrase sicher auf, z. B. im Passwortmanager.</p>
      <p class="status-line">${lb ? `Letztes Backup: <strong>${new Date(lb).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })}</strong>` : '<strong>Noch kein Backup erstellt.</strong>'}</p>
      <form class="stack" data-form="export">
        <div class="field"><label for="pass1">Passphrase</label><input id="pass1" name="pass1" type="password" minlength="10" autocomplete="new-password" required></div>
        <div class="field"><label for="pass2">Passphrase wiederholen</label><input id="pass2" name="pass2" type="password" minlength="10" autocomplete="new-password" required></div>
        <button class="btn primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Verschlüssele …' : 'Backup erstellen'}</button>
      </form>
      ${backupText ? `<div class="backup-out">
        <p>Backup erstellt. Speichere die Datei an einem sicheren Ort.</p>
        <div class="actions-row">
          <button class="btn primary" data-action="download-backup">Datei speichern</button>
          <button class="btn" data-action="copy-backup">Als Text kopieren</button>
        </div>
        <label class="sr-only" for="backup-text">Verschlüsseltes Backup</label>
        <textarea id="backup-text" readonly rows="3">${esc(backupText)}</textarea>
      </div>` : ''}
      <h3>Wiederherstellen</h3>
      <p class="hint">Einträge aus dem Backup werden mit den Daten auf diesem Gerät zusammengeführt. Nichts wird überschrieben.</p>
      <form class="stack" data-form="import">
        <div class="field"><label for="import-file">Backup-Datei</label><input id="import-file" name="file" type="file" accept=".json,.kfbackup,application/json"></div>
        <details><summary>Stattdessen Text einfügen</summary>
          <div class="field"><label for="import-text">Backup als Text</label><textarea id="import-text" name="text" rows="3"></textarea></div>
        </details>
        <div class="field"><label for="import-pass">Passphrase</label><input id="import-pass" name="pass" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit"${busy ? ' disabled' : ''}>Wiederherstellen</button>
      </form>
    </section>

    <section class="panel" id="restore">
      <h2>Zurück auf früheren Stand</h2>
      <p class="hint">Falls ein Update oder eine Änderung etwas durcheinandergebracht hat. Es wird nichts gelöscht: Die App stellt den alten Stand mit neuen Änderungen wieder her. Auch das lässt sich wieder rückgängig machen.</p>
      <ul class="restore-list" id="restore-list"><li class="hint">Wird geladen …</li></ul>
      <form class="inline-form" data-form="restore-custom">
        <div class="field"><label for="restore-when">Eigener Zeitpunkt</label><input id="restore-when" name="when" type="datetime-local" required></div>
        <button class="btn" type="submit">Zu diesem Zeitpunkt</button>
      </form>
    </section>

    <section class="panel">
      <h2>Speicher</h2>
      <dl class="facts">
        <dt>Speicherort</dt><dd>${S.info.persistent ? 'Dieses Gerät (IndexedDB)' : '<span class="warn-text">Nur Arbeitsspeicher, Daten gehen beim Schliessen verloren</span>'}</dd>
        <dt>Geschützt vor automatischem Löschen</dt><dd id="persist-state">wird geprüft …</dd>
        <dt>Gespeicherte Änderungen</dt><dd class="num">${S.info.eventCount.toLocaleString('de-CH')}</dd>
        <dt>Geräte-ID</dt><dd class="mono">${esc(S.info.device.slice(0, 8))}</dd>
        <dt>App-Version</dt><dd class="num">${esc(APP_VERSION)}${APP_BUILD ? ` <span class="hint">(Build ${esc(APP_BUILD)})</span>` : ''}</dd>
      </dl>
      <div class="actions-row">
        <button class="btn" data-action="check-update">Nach Updates suchen</button>
        <button class="btn" data-action="repair-app">App reparieren</button>
      </div>
      <p class="hint">„App reparieren“ lädt die App frisch vom Server, falls ein Update hängen geblieben ist. Deine Daten bleiben erhalten.</p>
    </section>`;
}

// ---------- Darstellung (pro Gerät) ----------

export type Theme = 'system' | 'light' | 'dark';
const THEME_COLORS = { light: '#fdf6e3', dark: '#002b36' };

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(storageKey('kf-theme'));
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const mediaDark = (m.media || '').includes('dark');
    m.content = t === 'system' ? THEME_COLORS[mediaDark ? 'dark' : 'light'] : THEME_COLORS[t];
  });
}

function setTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem(storageKey('kf-theme')); else localStorage.setItem(storageKey('kf-theme'), t); } catch { /* nur für diese Sitzung */ }
  applyTheme(t);
  render();
}

// ---------- Modale Dialoge ----------

function renderModal() {
  const root = document.getElementById('modal')!;
  if (!modal) {
    root.hidden = true; root.innerHTML = ''; document.body.classList.remove('has-modal');
    return;
  }
  root.hidden = false;
  document.body.classList.add('has-modal');
  let html = '';
  if (modal.kind === 'clarify') html = clarifyHtml(modal);
  else if (modal.kind === 'edit') html = editHtml(modal.id);
  else if (modal.kind === 'project') html = projectFormHtml(modal.id);
  else if (modal.kind === 'capture') html = `
    <form class="sheet" data-form="quick-capture">
      <div class="sheet-head"><h2>In die Inbox</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <label class="sr-only" for="quick-input">Neuer Eintrag</label>
      <div class="capture compact">
        <input id="quick-input" name="title" placeholder="Was beschäftigt dich?" autocomplete="off" required enterkeyhint="done">
      </div>
      <div class="actions-row end"><button class="btn primary" type="submit">Erfassen</button></div>
    </form>`;
  else if (modal.kind === 'next-step') html = nextStepHtml(modal.projectId, modal.fromId);
  else if (modal.kind === 'due') html = dueHtml(modal.id, modal.target);
  else if (modal.kind === 'conflict') html = conflictHtml(modal.id);
  else if (modal.kind === 'color') html = colorHtml(modal.id);
  else if (modal.kind === 'close-project') html = closeProjectHtml(modal.id);
  else if (modal.kind === 'reopen') html = reopenHtml(modal.id);
  else if (modal.kind === 'notes') html = notesHtml(modal.notes);
  else if (modal.kind === 'quick') html = quickHtml(modal.id);
  else if (modal.kind === 'confirm') html = `
    <div class="sheet">
      <p>${esc(modal.text)}</p>
      <div class="actions-row end"><button class="btn" data-action="close">Abbrechen</button><button class="btn danger" data-action="confirm">${esc(modal.label)}</button></div>
    </div>`;
  root.innerHTML = `<div class="scrim" data-action="close"></div><div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
  // Datumsfelder nie automatisch fokussieren: iPad und Android öffnen sonst sofort den Kalender
  const first = root.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=date]):not([type=datetime-local]), button.primary');
  first?.focus();
}

/**
 * „Wiederholen“ (0.14, Variante A): Schalter, Reiter Wöchentlich/Monatlich/Jährlich, Wochentage zum Antippen.
 * Die Regel steht als JSON im versteckten Feld „repeat“ (leer = nicht wiederholen).
 */
function repeatBox(rule: Repeat | null, base: string): string {
  return `<div class="field repeat-box" data-repeat-box data-base="${base}">${repeatInner(rule)}</div>`;
}
function repeatInner(rule: Repeat | null): string {
  const on = !!rule;
  const seg = (k: Repeat['kind'], label: string) => `<button type="button" class="seg-btn" data-action="repeat-kind" data-kind="${k}" aria-pressed="${rule?.kind === k}">${label}</button>`;
  const days = (sel: number, id: string, field: string) => `<select id="${id}" data-repeat-field="${field}">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${sel === i + 1 ? ' selected' : ''}>${i + 1}.</option>`).join('')}</select>`;
  let body = '';
  if (rule?.kind === 'week') body = `<div class="wdays" role="group" aria-label="Wochentage">${WEEKDAYS.map((d, i) =>
    `<button type="button" class="wday" data-action="repeat-day" data-day="${i}" aria-pressed="${rule.days.includes(i)}">${d}</button>`).join('')}</div>`;
  if (rule?.kind === 'month') body = `<div class="repeat-inline"><label for="rep-day">Jeden Monat am</label>${days(rule.day, 'rep-day', 'day')}</div>`;
  if (rule?.kind === 'year') body = `<div class="repeat-inline"><label for="rep-yday">Jedes Jahr am</label>${days(rule.day, 'rep-yday', 'day')}
    <label class="sr-only" for="rep-month">Monat</label><select id="rep-month" data-repeat-field="month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${rule.month === i + 1 ? ' selected' : ''}>${new Date(2000, i, 1).toLocaleDateString('de-CH', { month: 'long' })}</option>`).join('')}</select></div>`;
  const sum = rule ? (validRepeat(rule) ? `${esc(repeatText(rule))} · sichtbar ${rule.kind === 'week' ? '7 Tage' : '1 Monat'} vorher` : 'Wähl mindestens einen Wochentag.') : '';
  return `<input type="hidden" name="repeat" value="${esc(rule ? JSON.stringify(rule) : '')}">
    <div class="repeat-head"><span class="field-label" id="rep-label">Wiederholen</span>
      <button type="button" class="switch" role="switch" aria-checked="${on}" aria-labelledby="rep-label" data-action="repeat-toggle"></button></div>
    ${on ? `<div class="rep-seg" role="group" aria-label="Wie oft">${seg('week', 'Wöchentlich')}${seg('month', 'Monatlich')}${seg('year', 'Jährlich')}</div>${body}<p class="repeat-sum">${sum}</p>` : ''}`;
}
function readRepeat(box: Element): Repeat | null {
  const v = box.querySelector<HTMLInputElement>('input[name=repeat]')?.value;
  try { return v ? JSON.parse(v) as Repeat : null; } catch { return null; }
}
function setRepeat(box: HTMLElement, rule: Repeat | null) { box.innerHTML = repeatInner(rule); }
function defaultRepeat(kind: Repeat['kind'], base: string): Repeat {
  const d = new Date(base + 'T00:00:00');
  if (kind === 'week') return { kind, days: [weekday(base)] };
  if (kind === 'month') return { kind, day: d.getDate() };
  return { kind, month: d.getMonth() + 1, day: d.getDate() };
}
/** Regel aus dem Formular; „bad“, wenn eingeschaltet, aber unvollständig (keine Wochentage) */
function formRepeat(form: HTMLFormElement): Repeat | null | 'bad' {
  const box = form.querySelector('[data-repeat-box]');
  if (!box) return null;
  const r = readRepeat(box);
  if (!r) return null;
  return validRepeat(r) ? r : 'bad';
}

/** Kontext als Symbole zum Antippen (Klären, 0.13); Wert im versteckten Feld „context“ */
function ctxChips(selected: string | null): string {
  return `<div class="field"><span class="field-label">Kontext</span>
    <input type="hidden" name="context" value="${esc(selected ?? '')}">
    <div class="ctx-chips" role="group" aria-label="Kontext">${S.state.contexts.map((c) =>
      `<button type="button" class="ctx-chip" data-action="clarify-ctx" data-ctx="${esc(c)}" aria-pressed="${c === selected}" title="${esc(ctxLabel(c))}" aria-label="${esc(ctxLabel(c))}">${ctxIcon(c, 22)}</button>`).join('')}</div>
    <span class="ctx-chip-name">${selected ? esc(ctxLabel(selected)) : 'Ohne Kontext'}</span></div>`;
}

/** „Geklärt“ in der Inbox (0.13): schon erledigt oder löschen */
function quickHtml(id: string): string {
  const it = S.state.items.get(id);
  if (!it) return '';
  return `
    <div class="sheet">
      <div class="sheet-head"><h2>Geklärt</h2><button type="button" class="link" data-action="close">Abbrechen</button></div>
      <p><strong>${esc(it.title)}</strong></p>
      <div class="stack-btns">
        <button type="button" class="btn primary" data-action="quick-go" data-id="${it.id}" data-to="done">Schon erledigt</button>
        <button type="button" class="btn" data-action="quick-go" data-id="${it.id}" data-to="trash">Löschen</button>
      </div>
      <p class="hint">„Schon erledigt“ legt die Aufgabe unter „Erledigt“ ab, „Löschen“ in den Papierkorb.</p>
    </div>`;
}

function clarifyHtml(m: Extract<Modal, { kind: 'clarify' }>): string {
  const it = S.state.items.get(m.id);
  if (!it) return '';
  const queue = toClarify();
  const pos = queue.findIndex((i) => i.id === m.id) + 1;
  const tile = (action: string, val: string, on: boolean, title: string, sub: string, wide = false) =>
    `<button type="button" class="tile${wide ? ' wide' : ''}" data-action="${action}" data-val="${val}" aria-pressed="${on}"><strong>${title}</strong><span>${sub}</span></button>`;
  const dateField = (id: string, name: string, label: string, value = '') =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="date" min="${today()}" value="${value}"></div>`;
  let body = '';
  if (m.step === 'actionable') {
    body = `<h3 class="question">Ist das umsetzbar?</h3><p class="hint">Musst oder willst du dazu etwas tun?</p>
      <div class="choice">
        <button class="btn primary choice-btn" data-action="step" data-step="yes">Ja</button>
        <button class="btn choice-btn" data-action="step" data-step="not">Nein</button>
      </div>`;
  } else if (m.step === 'not') {
    const LABEL: Record<NotGoal, string> = { trash: 'Wegwerfen', ref: 'Als Referenz ablegen', some: 'Ablegen' };
    body = `<h3 class="question">Was soll damit passieren?</h3>
      <form class="stack" data-form="clarify-not">
        <div class="tiles">
          ${tile('clarify-not', 'trash', m.not === 'trash', 'Wegwerfen', 'Brauchst du nicht mehr.', true)}
          ${tile('clarify-not', 'ref', m.not === 'ref', 'Referenz', 'Information, keine Handlung.', true)}
          ${tile('clarify-not', 'some', m.not === 'some', 'Irgendwann/Vielleicht', 'Vielleicht später, optional wieder vorlegen.', true)}
        </div>
        ${m.not === 'some' ? `<div class="expand">${dateField('someday-date', 'tickler', 'Wieder vorlegen am (optional)')}</div>` : ''}
        <div class="actions-row end"><button class="btn primary" type="submit"${m.not ? '' : ' disabled'}>${m.not ? LABEL[m.not] : 'Ziel wählen'}</button></div>
      </form>`;
  } else {
    const g = m.goal;
    let more = '';
    if (g === 'done') more = '<p class="hint">Unter zwei Minuten: gleich erledigen, dann hier bestätigen.</p>';
    if (g === 'next') more = `${ctxChips(m.ctx ?? it.context ?? null)}
      <div class="grid2">${dateField('n-due', 'due', 'Fällig am (optional)', it.due ?? '')}${dateField('n-tickler', 'tickler', 'Erst ab (optional)')}</div>
      <div class="field"><label for="n-proj">Gehört zu Projekt</label><select id="n-proj" name="projectId">${projectOptions(it.projectId)}</select></div>
      ${repeatBox(it.repeat ?? null, it.due ?? today())}`;
    if (g === 'deleg') more = `<div class="field"><label for="d-who">An wen?</label><input id="d-who" name="who" placeholder="Name" required></div>
      <div class="grid2">${dateField('d-due', 'due', 'Fällig am (optional)', it.due ?? '')}${dateField('d-date', 'tickler', 'Nachfassen am (optional)')}</div>`;
    if (g === 'proj') more = `<div class="field"><label for="p-outcome">Gewünschtes Ergebnis</label><input id="p-outcome" name="outcome" placeholder="Woran erkennst du, dass es fertig ist?"></div>
      <div class="field"><label for="p-next">Erster Schritt</label><input id="p-next" name="next" placeholder="Die nächste sichtbare Handlung" required></div>`;
    const SAVE: Record<Goal, string> = { done: 'Erledigt', next: 'Als nächsten Schritt ablegen', deleg: 'Zu „Warten auf“', proj: 'Projekt anlegen' };
    body = `<h3 class="question">Wohin gehört es?</h3>
      <form class="stack" data-form="clarify-yes">
        <div class="tiles">
          ${tile('clarify-goal', 'done', g === 'done', 'Erledigt', 'Unter 2 Min., gleich gemacht')}
          ${tile('clarify-goal', 'next', g === 'next', 'Nächster Schritt', 'Ich mache es')}
          ${tile('clarify-goal', 'deleg', g === 'deleg', 'Delegieren', 'Jemand anderes macht es')}
          ${tile('clarify-goal', 'proj', g === 'proj', 'Projekt', 'Braucht mehrere Schritte')}
        </div>
        ${g ? `<div class="expand">${more}</div>` : ''}
        <div class="actions-row end"><button class="btn primary" type="submit"${g ? '' : ' disabled'}>${g ? SAVE[g] : 'Ziel wählen'}</button></div>
      </form>`;
  }
  return `
    <div class="sheet card">
      <div class="sheet-head">
        <span class="eyebrow">Klären${m.series && pos > 0 ? ` · <span class="num">${pos}</span> von <span class="num">${queue.length}</span>` : ''}</span>
        <button class="link" data-action="close">Schliessen</button>
      </div>
      <label class="sr-only" for="clarify-title">Eintrag</label>
      <textarea id="clarify-title" class="card-title" rows="2" data-bind="clarify-title">${esc(m.title)}</textarea>
      ${body}
      <div class="sheet-foot">
        ${m.hist.length ? '<button class="link" data-action="step-back">← Zurück</button>' : '<span></span>'}
        ${m.series ? '<button class="link" data-action="clarify-skip">Überspringen</button>' : '<span></span>'}
      </div>
    </div>`;
}

/** Nach dem letzten offenen Schritt eines Projekts: gleich den nächsten festlegen. */
function nextStepHtml(pid: string, fromId: string): string {
  const p = project(pid);
  if (!p) return '';
  const done = S.state.items.get(fromId);
  const candidates = Q.projectItems(pid).filter((i) => i.list === 'someday' || i.list === 'inbox');
  return `
    <form class="sheet card" data-form="next-step" data-id="${p.id}">
      <div class="sheet-head">
        <span class="eyebrow">Projekt · Nächster Schritt</span>
        <button type="button" class="link" data-action="next-step-later">Später</button>
      </div>
      <h2 class="ns-project">${esc(p.title)}</h2>
      <p class="hint">${done ? `Erledigt: <s>${esc(done.title)}</s>. ` : ''}Das Projekt hat keinen offenen Schritt mehr.${p.outcome ? ` <span class="label">Ergebnis</span> ${esc(p.outcome)}` : ''}</p>
      ${candidates.length ? `
        <div class="field">
          <span class="field-label">Aus dem Projekt übernehmen</span>
          <div class="options">${candidates.map((c) => `
            <button type="button" class="btn option" data-action="promote" data-id="${c.id}">
              <strong>${esc(c.title)}</strong><span>${LIST_LABEL[c.list]}${c.due ? ` · fällig ${fmtDate(c.due)}` : ''}</span>
            </button>`).join('')}
          </div>
        </div>
        <p class="divider-label">oder neu formulieren</p>` : ''}
      <div class="field">
        <label for="ns-title">Nächster Schritt</label>
        <div class="capture compact">
          <input id="ns-title" name="title" placeholder="Die nächste sichtbare, physische Handlung" autocomplete="off" required>
        </div>
      </div>
      <div class="grid3">
        <div class="field"><label for="ns-ctx">Kontext</label><select id="ns-ctx" name="context">${contextOptions(done?.context ?? null)}</select></div>
        <div class="field"><label for="ns-due">Fällig am</label><input id="ns-due" name="due" type="date" min="${today()}"></div>
        <div class="field"><label for="ns-tickler">Erst ab</label><input id="ns-tickler" name="tickler" type="date" min="${today()}"></div>
      </div>
      <div class="actions-row spread">
        <button type="button" class="btn" data-action="close-project" data-id="${p.id}">Projekt ist fertig</button>
        <button class="btn primary" type="submit">Schritt speichern</button>
      </div>
    </form>`;
}

/** Ersatz, falls der Browser die Datumsauswahl nicht direkt öffnen kann. */
function dueHtml(id: string, target: 'item' | 'project'): string {
  const obj = target === 'item' ? S.state.items.get(id) : project(id);
  if (!obj) return '';
  const t = today();
  const quick: [string, string][] = [['Heute', t], ['Morgen', addDays(t, 1)], ['In 1 Woche', addDays(t, 7)], ['In 2 Wochen', addDays(t, 14)]];
  return `
    <form class="sheet" data-form="due" data-id="${id}" data-kind="${target}">
      <div class="sheet-head"><h2>Frist setzen</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <p class="hint">${esc(obj.title)}</p>
      <div class="quick-dates">${quick.map(([l, d]) => `<button type="button" class="filter" data-action="due-quick" data-date="${d}">${l}</button>`).join('')}</div>
      <div class="field"><label for="due-date">Fällig am</label><input id="due-date" name="due" type="date" value="${obj.due ?? ''}"></div>
      <div class="actions-row spread">
        ${obj.due ? '<button type="button" class="btn danger" data-action="due-clear">Frist entfernen</button>' : '<span></span>'}
        <button class="btn primary" type="submit">Speichern</button>
      </div>
    </form>`;
}

/** Projektfarbe wählen (0.12): Haken = dieses Projekt, Ring = schon bei einem anderen Projekt; mehrfach erlaubt */
function colorHtml(pid: string): string {
  const p = project(pid);
  if (!p) return '';
  const cur = colorKeyOf(pid);
  const used = usedColorKeys(pid);
  return `
    <div class="sheet">
      <div class="sheet-head"><h2>Projektfarbe</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <div class="palette" role="group" aria-label="Farben">
        ${PROJECT_COLORS.map((c) => {
          const on = c.key === cur, u = used.has(c.key);
          const state = on ? ', gewählt' : u ? ', schon bei einem anderen Projekt' : '';
          return `<button type="button" class="swatch pcx pc-${c.key}${on ? ' is-current' : ''}${u ? ' is-used' : ''}" data-action="set-color" data-id="${p.id}" data-key="${c.key}" aria-pressed="${on}" aria-label="${c.name}${state}" title="${c.name}${state}"><i aria-hidden="true">${on ? '✓' : ''}</i><span>${c.name}</span></button>`;
        }).join('')}
      </div>
      <p class="hint legend"><span><i class="lg lg-cur" aria-hidden="true"></i>Haken: dieses Projekt</span><span><i class="lg lg-used" aria-hidden="true"></i>Ring: schon bei einem anderen Projekt</span></p>
    </div>`;
}

/** Rückfrage beim Abschliessen eines Projekts mit offenen Aufgaben (0.12) */
function closeProjectHtml(pid: string): string {
  const p = project(pid);
  if (!p) return '';
  const open = Q.openInProject(pid);
  return `
    <div class="sheet">
      <div class="sheet-head"><h2>Projekt abschliessen</h2><button type="button" class="link" data-action="close">Abbrechen</button></div>
      <p><strong>${esc(p.title)}</strong> hat noch ${open.length === 1 ? 'eine offene Aufgabe' : `${open.length} offene Aufgaben`}:</p>
      <ul class="conflict-list">${open.slice(0, 8).map((i) => `<li>${esc(i.title)}</li>`).join('')}${open.length > 8 ? `<li class="muted">… und ${open.length - 8} weitere</li>` : ''}</ul>
      <div class="stack-btns">
        <button type="button" class="btn primary" data-action="close-project-go" data-id="${p.id}" data-with="1">Mit erledigen und abschliessen</button>
        <button type="button" class="btn" data-action="close-project-go" data-id="${p.id}" data-with="0">Offen lassen und abschliessen</button>
      </div>
    </div>`;
}

/** Aufgabe eines abgeschlossenen/verworfenen Projekts zurückholen (0.12) */
function reopenHtml(id: string): string {
  const it = S.state.items.get(id);
  const p = project(it?.projectId ?? null);
  if (!it || !p) return '';
  const word = p.status === 'dropped' ? 'verworfen' : 'abgeschlossen';
  return `
    <div class="sheet">
      <div class="sheet-head"><h2>Projekt ist ${word}</h2><button type="button" class="link" data-action="close">Abbrechen</button></div>
      <p><strong>${esc(it.title)}</strong> gehört zum ${word}en Projekt <strong>${esc(p.title)}</strong>. Was soll wieder aktiv werden?</p>
      <div class="stack-btns">
        <button type="button" class="btn primary" data-action="reopen-go" data-id="${it.id}" data-mode="project">Ganzes Projekt wieder aktivieren</button>
        <button type="button" class="btn" data-action="reopen-go" data-id="${it.id}" data-mode="item">Nur diese Aufgabe</button>
      </div>
      <p class="hint">„Nur diese Aufgabe“ löst sie vom Projekt; sie steht dann einzeln in den Nächsten Schritten.</p>
    </div>`;
}

/** „Was ist neu“ nach einem Update (0.12), aus RELEASE-NOTES.md */
const md = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
function notesHtml(notes: ReleaseNote[]): string {
  return `
    <div class="sheet notes-sheet">
      <span class="eyebrow">Neu in Version ${esc(notes[0]?.version ?? APP_VERSION)}</span>
      <h2>Was ist neu</h2>
      ${notes.map((n, i) => `${notes.length > 1 ? `<h3 class="notes-version">${i === 0 ? 'Version' : 'Davor: Version'} ${esc(n.version)}</h3>` : ''}<ul class="notes-list">${n.points.map((x) => `<li>${md(x)}</li>`).join('')}</ul>`).join('')}
      <div class="actions-row end"><button type="button" class="btn primary" data-action="notes-close">Alles klar</button></div>
    </div>`;
}

/** Eine Zeile Unteraufgabe im Dialog. sid beginnt mit „neu-“, solange sie nicht gespeichert ist. */
function subRow(itemId: string, sid: string, title: string, done: boolean): string {
  return `<li class="sub-row${done ? ' is-done' : ''}" data-sid="${esc(sid)}">
    <button type="button" class="check sub-check${done ? ' is-done' : ''}" data-action="sub-toggle" data-id="${itemId}" data-sid="${esc(sid)}" aria-pressed="${done}" aria-label="${done ? 'Wieder offen' : 'Abhaken'}"></button>
    <label class="sr-only" for="sub-${esc(sid)}">Unteraufgabe</label>
    <input id="sub-${esc(sid)}" class="sub-input" data-sid="${esc(sid)}" value="${esc(title)}" placeholder="Unteraufgabe" autocomplete="off" enterkeyhint="next">
    <button type="button" class="sub-del" data-action="sub-del" data-sid="${esc(sid)}" aria-label="Unteraufgabe entfernen" title="Entfernen">×</button>
  </li>`;
}
function subtasksField(it: Item): string {
  const subs = subtasksOf(it);
  if (!subs.length) return `<div class="field subs" data-subs="${it.id}"><button type="button" class="btn small sub-start" data-action="sub-start" data-id="${it.id}">Unteraufgaben hinzufügen</button></div>`;
  return `<div class="field subs" data-subs="${it.id}"><span class="field-label">Unteraufgaben</span>
    <ul class="sub-list">${subs.map((x) => subRow(it.id, x.id, x.title, x.done)).join('')}</ul>
    <button type="button" class="btn small sub-add" data-action="sub-add" data-id="${it.id}">+ Unteraufgabe</button></div>`;
}
let newSubCounter = 0;

function editHtml(id: string): string {
  const it = S.state.items.get(id);
  if (!it) return '';
  const lists: ListName[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'trash'];
  return `
    <form class="sheet" data-form="edit" data-id="${it.id}">
      <div class="sheet-head"><h2>Eintrag bearbeiten</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <div class="field"><label for="e-title">Titel</label><input id="e-title" name="title" value="${esc(it.title)}" required></div>
      <div class="field"><label for="e-notes">Notizen</label><textarea id="e-notes" name="notes" rows="4">${esc(it.notes)}</textarea></div>
      ${subtasksField(it)}
      <div class="grid2">
        <div class="field"><label for="e-list">Liste</label><select id="e-list" name="list">${lists.map((l) => `<option value="${l}"${l === it.list ? ' selected' : ''}>${LIST_LABEL[l]}</option>`).join('')}</select></div>
        <div class="field"><label for="e-ctx">Kontext</label><select id="e-ctx" name="context">${contextOptions(it.context)}</select></div>
        <div class="field"><label for="e-proj">Projekt</label><select id="e-proj" name="projectId">${projectOptions(it.projectId)}</select></div>
        <div class="field"><label for="e-wait">Wartet auf</label><input id="e-wait" name="waitingFor" value="${esc(it.waitingFor ?? '')}" placeholder="Person"></div>
        <div class="field"><label for="e-due" class="label-ico">${FLAG_SVG}Fällig am</label><input id="e-due" name="due" type="date" value="${it.due ?? ''}"></div>
        <div class="field"><label for="e-tickler" class="label-ico">${it.list === 'waiting' ? `${BELL_SVG}Nachfassen am` : `${MOON_SVG}Erst ab`}</label><input id="e-tickler" name="tickler" type="date" value="${it.tickler ?? ''}"></div>
      </div>
      ${it.list === 'next' ? repeatBox(it.repeat ?? null, it.due ?? today()) : ''}
      <p class="hint">${it.list === 'waiting'
        ? '„Fällig am“ ist die Frist. „Nachfassen am“ erinnert dich, bei der Person nachzufragen.'
        : '„Fällig am“ ist die Frist. „Erst ab“ blendet den Eintrag bis zu diesem Tag aus.'}</p>
      <p class="hint">Erfasst ${fmtTs(it.created)}${it.completed ? ` · erledigt ${fmtTs(it.completed)}` : ''}</p>
      <div class="actions-row spread">
        ${it.list !== 'trash' ? `<button type="button" class="btn danger" data-action="trash" data-id="${it.id}">In den Papierkorb</button>` : '<span></span>'}
        <div class="actions-row">
          ${it.list === 'inbox' ? `<button type="button" class="btn" data-action="clarify" data-id="${it.id}">Klären</button>` : ''}
          <button class="btn primary" type="submit">Speichern</button>
        </div>
      </div>
    </form>`;
}

function projectFormHtml(id: string | null): string {
  const p = id ? project(id) : undefined;
  return `
    <form class="sheet" data-form="project" data-id="${p?.id ?? ''}">
      <div class="sheet-head"><h2>${p ? 'Projekt bearbeiten' : 'Neues Projekt'}</h2><button type="button" class="link" data-action="close">Schliessen</button></div>
      <div class="field"><label for="pf-title">Projektname</label><input id="pf-title" name="title" value="${esc(p?.title ?? '')}" required></div>
      <div class="field"><label for="pf-outcome">Gewünschtes Ergebnis</label><textarea id="pf-outcome" name="outcome" rows="2" placeholder="Woran erkennst du, dass es fertig ist?">${esc(p?.outcome ?? '')}</textarea></div>
      <div class="field"><label for="pf-due">Fällig am (optional)</label><input id="pf-due" name="due" type="date" value="${p?.due ?? ''}"></div>
      ${p ? '' : `<div class="field"><label for="pf-next">Nächster Schritt</label><input id="pf-next" name="next" placeholder="Die nächste sichtbare, physische Handlung"></div>
      <div class="field"><label for="pf-ctx">Kontext</label><select id="pf-ctx" name="context">${contextOptions(null)}</select></div>`}
      <div class="actions-row spread">
        ${p ? `<button type="button" class="btn danger" data-action="project-status" data-id="${p.id}" data-status="dropped">Verwerfen</button>` : '<span></span>'}
        <button class="btn primary" type="submit">${p ? 'Speichern' : 'Anlegen'}</button>
      </div>
    </form>`;
}

// ---------- Klär-Ablauf ----------

/**
 * Klären starten. series = true („Klären starten“): danach automatisch der nächste Eintrag.
 * series = false („Klären“ bei einem Eintrag): nur dieser, danach zurück zur Liste.
 */
function startClarify(id?: string, series = !id) {
  const queue = toClarify();
  const target = id ?? queue[0]?.id;
  const it = target ? S.state.items.get(target) : undefined;
  if (!it) { modal = null; renderModal(); toast('Die Inbox ist leer.'); return; }
  modal = { kind: 'clarify', id: it.id, step: 'actionable', hist: [], title: it.title, series };
  renderModal();
}

/** Speichert die Entscheidung und springt zum nächsten Eintrag der Inbox. */
function finishClarify(patch: Partial<Item>, message: string, onUndo?: () => void) {
  if (modal?.kind !== 'clarify') return;
  const m = modal;
  const title = m.title.trim() || S.state.items.get(m.id)?.title || '';
  const rest = toClarify().filter((i) => i.id !== m.id);
  const done = !m.series || !rest.length;
  if (done) { modal = null; renderModal(); }
  if (m.series && !rest.length) { go('next'); message = `${message} Inbox leer.`; }
  // Erst speichern (Rückgängig legt den Eintrag zurück in die Inbox), dann weiter zum nächsten,
  // damit der Zähler „x von y“ schon stimmt
  patchWithUndo(m.id, { title, ...patch }, message, onUndo);
  if (!done) startClarify(rest[0].id, true);
}

// ---------- Wischen zum Löschen ----------

const SWIPE_W = 88; // Breite des Löschen-Knopfs in px
let swipe: { inner: HTMLElement; x0: number; y0: number; base: number; dx: number; active: boolean; pid: number } | null = null;
let openInner: HTMLElement | null = null;
let swallowClick = false;

function setOffset(inner: HTMLElement, x: number, animate: boolean) {
  inner.style.transition = animate ? '' : 'none';
  inner.style.transform = x ? `translateX(${x}px)` : '';
  inner.parentElement?.classList.toggle('swipe-open', x < 0);
}

function closeSwipe(animate = true) {
  if (openInner) setOffset(openInner, 0, animate);
  openInner = null;
}

// ---------- Ziehen in der Projektansicht (Griff ⋮⋮, Maus und Finger) ----------

let drag: {
  li: HTMLElement; list: HTMLElement; pid: string; id: string; pointer: number;
  y0: number; from: number; to: number; h: number; sibs: HTMLElement[]; mids: number[];
} | null = null;

function dragStart(e: PointerEvent, handle: HTMLElement) {
  const li = handle.closest<HTMLElement>('li.row');
  const list = li?.closest<HTMLElement>('[data-sortable]');
  if (!li || !list) return;
  const sibs = [...list.children] as HTMLElement[];
  const from = sibs.indexOf(li);
  const rects = sibs.map((el) => el.getBoundingClientRect());
  const gap = sibs.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
  drag = {
    li, list, pid: list.dataset.sortable!, id: li.dataset.row!, pointer: e.pointerId,
    y0: e.clientY + window.scrollY, from, to: from, h: rects[from].height + gap, sibs,
    mids: rects.map((r) => r.top + window.scrollY + r.height / 2),
  };
  try { handle.setPointerCapture(e.pointerId); } catch { /* ältere Browser */ }
  li.classList.add('is-dragging');
  list.classList.add('is-sorting');
}

function dragMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointer) return;
  // am Bildschirmrand mitscrollen
  if (e.clientY < 70) window.scrollBy(0, -10); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 10);
  const d = drag;
  const dy = e.clientY + window.scrollY - d.y0;
  d.li.style.transform = `translateY(${dy}px)`;
  const c = d.mids[d.from] + dy;
  let to = 0;
  d.mids.forEach((m, i) => { if (i !== d.from && m < c) to++; });
  d.to = to;
  d.sibs.forEach((el, i) => {
    if (i === d.from) return;
    let off = 0;
    if (d.from < to && i > d.from && i <= to) off = -d.h;
    if (to < d.from && i >= to && i < d.from) off = d.h;
    el.style.transform = off ? `translateY(${off}px)` : '';
  });
}

function dragEnd(e: PointerEvent | null, cancel = false) {
  if (!drag || (e && e.pointerId !== drag.pointer)) return;
  const d = drag;
  drag = null;
  d.sibs.forEach((el) => { el.style.transform = ''; });
  d.li.classList.remove('is-dragging');
  d.list.classList.remove('is-sorting');
  if (!cancel && d.to !== d.from) { S.moveProjectItem(d.pid, d.id, d.to); flash(d.id); }
}

/** Tastatur: Griff fokussieren, Pfeil hoch/runter verschiebt */
function dragKey(e: KeyboardEvent, handle: HTMLElement) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const li = handle.closest<HTMLElement>('li.row');
  const list = li?.closest<HTMLElement>('[data-sortable]');
  if (!li || !list) return;
  e.preventDefault();
  const from = [...list.children].indexOf(li);
  const to = from + (e.key === 'ArrowUp' ? -1 : 1);
  if (to < 0 || to >= list.children.length) return;
  const id = li.dataset.row!;
  S.moveProjectItem(list.dataset.sortable!, id, to);
  document.querySelector<HTMLElement>(`[data-drag="${CSS.escape(id)}"]`)?.focus();
  flash(id);
}

function onPointerDown(e: PointerEvent) {
  // Neue Berührung: der Klick einer vorherigen Wischgeste ist vorbei, dieser Tipp zählt
  swallowClick = false;
  const handle = (e.target as HTMLElement).closest<HTMLElement>('.drag-handle');
  if (handle && !modal) { dragStart(e, handle); return; }
  if (e.pointerType === 'mouse' || modal) return;
  // Finger auf dem Löschen-Knopf: Karte offen lassen, damit der Tipp ankommt
  if ((e.target as HTMLElement).closest('.swipe-del')) return;
  const inner = (e.target as HTMLElement).closest<HTMLElement>('.row-inner');
  if (openInner && openInner !== inner) closeSwipe();
  if (!inner || (e.target as HTMLElement).closest('.due-input')) return;
  // Projekte und Papierkorb: nicht wegwischbar
  if (!inner.parentElement?.querySelector(':scope > .swipe-del')) return;
  swipe = { inner, x0: e.clientX, y0: e.clientY, base: inner === openInner ? -SWIPE_W : 0, dx: 0, active: false, pid: e.pointerId };
}

function onPointerMove(e: PointerEvent) {
  if (drag) { dragMove(e); return; }
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x0;
  const dy = e.clientY - swipe.y0;
  if (!swipe.active) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // Scrollen
    if (Math.abs(dx) < 10) return;
    swipe.active = true;
  }
  swipe.dx = dx;
  const x = Math.max(-SWIPE_W * 1.35, Math.min(0, swipe.base + dx));
  setOffset(swipe.inner, x, false);
}

function onPointerUp(e: PointerEvent) {
  if (drag) { dragEnd(e); return; }
  if (!swipe || e.pointerId !== swipe.pid) return;
  const s = swipe;
  swipe = null;
  if (!s.active) return;
  swallowClick = true; // die Geste ist kein Tippen auf die Karte
  setTimeout(() => { swallowClick = false; }, 350);
  const x = s.base + s.dx;
  if (x < -SWIPE_W / 2) { setOffset(s.inner, -SWIPE_W, true); openInner = s.inner; }
  else { setOffset(s.inner, 0, true); if (openInner === s.inner) openInner = null; }
}

function onPointerCancel() {
  if (drag) { dragEnd(null, true); return; }
  if (swipe?.active) setOffset(swipe.inner, swipe.base, true);
  swipe = null;
}

// ---------- Rückgängig ----------

const UNDO_MS = 3000; // gleich lang wie die Animation .undo-bar in styles.css
let undoTimer = 0;
let undoFn: (() => void) | null = null;

/** Kleine Leiste am unteren Rand mit „Rückgängig“, verschwindet nach 3 Sekunden. */
function showUndo(text: string, fn: () => void) {
  const el = document.getElementById('undo')!;
  document.getElementById('toast')!.className = 'toast';
  el.innerHTML = `<span class="undo-text">${esc(text)}</span><button type="button" class="undo-btn" data-action="undo">Rückgängig</button><span class="undo-bar"></span>`;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('show');
  undoFn = fn;
  clearTimeout(undoTimer);
  undoTimer = window.setTimeout(hideUndo, UNDO_MS);
}

function hideUndo() {
  clearTimeout(undoTimer);
  undoFn = null;
  const el = document.getElementById('undo')!;
  el.classList.remove('show');
  setTimeout(() => { if (!undoFn) el.hidden = true; }, 200);
}

/** Zeile kurz hervorheben, z. B. nach Rückgängig oder wenn sie durch eine neue Frist verschoben wurde. */
function flash(id: string) {
  const r = document.querySelector(`[data-row="${CSS.escape(id)}"]`);
  if (!r) return;
  r.classList.remove('flash');
  void (r as HTMLElement).offsetWidth;
  r.classList.add('flash');
}

const short = (t: string) => (t.length > 34 ? t.slice(0, 32) + '…' : t);

/**
 * Erledigen mit Rückgängig. War es der letzte offene Schritt eines aktiven Projekts,
 * fragt die App gleich nach dem nächsten Schritt.
 */
/** Projekt abschliessen (mit oder ohne offene Aufgaben), mit Rückgängig */
function closeProject(pid: string, withOpen: boolean) {
  const u = S.completeProject(pid, withOpen);
  if (!u) return;
  modal = null; renderModal();
  showUndo(withOpen && u.completed.length ? `Projekt abgeschlossen, ${u.completed.length} ${u.completed.length === 1 ? 'Aufgabe' : 'Aufgaben'} erledigt.` : 'Projekt abgeschlossen.',
    () => { S.undoCompleteProject(pid, u); flash(pid); });
  if (route.view === 'project' && route.id === pid) go('projects');
}

function completeWithUndo(id: string, extra: Partial<Item> = {}) {
  const it = S.state.items.get(id);
  if (!it) return;
  const before = { ...it };
  S.batch(() => {
    if (Object.keys(extra).length) S.patchItem(id, extra);
    S.completeItem(id);
  });
  const p = project(it.projectId);
  const askNext = !!p && p.status === 'active' && Q.stalled(p);
  showUndo(`Erledigt: ${short(it.title)}`, () => {
    if (modal?.kind === 'next-step' && modal.fromId === id) { modal = null; renderModal(); }
    S.patchItem(id, { list: before.list, completed: null, prevList: null, ...pick(before, Object.keys(extra) as (keyof Item)[]) });
    flash(id);
  });
  if (askNext && !modal) { modal = { kind: 'next-step', projectId: p!.id, fromId: id }; renderModal(); }
}

/** Änderung an einem Eintrag mit Rückgängig (stellt genau die geänderten Felder wieder her). */
function patchWithUndo(id: string, patch: Partial<Item>, text: string, onUndo?: () => void) {
  const it = S.state.items.get(id);
  if (!it) return;
  const before = pick({ ...it }, Object.keys(patch) as (keyof Item)[]);
  S.patchItem(id, patch);
  flash(id);
  showUndo(text, () => {
    S.patchItem(id, before);
    onUndo?.();
    flash(id);
  });
}

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  keys.forEach((k) => { out[k] = o[k]; });
  return out;
}

/** Frist direkt setzen (Kalendersymbol in der Zeile), mit Rückgängig. */
function setDue(kind: 'item' | 'project', id: string, due: string | null) {
  const obj = kind === 'item' ? S.state.items.get(id) : project(id);
  if (!obj) return;
  const prev = obj.due ?? null;
  if (prev === due) return;
  if (kind === 'item') S.patchItem(id, { due }); else S.patchProject(id, { due });
  flash(id);
  showUndo(due ? `Fällig am ${fmtDate(due)}` : 'Frist entfernt', () => {
    if (kind === 'item') S.patchItem(id, { due: prev }); else S.patchProject(id, { due: prev });
    flash(id);
  });
}

function openDuePicker(btn: HTMLElement) {
  const id = btn.dataset.id!;
  const kind = btn.dataset.kind as 'item' | 'project';
  const input = btn.parentElement?.querySelector<HTMLInputElement>('.due-input');
  if (input && typeof input.showPicker === 'function') {
    try { input.showPicker(); return; } catch { /* z. B. in eingebetteter Vorschau nicht erlaubt */ }
  }
  modal = { kind: 'due', id, target: kind };
  renderModal();
}

// ---------- Toast ----------

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = document.getElementById('toast')!;
  hideUndo();
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 2600);
}

// ---------- Rendern ----------

let updateFn: (() => void) | null = null;

type AppActions = { checkForUpdate: () => Promise<'update' | 'current' | 'offline' | 'unsupported'>; repairApp: () => Promise<void> };
let appActions: AppActions | null = null;
export function setAppActions(a: AppActions) { appActions = a; }
/** Neue App-Version bereit: Hinweis zeigen, bis der Nutzer aktualisiert. */
export function offerUpdate(apply: () => void) {
  updateFn = apply;
  renderBanner();
}

function renderBanner() {
  const el = document.getElementById('banner')!;
  if (updateFn) {
    el.hidden = false;
    el.className = 'banner update';
    el.innerHTML = '<span><strong>Neue Version verfügbar.</strong> Deine Daten bleiben erhalten.</span><button class="btn primary small" data-action="apply-update">Jetzt aktualisieren</button>';
    return;
  }
  el.className = 'banner';
  const items = all();
  const hasData = items.length > 0;
  // Erinnern, wenn das letzte Backup (bzw. der erste Eintrag) mindestens 7 Tage zurückliegt
  const since = S.info.lastBackup || Math.min(...items.map((i) => i.created), Date.now());
  const days = daysSince(since);
  if (!S.info.persistent) {
    el.hidden = false;
    el.innerHTML = '<span>Dieser Browser erlaubt keinen dauerhaften Speicher. Änderungen gehen beim Schliessen verloren.</span>';
  } else if (!IS_TEST && hasData && days >= 7 && route.view !== 'settings') {
    el.hidden = false;
    el.innerHTML = `<span>${S.info.lastBackup ? `Letztes Backup vor ${days} Tagen.` : 'Noch kein Backup erstellt.'}</span><button class="link" data-action="go" data-view="settings">Jetzt sichern</button>`;
  } else {
    el.hidden = true;
  }
}

let lastRouteKey = '';
export function render() {
  renderNav();
  renderBanner();
  const main = document.getElementById('main')!;
  const views: Record<View, () => string> = {
    inbox: viewInbox, due: viewDue, next: viewNext, projects: viewProjects, project: () => viewProject(route.id ?? ''),
    waiting: viewWaiting, tickler: viewTickler, someday: viewSomeday, reference: viewReference, done: viewDone, settings: viewSettings,
  };
  const active = document.activeElement as HTMLElement | null;
  const keepId = active && main.contains(active) ? active.id : '';
  // Eingaben erhalten, wenn die Ansicht wegen Hintergrund-Änderungen (Sync) neu gezeichnet wird
  const routeKey = route.view + (route.id ?? '');
  const keep = new Map<string, string>();
  if (routeKey === lastRouteKey) {
    main.querySelectorAll<HTMLInputElement>('input[id], textarea[id], select[id]').forEach((f) => {
      if (['file', 'checkbox', 'radio'].includes(f.type) || f.classList.contains('due-input')) return;
      keep.set(f.id, f.value);
    });
  }
  lastRouteKey = routeKey;
  openInner = null;
  main.innerHTML = views[route.view]();
  keep.forEach((v, id) => {
    const f = document.getElementById(id) as HTMLInputElement | null;
    if (f && main.contains(f) && f.value !== v) { f.value = v; if (f.classList.contains('step-due-input')) showStepDue(f); }
  });
  if (keepId) document.getElementById(keepId)?.focus();
  if (route.view === 'settings') { updatePersistState(); void updateRestorePoints(); }
}

// ---------- Zurück auf früheren Stand ----------

async function updateRestorePoints() {
  const el = document.getElementById('restore-list');
  if (!el) return;
  const [events, versions, rewinds] = await Promise.all([
    getAllEvents(), getMeta<{ v: string; at: number }[]>('versionLog'), getMeta<{ at: number; to: number; when?: number }[]>('rewinds'),
  ]);
  const points = restorePoints(events, versions ?? [], rewinds ?? []);
  const list = document.getElementById('restore-list');
  if (!list) return;
  list.innerHTML = points.length
    ? points.map((p) => `<li><button type="button" class="restore-point" data-action="restore-point" data-ts="${p.ts}" data-label="${esc(p.label)}" data-changes="${p.changes}">
        <span>${esc(p.label)}</span><span class="hint num">${p.changes} ${p.changes === 1 ? 'spätere Änderung' : 'spätere Änderungen'}</span></button></li>`).join('')
    : '<li class="hint">Noch keine früheren Stände. Sie entstehen mit der Zeit (Tagesende, vor Updates).</li>';
}

function confirmRewind(ts: number, label: string, changes: number) {
  modal = {
    kind: 'confirm',
    text: `Zurück auf „${label}“? ${changes} spätere ${changes === 1 ? 'Änderung wird' : 'Änderungen werden'} ausgeglichen. Das lässt sich danach wieder rückgängig machen.`,
    label: 'Zurücksetzen',
    run: () => { void doRewind(ts); },
  };
  renderModal();
}

async function doRewind(ts: number) {
  const before = await S.lastEventTs();
  const n = await S.rewindTo(ts);
  if (!n) { toast('Es gab nichts zurückzusetzen.'); return; }
  render();
  showUndo(`Früherer Stand wiederhergestellt (${n} ${n === 1 ? 'Eintrag' : 'Einträge'})`, () => { void S.rewindTo(before).then(() => { render(); toast('Wieder wie vorher.'); }); });
}

async function updatePersistState() {
  const el = document.getElementById('persist-state');
  if (!el) return;
  try {
    const ok = await navigator.storage?.persisted?.();
    el.textContent = ok ? 'Ja' : 'Nein. Installier die App auf dem Homescreen und mach regelmässig Backups.';
  } catch { el.textContent = 'Unbekannt'; }
}

export function go(view: View, id?: string) {
  route = { view, id };
  try { history.replaceState(null, '', '#' + (id ? `${view}-${id}` : view)); } catch { /* Vorschau ohne History */ }
  render();
  document.getElementById('main')!.scrollTop = 0;
  window.scrollTo(0, 0);
  document.body.classList.remove('nav-open');
}

function readHash() {
  const h = (location.hash || '').slice(1);
  const views: View[] = ['inbox', 'due', 'next', 'projects', 'waiting', 'tickler', 'someday', 'reference', 'done', 'settings'];
  if (h.startsWith('project-')) route = { view: 'project', id: h.slice(8) };
  else if ((views as string[]).includes(h)) route = { view: h as View };
}

// ---------- Beispieldaten ----------

async function resetTestApp() {
  if (!IS_TEST) return;
  await S.whenSaved();
  await destroyDb();
  location.reload();
}

function loadExamples() {
  S.batch(() => {
    const pid = S.createProject({ title: 'Beispiel: Velo für den Winter bereit machen', outcome: 'Velo läuft, Licht funktioniert, Winterreifen montiert', due: addDays(today(), 21) });
    S.capture('Beispiel: Velomechaniker anrufen und Termin für Service vereinbaren', { list: 'next', context: '@Telefon', projectId: pid, due: addDays(today(), 2) });
    S.capture('Beispiel: Steuererklärung', { due: addDays(today(), 30) });
    S.capture('Beispiel: Idee für Geburtstagsgeschenk Anna', {});
    S.capture('Beispiel: Artikel über Wochendurchsicht lesen', {});
    S.capture('Beispiel: Offerte vom Elektriker', { list: 'waiting', waitingFor: 'Elektro Huber', tickler: today() });
    S.capture('Beispiel: Spanisch lernen', { list: 'someday' });
  });
  toast('Beispieleinträge geladen. Du erkennst sie am Wort „Beispiel“.');
}

// ---------- Ereignisse ----------

function val(form: HTMLFormElement, name: string): string {
  const v = new FormData(form).get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function saveBackupFile() {
  if (!backupText) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([backupText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kopf-frei-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function onClick(e: MouseEvent) {
  if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
  if (openInner && !(e.target as HTMLElement).closest('.swipe-del')) {
    const insideOpen = openInner.contains(e.target as Node);
    closeSwipe();
    if (insideOpen) { e.preventDefault(); return; }
  }
  // iPad/iPhone: Tippen aufs Datumsfeld über der Fahne öffnet nur die Datumsauswahl, nicht den Dialog der Karte
  if ((e.target as HTMLElement).matches?.('.due-input, .step-due-input')) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const a = el.dataset.action!;
  const id = el.dataset.id ?? '';
  switch (a) {
    case 'go': go(el.dataset.view as View); break;
    case 'toggle-nav': document.body.classList.toggle('nav-open'); break;
    case 'open-project': go('project', id); break;
    case 'ctx': ctxFilter = el.dataset.ctx ?? 'all'; render(); break;
    case 'complete': {
      const row = el.closest('.row');
      row?.classList.add('completing');
      setTimeout(() => completeWithUndo(id), 220);
      break;
    }
    case 'undo': { const fn = undoFn; hideUndo(); fn?.(); break; }
    case 'swipe-delete': {
      // Aufgabe in den Papierkorb, 3 Sekunden Rückgängig (wie „In den Papierkorb“ im Dialog)
      closeSwipe(false);
      const it = S.state.items.get(id);
      if (it && it.list !== 'trash') patchWithUndo(id, { list: 'trash', prevList: it.list }, `Gelöscht: ${short(it.title)}`);
      break;
    }
    case 'delete-project': {
      const pr = project(id);
      if (!pr) break;
      const n = all().filter((i) => i.projectId === id).length;
      modal = {
        kind: 'confirm', label: 'Endgültig löschen',
        text: `Projekt „${pr.title}“${n ? ` und ${n === 1 ? 'seine Aufgabe' : `alle ${n} Aufgaben`}` : ''} endgültig löschen? Das lässt sich nicht rückgängig machen.`,
        run: () => { S.deleteProject(id); go('projects'); toast(`Projekt gelöscht: ${short(pr.title)}.`); },
      };
      renderModal();
      break;
    }
    case 'due-pick': openDuePicker(el); break;
    case 'step-due-pick': {
      const input = el.parentElement?.querySelector<HTMLInputElement>('.step-due-input');
      if (!input) break;
      try { if (typeof input.showPicker === 'function') { input.showPicker(); break; } } catch { /* unten */ }
      input.classList.add('is-open'); input.focus();
      break;
    }
    case 'noop': break;
    case 'conflict': modal = { kind: 'conflict', id: el.dataset.id! }; renderModal(); break;
    case 'order-by-due': S.resetProjectOrder(el.dataset.id!); modal = null; renderModal(); toast('Nach Frist sortiert.'); break;
    case 'due-quick':
    case 'due-clear':
      if (modal?.kind === 'due') {
        const { id: did, target } = modal;
        modal = null; renderModal();
        setDue(target, did, a === 'due-quick' ? el.dataset.date! : null);
      }
      break;
    case 'next-step-later': modal = null; renderModal(); break;
    case 'promote': {
      const c = S.state.items.get(id);
      if (!c) break;
      S.patchItem(id, { list: 'next', tickler: null });
      modal = null; renderModal();
      toast(`Nächster Schritt: ${short(c.title)}`);
      break;
    }
    case 'restore': {
      const it = S.state.items.get(id);
      // Aufgabe eines abgeschlossenen/verworfenen Projekts: fragen, was wieder aktiv wird (0.12)
      if (it && it.list === 'done' && inClosedProject(it)) { modal = { kind: 'reopen', id }; renderModal(); break; }
      S.restoreItem(id); toast('Zurückgeholt.');
      break;
    }
    case 'reopen-go': {
      const mode = el.dataset.mode === 'project' ? 'project' : 'item';
      const it = S.state.items.get(id);
      modal = null; renderModal();
      if (!it) break;
      S.reopenFromClosedProject(id, mode);
      if (mode === 'project') { toast('Projekt wieder aktiv.'); if (it.projectId) go('project', it.projectId); }
      else toast(`Wieder offen: ${short(it.title)}`);
      break;
    }
    case 'pick-color': modal = { kind: 'color', id }; renderModal(); break;
    case 'set-color': {
      const key = el.dataset.key ?? null;
      modal = null; renderModal();
      const pr = project(id);
      if (pr && pr.color !== key) S.patchProject(id, { color: key });
      break;
    }
    case 'close-project': {
      // Offene Aufgaben? Dann nachfragen (0.12), sonst direkt abschliessen
      if (Q.openInProject(id).length) { modal = { kind: 'close-project', id }; renderModal(); break; }
      closeProject(id, false);
      break;
    }
    case 'close-project-go': modal = null; renderModal(); closeProject(id, el.dataset.with === '1'); break;
    case 'notes-close': modal = null; renderModal(); void setMeta('notesSeen', APP_VERSION); break;
    case 'sub-start': {
      const box = el.closest<HTMLElement>('.subs');
      if (!box) break;
      const sid = `neu-${++newSubCounter}`;
      box.innerHTML = `<span class="field-label">Unteraufgaben</span><ul class="sub-list">${subRow(id, sid, '', false)}</ul>
        <button type="button" class="btn small sub-add" data-action="sub-add" data-id="${id}">+ Unteraufgabe</button>`;
      box.querySelector<HTMLInputElement>('.sub-input')?.focus();
      break;
    }
    case 'sub-add': {
      const ul = el.closest('.subs')?.querySelector('.sub-list');
      if (!ul) break;
      const sid = `neu-${++newSubCounter}`;
      ul.insertAdjacentHTML('beforeend', subRow(id, sid, '', false));
      ul.querySelector<HTMLInputElement>(`[data-sid="${sid}"].sub-input`)?.focus();
      break;
    }
    case 'sub-toggle': {
      // Abhaken wird sofort gespeichert und bleibt sichtbar (durchgestrichen); neue erst mit „Speichern“
      const sid = el.dataset.sid!;
      const rowEl = el.closest('.sub-row');
      const on = !el.classList.contains('is-done');
      el.classList.toggle('is-done', on); rowEl?.classList.toggle('is-done', on);
      el.setAttribute('aria-pressed', String(on)); el.setAttribute('aria-label', on ? 'Wieder offen' : 'Abhaken');
      if (!sid.startsWith('neu-')) S.patchSubtask(id, sid, { done: on });
      break;
    }
    case 'sub-del': {
      const rowEl = el.closest<HTMLElement>('.sub-row');
      const form = el.closest('form');
      if (!rowEl || !form) break;
      const sid = el.dataset.sid!;
      if (!sid.startsWith('neu-')) form.insertAdjacentHTML('beforeend', `<input type="hidden" name="sub-del" value="${esc(sid)}">`);
      rowEl.remove();
      break;
    }
    case 'edit': modal = { kind: 'edit', id }; renderModal(); break;
    case 'trash': {
      const it = S.state.items.get(id);
      modal = null; renderModal();
      if (it) patchWithUndo(id, { list: 'trash', prevList: it.list }, `Gelöscht: ${short(it.title)}`);
      break;
    }
    case 'empty-trash':
      modal = { kind: 'confirm', text: `Papierkorb endgültig leeren?${Q.trashedProjects().length ? ' Projekte darin werden samt ihren Aufgaben gelöscht.' : ''} Die Einträge sind danach nicht mehr lesbar.`, label: 'Endgültig leeren', run: () => { S.emptyTrash(); toast('Papierkorb geleert.'); } };
      renderModal();
      break;
    case 'confirm': if (modal?.kind === 'confirm') { const run = modal.run; modal = null; renderModal(); run(); } break;
    case 'close':
      if (modal?.kind === 'notes') void setMeta('notesSeen', APP_VERSION);
      modal = null; renderModal(); break;
    case 'theme': setTheme(el.dataset.value as Theme); break;
    case 'check-update': {
      if (!appActions) { toast('Updates werden in dieser Ansicht nicht geprüft.'); break; }
      toast('Suche nach Updates …');
      void appActions.checkForUpdate().then((r) => {
        const MSG = { update: 'Neue Version gefunden. Tippe oben auf „Jetzt aktualisieren“.', current: `Du hast die neueste Version (${APP_VERSION}).`, offline: 'Keine Verbindung. Später nochmals versuchen.', unsupported: 'Updates werden in dieser Ansicht nicht geprüft.' };
        toast(MSG[r]);
      });
      break;
    }
    case 'repair-app':
      modal = { kind: 'confirm', text: 'App frisch vom Server laden? Deine Daten, der Sync und die Einstellungen bleiben erhalten.', label: 'Reparieren',
        run: () => { void (appActions?.repairApp() ?? Promise.resolve(location.reload())); } };
      renderModal();
      break;
    case 'restore-point': confirmRewind(Number(el.dataset.ts), el.dataset.label ?? '', Number(el.dataset.changes)); break;
    case 'sample-add': if (IS_TEST) { seedSample(); toast('Beispieldaten hinzugefügt.'); } break;
    case 'test-reset':
      if (!IS_TEST) break;
      modal = { kind: 'confirm', text: 'Alle Daten der Test-App löschen und mit frischen Beispieldaten neu starten? Deine echte App ist davon nicht betroffen.', label: 'Zurücksetzen',
        run: () => { void resetTestApp(); } };
      renderModal();
      break;
    case 'sync-now': void Sync.syncNow(); break;
    case 'sync-back': syncSetup = null; render(); break;
    case 'sync-disconnect':
      modal = { kind: 'confirm', text: 'Synchronisation auf diesem Gerät trennen? Deine Daten bleiben auf dem Gerät und im Repository. Token und Schlüssel werden von diesem Gerät entfernt.', label: 'Trennen',
        run: () => { void Sync.disconnect().then(() => toast('Sync getrennt.')); } };
      renderModal();
      break;
    case 'apply-update': {
      // Erst alles fertig speichern, dann neu starten
      const fn = updateFn;
      void S.whenSaved().then(() => fn?.());
      break;
    }
    case 'quick-capture': modal = { kind: 'capture' }; renderModal(); break;
    case 'clarify': startClarify(id); break;
    case 'clarify-first': startClarify(); break;
    case 'step':
      if (modal?.kind === 'clarify') { modal.hist.push(modal.step); modal.step = el.dataset.step as Step; renderModal(); }
      break;
    case 'step-back':
      if (modal?.kind === 'clarify' && modal.hist.length) { modal.step = modal.hist.pop()!; renderModal(); }
      break;
    case 'clarify-skip': {
      if (modal?.kind !== 'clarify') break;
      const q = toClarify();
      const idx = q.findIndex((i) => i.id === (modal as { id: string }).id);
      const nxt = q[idx + 1] ?? null;
      if (nxt) startClarify(nxt.id, true); else { modal = null; renderModal(); }
      break;
    }
    case 'clarify-goal': if (modal?.kind === 'clarify') { modal.goal = el.dataset.val as Goal; renderModal(); } break;
    case 'clarify-not': if (modal?.kind === 'clarify') { modal.not = el.dataset.val as NotGoal; renderModal(); } break;
    case 'clarify-ctx': {
      // Kontext umschalten ohne neu zu zeichnen (Eingaben in den anderen Feldern bleiben)
      if (modal?.kind !== 'clarify') break;
      const c = el.dataset.ctx!;
      const next = modal.ctx === c ? null : c;
      modal.ctx = next;
      const box = el.closest('.field');
      box?.querySelectorAll<HTMLElement>('.ctx-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ctx === next)));
      const hidden = box?.querySelector<HTMLInputElement>('input[name=context]'); if (hidden) hidden.value = next ?? '';
      const name = box?.querySelector('.ctx-chip-name'); if (name) name.textContent = next ? ctxLabel(next) : 'Ohne Kontext';
      break;
    }
    case 'quick-done': modal = { kind: 'quick', id }; renderModal(); break;
    case 'repeat-toggle': case 'repeat-kind': case 'repeat-day': {
      const box = el.closest<HTMLElement>('[data-repeat-box]');
      if (!box) break;
      const base = box.dataset.base ?? today();
      let r = readRepeat(box);
      if (a === 'repeat-toggle') r = r ? null : defaultRepeat('week', base);
      else if (a === 'repeat-kind') r = r?.kind === el.dataset.kind ? r : defaultRepeat(el.dataset.kind as Repeat['kind'], base);
      else if (r?.kind === 'week') { const d = Number(el.dataset.day); r = { kind: 'week', days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort() }; }
      setRepeat(box, r);
      box.querySelector<HTMLElement>(`[data-action="${a}"]${a === 'repeat-day' ? `[data-day="${el.dataset.day}"]` : a === 'repeat-kind' ? `[data-kind="${el.dataset.kind}"]` : ''}`)?.focus();
      break;
    }
    case 'quick-go': {
      const it = S.state.items.get(id);
      modal = null; renderModal();
      if (!it) break;
      if (el.dataset.to === 'done') patchWithUndo(id, { list: 'done', completed: Date.now(), prevList: it.list, tickler: null }, `Erledigt: ${short(it.title)}`);
      else patchWithUndo(id, { list: 'trash', prevList: it.list }, `Gelöscht: ${short(it.title)}`);
      break;
    }
    case 'new-project': modal = { kind: 'project', id: null }; renderModal(); break;
    case 'edit-project': modal = { kind: 'project', id }; renderModal(); break;
    case 'project-status': {
      const status = el.dataset.status as Project['status'];
      const pr = project(id);
      if (!pr) break;
      const prev = { status: pr.status, completed: pr.completed };
      S.patchProject(id, { status, completed: status === 'done' ? Date.now() : null, ...(status === 'dropped' ? { droppedAt: Date.now() } : {}) });
      modal = null; renderModal();
      const msg: Record<Project['status'], string> = { active: 'Projekt aktiviert.', someday: 'Auf Irgendwann/Vielleicht verschoben.', done: 'Projekt abgeschlossen.', dropped: 'Projekt verworfen.' };
      showUndo(msg[status], () => { S.patchProject(id, prev); flash(id); });
      if ((status === 'done' || status === 'dropped') && route.view === 'project' && route.id === id) go('projects');
      break;
    }
    case 'remove-ctx': S.removeContext(el.dataset.ctx!); break;
    case 'load-examples': loadExamples(); break;
    case 'download-backup': saveBackupFile(); break;
    case 'copy-backup': {
      const ta = document.getElementById('backup-text') as HTMLTextAreaElement | null;
      navigator.clipboard?.writeText(backupText ?? '').then(() => toast('Backup in die Zwischenablage kopiert.'))
        .catch(() => { ta?.select(); toast('Text markiert. Kopier ihn mit Strg+C bzw. Kopieren.'); });
      break;
    }
  }
}

async function onSubmit(e: SubmitEvent) {
  const form = e.target as HTMLFormElement;
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const id = form.dataset.id ?? '';
  switch (kind) {
    case 'capture':
    case 'quick-capture': {
      const t = val(form, 'title');
      if (!t) return;
      (form.querySelector('input') as HTMLInputElement).value = '';
      S.capture(t);
      if (kind === 'quick-capture') { modal = null; renderModal(); toast('In der Inbox.'); }
      else document.getElementById('capture-input')?.focus();
      break;
    }
    case 'project-step': {
      const t = val(form, 'title');
      if (!t) return;
      const due = val(form, 'due') || null;
      // Felder leeren, bevor neu gezeichnet wird (sonst übernimmt die Ansicht die alten Werte)
      (form.querySelector('input[name=title]') as HTMLInputElement).value = '';
      const dueIn = form.querySelector<HTMLInputElement>('.step-due-input');
      if (dueIn) dueIn.value = '';
      S.addProjectStep(id, t, { context: val(form, 'context') || null, due });
      document.getElementById('step-input')?.focus();
      break;
    }
    case 'add-ctx': {
      const name = val(form, 'name');
      (form.querySelector('input') as HTMLInputElement).value = '';
      const n = S.addContext(name);
      if (n) toast(`Kontext „${ctxLabel(n)}“ hinzugefügt.`);
      break;
    }
    case 'clarify-not': {
      if (modal?.kind !== 'clarify' || !modal.not) return;
      if (modal.not === 'trash') finishClarify({ list: 'trash', prevList: 'inbox', tickler: null }, 'Weggeworfen.');
      else if (modal.not === 'ref') finishClarify({ list: 'reference', tickler: null }, 'Als Referenz abgelegt.');
      else finishClarify({ list: 'someday', tickler: val(form, 'tickler') || null }, 'Auf Irgendwann/Vielleicht gelegt.');
      break;
    }
    case 'clarify-yes': {
      if (modal?.kind !== 'clarify' || !modal.goal) return;
      const g = modal.goal;
      if (g === 'done') finishClarify({ list: 'done', completed: Date.now(), prevList: 'next', tickler: null }, 'Erledigt. Gut gemacht.');
      else if (g === 'next') {
        const r = formRepeat(form);
        if (r === 'bad') { toast('Wähl mindestens einen Wochentag.', 'error'); return; }
        // Wiederholung (0.14): erste Frist = erster Termin ab dem gewählten Datum bzw. ab heute
        const due = r ? nextOccurrence(r, val(form, 'due') || today(), true) : val(form, 'due') || null;
        finishClarify({ list: 'next', context: val(form, 'context') || null, projectId: val(form, 'projectId') || null, tickler: val(form, 'tickler') || null, due, repeat: r }, r ? `Wiederholt sich: ${repeatText(r)}.` : 'Als nächsten Schritt abgelegt.');
      }
      else if (g === 'deleg') finishClarify({ list: 'waiting', waitingFor: val(form, 'who'), tickler: val(form, 'tickler') || null, due: val(form, 'due') || null }, 'Zu „Warten auf“ hinzugefügt.');
      else {
        // Projekt: Name = Titel der Notiz, die Notiz selbst wird zum ersten Schritt
        const pid = S.createProject({ title: modal.title.trim() || 'Neues Projekt', outcome: val(form, 'outcome') });
        modal.title = val(form, 'next');
        finishClarify({ list: 'next', projectId: pid, tickler: null }, 'Projekt angelegt.', () => S.patchProject(pid, { deleted: true }));
      }
      break;
    }
    case 'restore-custom': {
      const v = val(form, 'when');
      const ts = new Date(v).getTime();
      if (!v || Number.isNaN(ts)) return;
      if (ts >= Date.now()) { toast('Wähl einen Zeitpunkt in der Vergangenheit.', 'error'); return; }
      const after = (await getAllEvents()).filter((e) => e.ts > ts).length;
      if (!after) { toast('Seit diesem Zeitpunkt hat sich nichts geändert.'); return; }
      confirmRewind(ts + 59_999, new Date(ts).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }), after);
      break;
    }
    case 'sync-probe': {
      const owner = val(form, 'owner'), repo = val(form, 'repo'), token = val(form, 'token');
      syncDraft = { owner, repo, token };
      busy = true; render();
      try {
        const probe = await Sync.probe(owner, repo, token);
        syncSetup = { owner, repo, token, probe };
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      busy = false; render();
      break;
    }
    case 'sync-connect': {
      if (!syncSetup) return;
      const p1 = val(form, 'pass1');
      if (!syncSetup.probe.header) {
        if (p1 !== val(form, 'pass2')) { toast('Die beiden Passphrasen stimmen nicht überein.', 'error'); return; }
        if (p1.length < 10) { toast('Die Passphrase braucht mindestens 10 Zeichen.', 'error'); return; }
      }
      busy = true; render();
      try {
        const { owner, repo, token, probe } = syncSetup;
        await Sync.connect(owner, repo, token, p1, probe);
        syncSetup = null;
        syncDraft = { owner: '', repo: 'head-space-data', token: '' };
        toast(Sync.status.state === 'idle' ? 'Verbunden und synchronisiert.' : 'Verbunden.');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      busy = false; render();
      break;
    }
    case 'sync-unlock': {
      busy = true; render();
      try { await Sync.unlock(val(form, 'pass')); toast('Entsperrt.'); } catch (err) { toast((err as Error).message, 'error'); }
      busy = false; render();
      break;
    }
    case 'next-step': {
      const t = val(form, 'title');
      if (!t) return;
      S.capture(t, { list: 'next', projectId: id, context: val(form, 'context') || null, due: val(form, 'due') || null, tickler: val(form, 'tickler') || null });
      modal = null; renderModal();
      toast('Nächster Schritt gespeichert.');
      break;
    }
    case 'due': {
      if (modal?.kind !== 'due') return;
      const target = modal.target;
      modal = null; renderModal();
      setDue(target, id, val(form, 'due') || null);
      break;
    }
    case 'edit': {
      const it = S.state.items.get(id);
      if (!it) return;
      const list = val(form, 'list') as ListName;
      const r = formRepeat(form);
      if (r === 'bad') { toast('Wähl mindestens einen Wochentag.', 'error'); return; }
      const ruleChanged = !!form.querySelector('[data-repeat-box]') && JSON.stringify(r) !== JSON.stringify(it.repeat ?? null);
      let due = val(form, 'due') || null;
      if (r && ruleChanged) due = nextOccurrence(r, due ?? today(), true); // neue Regel: Frist auf den nächsten Termin
      // nur speichern, was sich geändert hat (Sync: andere Geräte können inzwischen anderes geändert haben)
      const patch: Partial<Item> = changedFields(it, {
        title: val(form, 'title'), notes: (new FormData(form).get('notes') as string ?? '').trim(), list,
        context: val(form, 'context') || null, projectId: val(form, 'projectId') || null,
        waitingFor: val(form, 'waitingFor') || null, tickler: val(form, 'tickler') || null, due,
        ...(ruleChanged ? { repeat: r } : {}),
      });
      // Unteraufgaben (0.12): neue anlegen, geänderte Titel und entfernte speichern. Abhaken ist schon gespeichert.
      const subOps: (() => void)[] = [];
      const known = new Map(subtasksOf(it).map((x) => [x.id, x]));
      form.querySelectorAll<HTMLInputElement>('.sub-input').forEach((inp) => {
        const sid = inp.dataset.sid!, title = inp.value.trim();
        const done = !!inp.closest('.sub-row')?.classList.contains('is-done');
        if (sid.startsWith('neu-')) {
          if (title) subOps.push(() => { const n = S.addSubtask(id, title); if (done) S.patchSubtask(id, n, { done: true }); });
        } else if (known.has(sid)) {
          if (!title) subOps.push(() => S.patchSubtask(id, sid, { deleted: true }));
          else if (title !== known.get(sid)!.title) subOps.push(() => S.patchSubtask(id, sid, { title }));
        }
      });
      new FormData(form).getAll('sub-del').forEach((sid) => { if (known.has(String(sid))) subOps.push(() => S.patchSubtask(id, String(sid), { deleted: true })); });
      modal = null; renderModal();
      if (subOps.length) S.batch(() => subOps.forEach((f) => f()));
      if (!Object.keys(patch).length) { toast(subOps.length ? 'Gespeichert.' : 'Keine Änderungen.'); break; }
      if (list === 'done' && it.list !== 'done') {
        delete patch.list;
        completeWithUndo(id, patch);
        break;
      }
      if (list !== 'done' && it.list === 'done') patch.completed = null;
      if (list !== it.list) {
        if (list === 'trash') patch.prevList = it.list;
        patchWithUndo(id, patch, list === 'trash' ? `Gelöscht: ${short(patch.title ?? it.title)}` : `Verschoben nach ${LIST_LABEL[list]}`);
      } else {
        S.patchItem(id, patch);
        toast('Gespeichert.');
      }
      break;
    }
    case 'project': {
      const title = val(form, 'title');
      if (!title) return;
      if (id) {
        const pr = project(id);
        const patch = pr ? changedFields(pr, { title, outcome: val(form, 'outcome'), due: val(form, 'due') || null }) : {};
        if (Object.keys(patch).length) S.patchProject(id, patch);
        modal = null; renderModal(); toast('Projekt gespeichert.');
      } else {
        let pid = '';
        S.batch(() => {
          pid = S.createProject({ title, outcome: val(form, 'outcome'), due: val(form, 'due') || null });
          const next = val(form, 'next');
          if (next) S.capture(next, { list: 'next', projectId: pid, context: val(form, 'context') || null });
        });
        modal = null; renderModal(); go('project', pid);
      }
      break;
    }
    case 'export': {
      const p1 = val(form, 'pass1');
      if (p1 !== val(form, 'pass2')) { toast('Die beiden Passphrasen stimmen nicht überein.', 'error'); return; }
      if (p1.length < 10) { toast('Die Passphrase braucht mindestens 10 Zeichen.', 'error'); return; }
      busy = true; render();
      try {
        backupText = await S.exportBackup(p1);
        ['pass1', 'pass2'].forEach((i) => { const f = document.getElementById(i) as HTMLInputElement | null; if (f) f.value = ''; });
        busy = false; render();
        toast('Backup verschlüsselt.');
      } catch (err) {
        busy = false; render();
        toast('Backup fehlgeschlagen: ' + (err as Error).message, 'error');
      }
      break;
    }
    case 'import': {
      const fileInput = form.querySelector<HTMLInputElement>('input[type=file]');
      const file = fileInput?.files?.[0];
      const text = file ? await file.text() : val(form, 'text');
      if (!text) { toast('Wähl eine Backup-Datei aus oder füg den Text ein.', 'error'); return; }
      busy = true; render();
      try {
        const { added } = await S.importBackup(text, val(form, 'pass'));
        busy = false; render();
        toast(added ? `${added} Änderungen wiederhergestellt.` : 'Das Backup enthält nichts Neues. Alles ist schon da.');
      } catch (err) {
        busy = false; render();
        toast((err as Error).message, 'error');
      }
      break;
    }
  }
}

/**
 * Datum aus der Kalenderauswahl übernehmen. Safari (iPad/iPhone) meldet die Wahl teils nur mit
 * „input“ und „change“ erst beim nächsten Antippen; deshalb zählt beides. Hat das Feld noch den
 * Fokus (Rad-Auswahl), wird erst beim Verlassen übernommen, damit das Neuzeichnen die Auswahl
 * nicht unterbricht.
 */
function takeDue(el: HTMLInputElement, final: boolean) {
  if (!final && document.activeElement === el) return;
  setDue(el.dataset.kind as 'item' | 'project', el.dataset.id!, el.value || null);
}

/** Gewählte Frist im Projekt-Eingabefeld neben der Fahne anzeigen */
function showStepDue(input: HTMLInputElement) {
  const btn = input.parentElement?.querySelector<HTMLElement>('.step-due-btn');
  const txt = btn?.querySelector('.step-due-text');
  if (!btn || !txt) return;
  input.classList.remove('is-open');
  const v = input.value;
  txt.textContent = v ? (dueState(v) === 'today' ? 'Heute' : fmtDate(v)) : '';
  btn.className = `btn step-due-btn${v ? ` has-date due-${dueState(v)}` : ''}`;
  btn.setAttribute('aria-label', v ? `Frist ${fmtDate(v)}, ändern` : 'Frist wählen');
}

function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.dataset.repeatField) {
    const box = el.closest<HTMLElement>('[data-repeat-box]');
    const r = box && readRepeat(box);
    if (box && r && r.kind !== 'week') { setRepeat(box, { ...r, [el.dataset.repeatField]: Number(el.value) } as Repeat); box.querySelector<HTMLElement>(`#${el.id}`)?.focus(); }
    return;
  }
  // iPad/iPhone melden „change“ schon beim Öffnen (heute vorausgewählt) und bei jedem Drehen am Rad. Solange das
  // Feld den Fokus hat, ist die Auswahl offen: erst beim Verlassen speichern, sonst schliesst das Neuzeichnen sie.
  if (el.classList.contains('due-input')) { takeDue(el, false); return; }
  if (el.classList.contains('step-due-input')) { showStepDue(el); return; }
}

function onInput(e: Event) {
  const el = e.target as HTMLElement;
  if (el.classList.contains('due-input')) { takeDue(el as HTMLInputElement, false); return; }
  if (el.classList.contains('step-due-input')) { showStepDue(el as HTMLInputElement); return; }
  if (el.dataset.bind === 'clarify-title' && modal?.kind === 'clarify') modal.title = (el as HTMLTextAreaElement).value;
}

function onKey(e: KeyboardEvent) {
  const h = (e.target as HTMLElement).closest?.('.drag-handle') as HTMLElement | null;
  if (h) { dragKey(e, h); return; }
  if (e.key === 'Escape' && modal) { modal = null; renderModal(); return; }
  const t = e.target as HTMLElement;
  const typing = t.matches('input, textarea, select, [contenteditable]');
  if (!typing && !modal && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    modal = { kind: 'capture' }; renderModal();
  }
  if (t.id === 'clarify-title' && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
}

export function mount() {
  readHash();
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('submit', (e) => { void onSubmit(e as SubmitEvent); });
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('focusout', (e) => { const el = e.target as HTMLElement; if (el.classList?.contains('due-input')) takeDue(el as HTMLInputElement, true); });
  window.addEventListener('hashchange', () => { readHash(); render(); });
  document.addEventListener('keydown', onKey);
  S.onChange(render);
  S.onError((m) => toast(m, 'error'));
  render();
}

/** Nur für Unit-Tests (tests/unit/karten.test.ts): Karten-HTML ohne Browser prüfen. */
/** „Was ist neu“ einmal nach einem Update (0.12). Neues Gerät: nichts, nur merken. */
export async function showNewsIfUpdated() {
  try {
    const seen = await getMeta<string>('notesSeen');
    const log = (await getMeta<{ v: string; at: number }[]>('versionLog')) ?? [];
    const notes = notesSince(parseNotes(NOTES_MD), lastSeenVersion(seen, log, APP_VERSION), APP_VERSION);
    if (!notes.length) { if (seen !== APP_VERSION && /^\d/.test(APP_VERSION)) await setMeta('notesSeen', APP_VERSION); return; }
    if (modal) return; // ein anderer Dialog ist offen: beim nächsten Start
    modal = { kind: 'notes', notes };
    renderModal();
  } catch { /* nicht kritisch */ }
}

export const renderForTests = { row, projectRow, colorHtml, viewDone, viewProject, editHtml };
