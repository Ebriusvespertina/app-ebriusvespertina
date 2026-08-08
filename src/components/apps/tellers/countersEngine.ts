import type { BackupFile, Category, Counter, CounterEvent, CountersState } from "./types";

export const STORAGE_KEY = "counters:v1";
export const MIN_VALUE = 0;
export const MAX_VALUE = 999_999;
/** Hard caps on imported data so a hostile/accidental backup can't bloat storage. */
export const MAX_COUNTERS = 500;
export const MAX_CATEGORIES = 200;
export const MAX_NAME_LENGTH = 60;
/** Per-counter cap on recorded events; the oldest are dropped first. */
export const MAX_HISTORY = 2000;
/** Spans longer than this switch the chart from hourly to daily buckets. */
export const DAY_MS = 86_400_000;

export function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampValue(value: number) {
  if (!Number.isFinite(value)) {
    return MIN_VALUE;
  }
  return Math.min(MAX_VALUE, Math.max(MIN_VALUE, Math.round(value)));
}

export function createCounter(
  name: string,
  options: { icon?: string; categoryId?: string | null; value?: number; trackHistory?: boolean } = {},
): Counter {
  return {
    id: makeId(),
    name: name.slice(0, MAX_NAME_LENGTH),
    value: clampValue(options.value ?? 0),
    icon: (options.icon ?? "").slice(0, 16),
    categoryId: options.categoryId ?? null,
    createdAt: Date.now(),
    trackHistory: options.trackHistory ?? true,
    history: [],
  };
}

export function createCategory(name: string): Category {
  return {
    id: makeId(),
    name: name.slice(0, MAX_NAME_LENGTH),
    createdAt: Date.now(),
  };
}

export function emptyState(): CountersState {
  return { version: 1, counters: [], categories: [] };
}

export function addCounter(state: CountersState, counter: Counter): CountersState {
  return { ...state, counters: [...state.counters, counter] };
}

export function addCategory(state: CountersState, category: Category): CountersState {
  return { ...state, categories: [...state.categories, category] };
}

export function updateCounter(
  state: CountersState,
  id: string,
  patch: Partial<Pick<Counter, "name" | "value" | "icon" | "categoryId" | "trackHistory">>,
): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) => {
      if (counter.id !== id) {
        return counter;
      }
      const trackHistory = patch.trackHistory ?? counter.trackHistory;
      const value = patch.value !== undefined ? clampValue(patch.value) : counter.value;
      const applied = value - counter.value;
      let next: Counter = {
        ...counter,
        ...patch,
        name: patch.name !== undefined ? patch.name.slice(0, MAX_NAME_LENGTH) : counter.name,
        value,
        trackHistory,
        icon: patch.icon !== undefined ? patch.icon.slice(0, 16) : counter.icon,
        categoryId: patch.categoryId !== undefined ? patch.categoryId : counter.categoryId,
      };
      if (applied !== 0) {
        next = appendEvent(next, applied);
      }
      return next;
    }),
  };
}

export function incrementCounter(state: CountersState, id: string, delta: number): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) => {
      if (counter.id !== id) {
        return counter;
      }
      const value = clampValue(counter.value + delta);
      const applied = value - counter.value;
      const next: Counter = { ...counter, value };
      return applied !== 0 ? appendEvent(next, applied) : next;
    }),
  };
}

function appendEvent(counter: Counter, delta: number): Counter {
  if (!counter.trackHistory) {
    return counter;
  }
  const event: CounterEvent = { at: new Date().toISOString(), delta };
  const history = [...counter.history, event];
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  return { ...counter, history };
}

export function clearHistory(state: CountersState, id: string): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) =>
      counter.id === id ? { ...counter, history: [] } : counter,
    ),
  };
}

export function resetCounter(state: CountersState, id: string): CountersState {
  return updateCounter(state, id, { value: 0 });
}

export function removeCounter(state: CountersState, id: string): CountersState {
  return { ...state, counters: state.counters.filter((counter) => counter.id !== id) };
}

export function renameCategory(state: CountersState, id: string, name: string): CountersState {
  return {
    ...state,
    categories: state.categories.map((category) =>
      category.id === id ? { ...category, name: name.slice(0, MAX_NAME_LENGTH) } : category,
    ),
  };
}

export function removeCategory(state: CountersState, id: string): CountersState {
  return {
    ...state,
    categories: state.categories.filter((category) => category.id !== id),
    counters: state.counters.map((counter) =>
      counter.categoryId === id ? { ...counter, categoryId: null } : counter,
    ),
  };
}

