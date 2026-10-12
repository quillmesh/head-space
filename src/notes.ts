// Release Notes (0.12): RELEASE-NOTES.md wird beim Bauen eingebunden und nach einem Update einmal angezeigt.
// Reine Logik, ohne Oberfläche; geprüft in tests/unit/notes.test.ts.

export interface ReleaseNote { version: string; points: string[] }

/** Versionen vergleichen („0.10.0“ > „0.9.2“) */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Liest „## <Version>“ und die Punkte „- …“ darunter. */
export function parseNotes(md: string): ReleaseNote[] {
  const out: ReleaseNote[] = [];
  let cur: ReleaseNote | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+v?(\d+\.\d+\.\d+)\s*$/.exec(line);
    if (h) { cur = { version: h[1], points: [] }; out.push(cur); continue; }
    if (/^#/.test(line)) { cur = null; continue; }
    if (cur && line.startsWith('- ')) cur.points.push(line.slice(2).trim());
    else if (cur && line && cur.points.length && /^\s{2,}/.test(raw)) cur.points[cur.points.length - 1] += ' ' + line;
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version));
}

/**
 * Was nach einem Update gezeigt wird: alle Versionen nach lastSeen bis und mit current, neueste zuerst.
 * lastSeen = null (neues Gerät, noch nie eine Version gesehen) → nichts.
 */
export function notesSince(notes: ReleaseNote[], lastSeen: string | null, current: string): ReleaseNote[] {
  if (!lastSeen || !/^\d+\.\d+\.\d+$/.test(current)) return [];
  return notes.filter((n) => cmpVersion(n.version, lastSeen) > 0 && cmpVersion(n.version, current) <= 0 && n.points.length);
}

/** Welche Version zuletzt gesehen wurde: gemerkt (notesSeen) oder die Version vor dieser laut versionLog. */
export function lastSeenVersion(notesSeen: string | null | undefined, versionLog: { v: string }[], current: string): string | null {
  if (notesSeen) return notesSeen;
  const before = [...versionLog].reverse().find((e) => e.v !== current);
  return before?.v ?? null;
}
