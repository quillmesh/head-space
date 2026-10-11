// Zufallstests (property-based) für die Datenkonsistenz zwischen Geräten.
//
// Statt einzelner, von Hand ausgedachter Fälle erzeugt der Test viele zufällige Abläufe:
// zwei Geräte mit verschieden gehenden Uhren erfassen, ändern, löschen, ziehen, leeren den
// Papierkorb und gleichen zu zufälligen Zeitpunkten ab. Am Ende werden Regeln geprüft, die
// IMMER gelten müssen (siehe REGELN unten).
//
// Schlägt eine Regel fehl, verkleinert der Test den Ablauf automatisch auf möglichst wenige
// Schritte („Shrinking“) und gibt ihn zusammen mit dem Startwert (Seed) aus. Mit
//   SYNC_SEED=<Zahl> bun test tests/unit/sync-zufall.test.ts
// lässt sich genau dieser Ablauf wiederholen. SYNC_RUNS=<Anzahl> ändert die Anzahl Abläufe.
import { afterAll, describe, expect, setSystemTime, test } from 'bun:test';
import * as S from '../../src/store';
import * as db from '../../src/db';
import type { GtdEvent } from '../../src/types';

// ---------- Zufall mit Startwert (wiederholbar) ----------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- Ablauf: Liste von Schritten, unabhängig vom Zustand beschreibbar ----------
// Ziele werden als Zahl gewählt und beim Ausführen auf die vorhandenen Einträge abgebildet (k mod Anzahl).
// So bleibt ein Ablauf gültig, wenn beim Verkleinern Schritte wegfallen.
type Dev = 'A' | 'B';
type Step =
  | { dev: Dev; op: 'capture' | 'title' | 'notes' | 'due' | 'complete' | 'restore' | 'trash' | 'empty' | 'project' | 'step' | 'move' | 'delproject'; k: number; m: number; dt: number }
  | { op: 'sync'; dir: 'AB' | 'BA' | 'both' };

const DEV_OPS = ['capture', 'capture', 'title', 'notes', 'due', 'complete', 'restore', 'trash', 'trash', 'empty', 'project', 'step', 'step', 'move', 'delproject'] as const;

function plan(seed: number, length: number): Step[] {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const steps: Step[] = [];
  for (let i = 0; i < length; i++) {
    if (r() < 0.15) steps.push({ op: 'sync', dir: pick(['AB', 'BA', 'both'] as const) });
    else steps.push({ dev: r() < 0.5 ? 'A' : 'B', op: pick(DEV_OPS), k: Math.floor(r() * 1000), m: Math.floor(r() * 1000), dt: 1 + Math.floor(r() * 120_000) });
  }
  return steps;
}

// ---------- Geräte simulieren (die App ist ein Singleton: Gerät = eigenes Ereignis-Log) ----------
interface Device { id: string; log: GtdEvent[]; skew: number }
let now = Date.UTC(2026, 9, 11, 8, 0, 0);

async function use(d: Device) {
  setSystemTime(new Date(now + d.skew));
  db.resetMemoryForTests(); S.resetForTests();
  await db.setMeta('device', d.id);
  if (d.log.length) await db.putEvents(d.log);
  await S.init();
}
async function save(d: Device) { await S.whenSaved(); d.log = await db.allEvents(); }
async function receive(to: Device, from: Device) { await use(to); await S.mergeEvents(from.log); await save(to); }

const openItems = () => [...S.state.items.values()].filter((i) => !i.deleted).sort((a, b) => a.id.localeCompare(b.id));
const liveProjects = () => [...S.state.projects.values()].filter((p) => !p.deleted).sort((a, b) => a.id.localeCompare(b.id));
const nth = <T,>(a: T[], k: number) => (a.length ? a[k % a.length] : undefined);

async function act(d: Device, s: Extract<Step, { dev: Dev }>) {
  now += s.dt;
  await use(d);
  const it = nth(openItems(), s.k);
  const pr = nth(liveProjects(), s.k);
  switch (s.op) {
    case 'capture': S.capture(`Aufgabe ${s.k}`); break;
    case 'title': if (it) S.patchItem(it.id, { title: `Titel ${s.m}` }); break;
    case 'notes': if (it) S.patchItem(it.id, { notes: `Notiz ${s.m}` }); break;
    case 'due': if (it) S.patchItem(it.id, { due: s.m % 3 === 0 ? null : `2026-10-${String(10 + (s.m % 20)).padStart(2, '0')}` }); break;
    case 'complete': if (it && it.list !== 'done' && it.list !== 'trash') S.completeItem(it.id); break;
    case 'restore': if (it && (it.list === 'done' || it.list === 'trash')) S.restoreItem(it.id); break;
    case 'trash': if (it && it.list !== 'trash') S.trashItem(it.id); break;
    case 'empty': S.emptyTrash(); break;
    case 'project': S.createProject({ title: `Projekt ${s.k}` }); break;
    case 'step': if (pr) S.addProjectStep(pr.id, `Schritt ${s.m}`); break;
    case 'move': {
      if (!pr) break;
      const steps = [...S.state.items.values()].filter((i) => i.projectId === pr.id && i.list === 'next' && !i.deleted);
      const st = nth(steps, s.m);
      if (st) S.moveProjectItem(pr.id, st.id, s.m % Math.max(1, steps.length));
      break;
    }
    case 'delproject': if (pr) S.deleteProject(pr.id); break;
  }
  await save(d);
}