/** Counters without a category, in insertion order. */
export function uncategorizedCounters(state: CountersState): Counter[] {
  return state.counters
    .filter((counter) => counter.categoryId === null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Category with its counters (insertion order) and summed value. */
export interface CategoryGroup {
  category: Category;
  counters: Counter[];
  total: number;
}

/** Categories in insertion order, each with its counters. Uncategorized counters are excluded. */
export function categoryGroups(state: CountersState): CategoryGroup[] {
  return state.categories
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((category) => {
      const counters = state.counters
        .filter((counter) => counter.categoryId === category.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      return {
        category,
        counters,
        total: counters.reduce((sum, counter) => sum + counter.value, 0),
      };
    });
}

export function totals(state: CountersState) {
  return state.counters.reduce((sum, counter) => sum + counter.value, 0);
}

function bucketKey(date: Date, mode: "day" | "hour") {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (mode === "day") {
    return `${y}-${m}-${d}`;
  }
  return `${y}-${m}-${d}T${String(date.getHours()).padStart(2, "0")}`;
}

export interface CounterStats {
  /** Sum of all positive deltas. */
  totalPlus: number;
  /** Sum of all negative deltas (<= 0). */
  totalMinus: number;
  /** totalPlus + totalMinus. */
  net: number;
  eventCount: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Local day with the most events, "YYYY-MM-DD". */
  busiestDayKey: string | null;
  /** Local hour with the most events, "YYYY-MM-DDTHH". */
  busiestHourKey: string | null;
}

export function counterStats(counter: Counter): CounterStats {
  let totalPlus = 0;
  let totalMinus = 0;
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();
  for (const event of counter.history) {
    if (event.delta > 0) {
      totalPlus += event.delta;
    } else {
      totalMinus += event.delta;
    }
    const date = new Date(event.at);
    dayCounts.set(bucketKey(date, "day"), (dayCounts.get(bucketKey(date, "day")) ?? 0) + 1);
    hourCounts.set(bucketKey(date, "hour"), (hourCounts.get(bucketKey(date, "hour")) ?? 0) + 1);
  }
  return {
    totalPlus,
    totalMinus,
    net: totalPlus + totalMinus,
    eventCount: counter.history.length,
    firstAt: counter.history[0]?.at ?? null,
    lastAt: counter.history[counter.history.length - 1]?.at ?? null,
    busiestDayKey: maxKey(dayCounts),
    busiestHourKey: maxKey(hourCounts),
  };
}

function maxKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export interface HistoryPoint {
  /** Bucket key: "YYYY-MM-DD" (daily) or "YYYY-MM-DDTHH" (hourly). */
  key: string;
  /** Counter value at the end of this bucket. */
  cumulative: number;
}

export interface HistorySeries {
  /** Value at the first retained event; points build on this. */
  anchor: number;
  points: HistoryPoint[];
}

/**
 * Bucket the recorded events for charting. Long spans (> 3 days) are bucketed
 * per day, shorter ones per hour. Buckets are chronological and cumulative.
 */
export function historySeries(counter: Counter): HistorySeries {
  if (counter.history.length === 0) {
    return { anchor: counter.value, points: [] };
  }
  const first = new Date(counter.history[0].at).getTime();
  const last = new Date(counter.history[counter.history.length - 1].at).getTime();
  const mode: "day" | "hour" = last - first > DAY_MS * 3 ? "day" : "hour";
  const deltas = new Map<string, number>();
  for (const event of counter.history) {
    const key = bucketKey(new Date(event.at), mode);
    deltas.set(key, (deltas.get(key) ?? 0) + event.delta);
  }
  const total = counter.history.reduce((sum, event) => sum + event.delta, 0);
  const anchor = counter.value - total;
  const points: HistoryPoint[] = [];
  let cumulative = anchor;
  for (const [key, delta] of deltas) {
    cumulative += delta;
    points.push({ key, cumulative });
  }
  return { anchor, points };
}

export function exportFilename(now: Date = new Date()) {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `tellers-backup-${yyyy}-${mm}-${dd}.json`;
}

export function serializeState(state: CountersState): string {
  const backup: BackupFile = {
    app: "counters",
    version: 1,
    exportedAt: new Date().toISOString(),
    counters: state.counters,
    categories: state.categories,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Parse and validate an imported backup. Returns null when the payload is not
 * a usable counters backup. Lenient on shape: missing ids/icons are repaired,
 * values are clamped, and unknown fields are dropped.
 */
export function parseState(json: string): CountersState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const rawCounters = Array.isArray(source.counters) ? source.counters : [];
  const rawCategories = Array.isArray(source.categories) ? source.categories : [];

  const state = emptyState();
  const usedIds = new Set<string>();

  for (const item of rawCategories.slice(0, MAX_CATEGORIES)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      continue;
    }
    const category: Category = {
      id: typeof record.id === "string" && record.id && !usedIds.has(record.id) ? record.id : makeId(),
      name: name.slice(0, MAX_NAME_LENGTH),
      createdAt: Number.isFinite(record.createdAt) ? (record.createdAt as number) : Date.now(),
    };
    usedIds.add(category.id);
    state.categories.push(category);
  }

  const categoryIds = new Set(state.categories.map((category) => category.id));
  for (const item of rawCounters.slice(0, MAX_COUNTERS)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      continue;
    }
    const categoryId = typeof record.categoryId === "string" ? record.categoryId : null;
    const history: CounterEvent[] = [];
    if (Array.isArray(record.history)) {
      for (const entry of record.history) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const event = entry as Record<string, unknown>;
        const at = typeof event.at === "string" ? event.at : "";
        const delta = typeof event.delta === "number" ? event.delta : NaN;
        if (!at || !Number.isFinite(delta) || delta === 0 || !Number.isFinite(Date.parse(at))) {
          continue;
        }
        history.push({ at, delta });
      }
      history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
    }
    const counter: Counter = {
      id: typeof record.id === "string" && record.id && !usedIds.has(record.id) ? record.id : makeId(),
      name: name.slice(0, MAX_NAME_LENGTH),
      value: clampValue(typeof record.value === "number" ? record.value : 0),
      icon: typeof record.icon === "string" ? record.icon.slice(0, 16) : "",
      categoryId: categoryId !== null && categoryIds.has(categoryId) ? categoryId : null,
      createdAt: Number.isFinite(record.createdAt) ? (record.createdAt as number) : Date.now(),
      trackHistory: record.trackHistory === true,
      history,
    };
    usedIds.add(counter.id);
    state.counters.push(counter);
  }

  return state;
}
