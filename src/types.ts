// Datenmodell nach "Getting Things Done" (David Allen)

/** Die Listen aus dem Buch. "done" und "trash" sind Ablagen der App. */
export type ListName =
  | 'inbox'      // Eingang: noch nicht geklärt
  | 'next'       // Nächste Schritte
  | 'waiting'    // Warten auf (delegiert)
  | 'someday'    // Irgendwann/Vielleicht
  | 'reference'  // Referenzmaterial (nicht umsetzbar, aber nützlich)
  | 'done'
  | 'trash';

export interface Item {
  id: string;
  title: string;
  notes: string;
  list: ListName;
  /** Kontext wie "@Telefon". null = ohne Kontext */
  context: string | null;
  projectId: string | null;
  /** Bei "Warten auf": wer ist dran? */
  waitingFor: string | null;
  /** Wiedervorlage (Tickler) als YYYY-MM-DD: vorher unsichtbar bzw. "nachfassen ab" */
  tickler: string | null;
  /** Fälligkeitsdatum (Deadline) als YYYY-MM-DD. Fehlt bei älteren Einträgen. */
  due?: string | null;
  created: number;
  updated: number;
  completed: number | null;
  /** Liste vor "erledigt" oder "Papierkorb", für Wiederherstellen */
  prevList?: ListName | null;
  /** Endgültig gelöscht (Papierkorb geleert) */
  deleted?: boolean;
  /** Eigene Position innerhalb des Projekts (Ziehen in der Projektansicht). null = nach Frist. Ab 0.8. */
  order?: number | null;
  /** Unteraufgaben (0.12). Werden über das Ereignis „item.sub“ einzeln geändert, damit zwei Geräte sich nicht überschreiben. */
  subtasks?: Subtask[];
  /** Wiederholung (0.14). null = einmalig. Jede Wiederholung ist eine eigene Aufgabe derselben Serie. */
  repeat?: Repeat | null;
  /** Serie (0.14): ID der ersten Aufgabe; Folge-Aufgaben haben die ID „<Serie>~<Datum>“. */
  series?: string | null;
}

/** Wiederholung (0.14): wöchentlich an Wochentagen (0 = Montag … 6 = Sonntag), monatlich an Tag X, jährlich am Tag. */
export type Repeat =
  | { kind: 'week'; days: number[] }
  | { kind: 'month'; day: number }
  | { kind: 'year'; month: number; day: number };

/** Unteraufgabe einer Aufgabe (0.12). Sichtbar nur im Dialog der Aufgabe. */
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  /** Reihenfolge: Zeitpunkt des Anlegens */
  order: number;
  deleted?: boolean;
}

export type ProjectStatus = 'active' | 'someday' | 'done' | 'dropped';

export interface Project {
  id: string;
  title: string;
  /** Gewünschtes Ergebnis: "Wie sieht es aus, wenn es fertig ist?" */
  outcome: string;
  status: ProjectStatus;
  /** Fälligkeitsdatum des ganzen Projekts als YYYY-MM-DD */
  due?: string | null;
  created: number;
  updated: number;
  completed: number | null;
  deleted?: boolean;
  /** 0.8–0.9: „Nur die nächste“. Seit 0.10 ohne Wirkung; bleibt nur erhalten (Felder werden nie entfernt). */
  sequential?: boolean;
  /** Selbst gewählte Farbe (0.12), Schlüssel aus PROJECT_COLORS in logic.ts. null = automatisch nach Erstellung. */
  color?: string | null;
  /** Zeitpunkt des Verwerfens (0.14), für „nach 30 Tagen im Papierkorb“. Fehlt bei älteren: letzte Änderung. */
  droppedAt?: number | null;
}

/**
 * Jede Änderung wird als unveränderliches Ereignis gespeichert.
 * Der aktuelle Zustand entsteht durch Abspielen aller Ereignisse in Zeitreihenfolge.
 * Damit lassen sich Ereignisse mehrerer Geräte später einfach zusammenführen (Sync).
 */
export type EventType =
  | 'item.create'
  | 'item.patch'
  | 'project.create'
  | 'project.patch'
  | 'context.add'
  | 'context.remove'
  /** 0.12: eine Unteraufgabe anlegen oder ändern ({ id, sid, patch }) */
  | 'item.sub';

export interface GtdEvent {
  id: string;
  ts: number;
  device: string;
  /** Bekannte Typen siehe EventType. Neuere Versionen können weitere Typen schreiben. */
  type: EventType | (string & {});
  data: any;
  /** Format-Version (fehlt bei Ereignissen aus Version 0.1–0.3 = Format 1) */
  v?: number;
}

export interface State {
  items: Map<string, Item>;
  projects: Map<string, Project>;
  contexts: string[];
}