/** Zustand ohne Zeitstempel, sortiert (wie window.kopfFrei.snapshot in main.ts) */
const snapshot = () => JSON.stringify({
  items: [...S.state.items.values()].map(({ updated: _u, ...i }) => i).sort((a, b) => a.id.localeCompare(b.id)),
  projects: [...S.state.projects.values()].map(({ updated: _u, ...p }) => p).sort((a, b) => a.id.localeCompare(b.id)),
  contexts: [...S.state.contexts].sort(),
});

// ---------- Regeln, die nach jedem Ablauf gelten müssen ----------
type Check = { name: string; ok: boolean; detail?: string };

async function run(steps: Step[], skewB: number): Promise<Check[]> {
  now = Date.UTC(2026, 9, 11, 8, 0, 0);
  const A: Device = { id: 'geraet-A', log: [], skew: 0 };
  const B: Device = { id: 'geraet-B', log: [], skew: skewB };
  for (const s of steps) {
    if (s.op === 'sync') {
      if (s.dir !== 'BA') await receive(B, A);
      if (s.dir !== 'AB') await receive(A, B);
    } else await act(s.dev === 'A' ? A : B, s);
  }
  // Schluss-Abgleich in beide Richtungen
  await receive(B, A); await receive(A, B);
  await use(A); const snapA = snapshot();
  await use(B); const snapB = snapshot();
  const checks: Check[] = [];
  checks.push({ name: 'Konvergenz: nach dem Abgleich haben beide Geräte exakt denselben Zustand', ok: snapA === snapB, detail: snapA === snapB ? undefined : `A=${snapA}\nB=${snapB}` });

  // Ein neues Gerät, das alle Ereignisse in zufälliger Reihenfolge bekommt, kommt zum gleichen Zustand
  const all = [...A.log];
  const r = rng(all.length + 7);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const C: Device = { id: 'geraet-C', log: [], skew: 0 };
  await use(C); await S.mergeEvents(all.slice(0, Math.floor(all.length / 2))); await S.mergeEvents(all.slice(Math.floor(all.length / 2)));
  checks.push({ name: 'Reihenfolge egal: neues Gerät mit gemischt eintreffenden Ereignissen kommt zum gleichen Zustand', ok: snapshot() === snapA });

  // Nochmals abgleichen ändert nichts (idempotent)
  await use(A);
  const added = await S.mergeEvents(B.log);
  checks.push({ name: 'Idempotent: erneuter Abgleich bringt keine neuen Ereignisse und ändert nichts', ok: added === 0 && snapshot() === snapA });

  // Endgültig Gelöschtes bleibt leer (auch wenn ein anderes Gerät es danach noch geändert hat)
  const leaking = [...S.state.items.values()].filter((i) => i.deleted && (i.title !== '' || i.notes !== ''));
  const leakingP = [...S.state.projects.values()].filter((p) => p.deleted && (p.title !== '' || p.outcome !== ''));
  checks.push({ name: 'Endgültig Gelöschtes bleibt leer', ok: !leaking.length && !leakingP.length, detail: JSON.stringify([...leaking, ...leakingP]) });

  // Entscheid 0.11: Aufgaben eines gelöschten Projekts sind mitgelöscht, auch wenn ein anderes Gerät
  // gleichzeitig einen Schritt hinzugefügt hat (verwaister Schritt).
  const orphan = [...S.state.items.values()].filter((i) => !i.deleted && i.projectId && S.state.projects.get(i.projectId)?.deleted);
  checks.push({ name: 'Keine offene Aufgabe in einem gelöschten Projekt', ok: !orphan.length, detail: JSON.stringify(orphan) });
  return checks;
}


/** Verkleinert einen fehlschlagenden Ablauf: Schritte weglassen, solange die Regel weiterhin verletzt ist. */
async function shrink(steps: Step[], skew: number, rule: string): Promise<Step[]> {
  const fails = async (s: Step[]) => (await run(s, skew)).some((c) => c.name === rule && !c.ok);
  let cur = steps;
  for (let size = Math.ceil(cur.length / 2); size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i + size <= cur.length;) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + size)];
      if (await fails(cand)) cur = cand; else i += size;
    }
  }
  return cur;
}

const RUNS = Number(process.env.SYNC_RUNS ?? 150);
const FIXED = process.env.SYNC_SEED ? Number(process.env.SYNC_SEED) : null;

describe('Sync: Zufallsabläufe auf zwei Geräten', () => {
  test(`${FIXED ?? RUNS} Abläufe, Geräte-Uhren bis ±10 Minuten verstellt`, async () => {
    const seeds = FIXED != null ? [FIXED] : Array.from({ length: RUNS }, (_, i) => 1000 + i);
    for (const seed of seeds) {
      const r = rng(seed * 31);
      const length = 10 + Math.floor(r() * 30);
      const skew = Math.round((r() - 0.5) * 20 * 60_000);
      const steps = plan(seed, length);
      const bad = (await run(steps, skew)).find((c) => !c.ok);
      if (bad) {
        const small = await shrink(steps, skew, bad.name);
        const detail = (await run(small, skew)).find((c) => c.name === bad.name)?.detail ?? '';
        throw new Error(`Regel verletzt: ${bad.name}\nSeed ${seed}, Uhr B ${skew} ms\nKleinster Ablauf (${small.length} Schritte):\n${small.map((s) => JSON.stringify(s)).join('\n')}\n${detail}`);
      }
    }
    expect(true).toBe(true);
  }, 120_000);
});

afterAll(() => setSystemTime());
