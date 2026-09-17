/** How often the counter's value restarts at 0; "none" = continuous. */
export type ResetPeriod = "none" | "hour" | "day" | "week" | "month";

export interface CounterEvent {
  /** ISO timestamp of when the change happened. */
  at: string;
  /** Applied change to the value (negative for "af"). Never 0. */
  delta: number;
}

export interface Counter {
  id: string;
  name: string;
  /** Lifetime total (sum of all changes + initial value). Never reset in
      place: the value shown per period is derived from history. */
  value: number;
  /** Emoji shown on the card; may be empty. */
  icon: string;
  /** Category this counter belongs to, or null for "Zonder categorie". */
  categoryId: string | null;
  /** ms timestamp, used for stable insertion order. */
  createdAt: number;
  /** Auto-reset cycle; "none" keeps the value running forever. */
  resetPeriod: ResetPeriod;
  /** ms timestamp phasing the reset cycle (e.g. "my week starts Sept 30").
      Null = calendar-aligned boundaries (midnight / Monday / 1st). */
  periodStart: number | null;
  /** Timestamped changes, oldest first, capped at MAX_HISTORY. */
  history: CounterEvent[];
}

export interface Category {
  id: string;
  name: string;
  /** ms timestamp, used for stable ordering. */
  createdAt: number;
}

export interface CountersState {
  version: 1;
  counters: Counter[];
  categories: Category[];
}

/** Shape of an exported backup file, with a bit of provenance metadata. */
export interface BackupFile {
  app: "counters";
  version: 1;
  exportedAt: string;
  counters: Counter[];
  categories: Category[];
}
