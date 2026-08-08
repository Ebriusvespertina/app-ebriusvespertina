export interface Counter {
  id: string;
  name: string;
  /** Current count. Always clamped to [0, MAX_VALUE]. */
  value: number;
  /** Emoji shown on the card; may be empty. */
  icon: string;
  /** Category this counter belongs to, or null for "Zonder categorie". */
  categoryId: string | null;
  /** ms timestamp, used for stable insertion order. */
  createdAt: number;
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
