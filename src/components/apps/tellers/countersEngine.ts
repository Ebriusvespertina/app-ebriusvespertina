import type { BackupFile, Category, Counter, CounterEvent, CountersState, ResetPeriod } from "./types";

export const RESET_PERIOD_LABELS: Record<ResetPeriod, string> = {
  none: "Loopt door",
  hour: "Per uur",
  day: "Per dag",
  week: "Per week",
  month: "Per maand",
};

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
  options: {
    icon?: string;
    categoryId?: string | null;
    value?: number;
    resetPeriod?: ResetPeriod;
  } = {},
): Counter {
  const value = clampValue(options.value ?? 0);
  const resetPeriod = options.resetPeriod ?? "none";
  const createdAt = Date.now();
  /* A periodic counter that starts with a balance: that balance belongs to the
     current period, so record it as an event. Without it the derived period
     value would discount the balance as "from before this period". */
  const history: CounterEvent[] =
    resetPeriod !== "none" && value > 0 ? [{ at: new Date(createdAt).toISOString(), delta: value }] : [];

  return {
    id: makeId(),
    name: name.slice(0, MAX_NAME_LENGTH),
    value,
    icon: (options.icon ?? "").slice(0, 16),
    categoryId: options.categoryId ?? null,
    createdAt,
    resetPeriod,
    periodStart: null,
    history,
  };
}

export function createCategory(name: string): Category {
  return {
    id: makeId(),
    name: name.slice(0, MAX_NAME_LENGTH),
    createdAt: Date.now(),
  };
}

/**
 * Temporary demo data: a counter with 365-800 random events spread over the
 * past year. Evenings and weekends get extra weight so the heatmap and period
 * views show a realistic pattern. Remove together with the "Testdata" button.
 */
export function createTestCounter(): Counter {
  const now = Date.now();
  const yearAgo = now - 364 * DAY_MS;
  const count = 365 + Math.floor(Math.random() * 436); // 365..800
  const events: CounterEvent[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const delta = Math.random() < 0.86 ? 1 : -1;
    total += delta;
    events.push({ at: randomTestTime(yearAgo, now), delta });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: makeId(),
    name: "Test teller",
    value: Math.max(0, total),
    icon: "🧪",
    categoryId: null,
    createdAt: now,
    resetPeriod: "none",
    periodStart: null,
    history: events,
  };
}

/** Rejection sampler over the past year; acceptance = testTimeWeight(...). */
function randomTestTime(from: number, to: number): string {
  const span = to - from;
  for (;;) {
    const date = new Date(from + Math.random() * span);
    if (Math.random() <= testTimeWeight(date.getDay(), date.getHours())) {
      return date.toISOString();
    }
  }
}

/** Acceptance probability for a (weekday, hour); peak weekend is 1. */
function testTimeWeight(weekday: number, hour: number): number {
  const weekend = weekday === 0 || weekday === 6 ? 0.8 : 0.45;
  let hourW: number;
  if (hour < 6) hourW = 0.15;
  else if (hour < 12) hourW = 0.55;
  else if (hour < 16) hourW = 0.8;
  else if (hour < 23) hourW = 1;
  else hourW = 0.35;
  return Math.min(weekend * hourW, 1);
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
  patch: Partial<Pick<Counter, "name" | "value" | "icon" | "categoryId" | "resetPeriod" | "periodStart">>,
): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) => {
      if (counter.id !== id) {
        return counter;
      }
      const resetPeriod = patch.resetPeriod ?? counter.resetPeriod;
      const value = patch.value !== undefined ? clampValue(patch.value) : counter.value;
      const applied = value - counter.value;
      let next: Counter = {
        ...counter,
        ...patch,
        name: patch.name !== undefined ? patch.name.slice(0, MAX_NAME_LENGTH) : counter.name,
        value,
        icon: patch.icon !== undefined ? patch.icon.slice(0, 16) : counter.icon,
        categoryId: patch.categoryId !== undefined ? patch.categoryId : counter.categoryId,
        resetPeriod,
        periodStart: patch.periodStart !== undefined ? patch.periodStart : counter.periodStart,
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
  const event: CounterEvent = { at: new Date().toISOString(), delta };
  const history = [...counter.history, event];
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  return { ...counter, history };
}

/**
 * Start (ms) of the period containing `now`, given the reset cycle and an
 * optional phase anchor. Null anchor = calendar-aligned boundaries: top of
 * the hour, midnight, Monday midnight, the 1st. A set anchor phases the cycle
 * from that instant (e.g. "week starts Sept 30").
 */
export function periodStartAt(now: Date, mode: ResetPeriod, anchor: number | null): number {
  const t = now.getTime();
  if (anchor !== null && mode !== "month") {
    const len = mode === "hour" ? 3_600_000 : mode === "day" ? 86_400_000 : 7 * 86_400_000;
    return anchor + Math.floor((t - anchor) / len) * len;
  }
  if (mode === "hour") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  }
  if (mode === "day") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (mode === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow);
    return start.getTime();
  }
  // month: boundaries fall on the anchor's day-of-month (clamped to the last
  // day), or on the 1st when there is no anchor.
  const dom = anchor === null ? 1 : new Date(anchor).getDate();
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = Math.min(dom, new Date(y, m + 1, 0).getDate());
  const candidate = new Date(y, m, day).getTime();
  if (candidate <= t) {
    return candidate;
  }
  return new Date(y, m - 1, Math.min(dom, new Date(y, m, 0).getDate())).getTime();
}

export function clearHistory(state: CountersState, id: string, now: Date = new Date()): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) => {
      if (counter.id !== id) {
        return counter;
      }
      if (counter.resetPeriod === "none") {
        // The lifetime total is the display; dropping the events keeps it.
        return { ...counter, history: [] };
      }
      /* Periodic counter: this period's value has to stay visible while the
         next period starts at 0. One marker event at `now` keeps the lifetime
         total and the period derivation in step. */
      const display = effectiveValue(counter, now);
      return {
        ...counter,
        value: display,
        history: display === 0 ? [] : [{ at: now.toISOString(), delta: display }],
      };
    }),
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

export interface CounterStats {
  /** Sum of all positive deltas (user actions, resets excluded). */
  totalPlus: number;
  /** Sum of all negative deltas (user actions, resets excluded). */
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
  let eventCount = 0;
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();
  for (const event of counter.history) {
    if (event.delta > 0) {
      totalPlus += event.delta;
    } else {
      totalMinus += event.delta;
    }
    eventCount += 1;
    const date = new Date(event.at);
    const day = periodKeyOf(date, "day");
    const hour = periodKeyOf(date, "hour");
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }
  return {
    totalPlus,
    totalMinus,
    net: totalPlus + totalMinus,
    eventCount,
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

/**
 * Event counts per weekday (row 0 = maandag) and hour of day (column 0-23),
 * for the heatmap. Counts events, not deltas.
 */
export function weekdayHourCounts(counter: Counter): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const event of counter.history) {
    const date = new Date(event.at);
    const weekday = (date.getDay() + 6) % 7; // 0 = maandag
    grid[weekday][date.getHours()] += 1;
  }
  return grid;
}

export type PeriodMode = "day" | "week" | "month";

export interface PeriodRow {
  /** Bucket start key: "YYYY-MM-DD" (day/week) or "YYYY-MM" (month). */
  key: string;
  /** Number of events inside this period. */
  events: number;
  /** Sum of deltas inside this period. */
  net: number;
}

/**
 * Per-period event counts and net deltas for the last `limit` periods ending
 * today. Weeks start on Monday (ISO), months on the 1st. Rows are
 * chronological; the final row is the current period.
 */
export function periodRows(counter: Counter, mode: PeriodMode, limit: number): PeriodRow[] {
  const counts = new Map<string, { events: number; net: number }>();
  for (const event of counter.history) {
    const key = periodKeyOf(new Date(event.at), mode);
    const row = counts.get(key) ?? { events: 0, net: 0 };
    row.events += 1;
    row.net += event.delta;
    counts.set(key, row);
  }
  const rows: PeriodRow[] = [];
  for (let i = limit - 1; i >= 0; i -= 1) {
    const key = periodKeyOf(addPeriods(new Date(), mode, -i), mode);
    const row = counts.get(key);
    rows.push(row ? { key, events: row.events, net: row.net } : { key, events: 0, net: 0 });
  }
  return rows;
}

function addPeriods(date: Date, mode: PeriodMode, offset: number): Date {
  const next = new Date(date);
  if (mode === "month") {
    next.setDate(1);
    next.setMonth(next.getMonth() + offset);
  } else if (mode === "week") {
    next.setDate(next.getDate() + offset * 7);
  } else {
    next.setDate(next.getDate() + offset);
  }
  return next;
}

export interface WindowPoint {
  /** Bucket start (ms). */
  startMs: number;
  /** Bucket end (ms, exclusive). */
  endMs: number;
  /** Value during the bucket (cumulative for continuous counters, the
      derived per-period value for periodic ones). */
  value: number;
  /** Event count inside the bucket. */
  events: number;
}

export type BucketPrecision = "15m" | "1h" | "6h" | "1d" | "1w" | "1M";

export const BUCKET_MS: Record<Exclude<BucketPrecision, "1M">, number> = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
};

/** Approximate bucket duration in ms (months count as 30 days). */
export const BUCKET_DURATION_MS: Record<BucketPrecision, number> = {
  ...BUCKET_MS,
  "1M": 30 * 86_400_000,
};

/** Approximate reset period length in ms (months count as 30 days). */
const RESET_PERIOD_MS: Record<Exclude<ResetPeriod, "none">, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/** Bucket start times covering [fromMs, toMs). Months align to calendar month starts. */
export function bucketStarts(fromMs: number, toMs: number, precision: BucketPrecision): number[] {
  const starts: number[] = [];
  if (precision === "1M") {
    // First bucket starts at the 1st of the month containing fromMs.
    const d = new Date(fromMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    while (d.getTime() < toMs) {
      starts.push(d.getTime());
      d.setMonth(d.getMonth() + 1);
    }
    return starts;
  }
  const step = BUCKET_MS[precision];
  for (let t = fromMs; t < toMs; t += step) {
    starts.push(t);
  }
  return starts;
}

/**
 * Value at time `t`: the lifetime cumulative for continuous counters, or the
 * derived per-period value (lifetime minus what accumulated before the period
 * containing `t`) for periodic ones. The basis for display, charts and stats.
 */
export function valueAt(counter: Counter, t: number): number {
  /* Everything the counter knows about `limit`: events after it are subtracted
     from the lifetime total. Trimming can only drop events *before* the oldest
     surviving one, so this stays correct when a single period holds more events
     than MAX_HISTORY — the dropped amount never leaks into the period. */
  const lifetimeUpTo = (limit: number) => {
    let sum = counter.value;
    for (const event of counter.history) {
      if (Date.parse(event.at) > limit) {
        sum -= event.delta;
      }
    }
    return sum;
  };

  if (counter.resetPeriod === "none") {
    return lifetimeUpTo(t);
  }

  const boundary = periodStartAt(new Date(t), counter.resetPeriod, counter.periodStart);
  return lifetimeUpTo(t) - lifetimeUpTo(boundary);
}

/**
 * Lifetime total that makes the derived per-period value equal `display` right
 * now. Forms show the value the user sees, so saving has to translate it back
 * into the lifetime total the model stores.
 */
export function lifetimeForDisplay(
  counter: Counter,
  display: number,
  now: Date = new Date(),
): number {
  return clampValue(counter.value + (Math.round(display) - effectiveValue(counter, now)));
}

/** Value to display right now. Non-destructive: derived from history. */
export function effectiveValue(counter: Counter, now: Date = new Date()): number {
  return Math.max(0, Math.round(valueAt(counter, now.getTime())));
}

/**
 * Bucketed values for charting the window [fromMs, toMs) at a precision. Each
 * point carries the value during its bucket and the event count, so charts
 * can draw bars (periodic) or lines (continuous) with tooltips.
 *
 * For periodic counters a bucket finer than (or equal to) the reset cycle
 * shows the running period value at its end; a coarser bucket spans multiple
 * reset periods, so it shows the aggregate (sum of deltas) of the whole
 * bucket instead — e.g. the week total for a counter that resets daily.
 */
export function historyWindow(
  counter: Counter,
  fromMs: number,
  toMs: number,
  precision: BucketPrecision,
): WindowPoint[] {
  const starts = bucketStarts(fromMs, toMs, precision);
  const aggregate =
    counter.resetPeriod !== "none" &&
    BUCKET_DURATION_MS[precision] > RESET_PERIOD_MS[counter.resetPeriod];
  const points: WindowPoint[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const startMs = starts[i];
    const endMs = i + 1 < starts.length ? starts[i + 1] : toMs;
    let events = 0;
    let deltaSum = 0;
    for (const event of counter.history) {
      const at = Date.parse(event.at);
      if (at >= startMs && at < endMs) {
        events += 1;
        deltaSum += event.delta;
      }
    }
    const value = aggregate
      ? Math.max(0, Math.round(deltaSum))
      : Math.max(0, Math.round(valueAt(counter, endMs - 1)));
    points.push({ startMs, endMs, value, events });
  }
  return points;
}

/** Local calendar key for a period; weeks start on Monday (ISO). */
function periodKeyOf(date: Date, mode: ResetPeriod): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  if (mode === "hour") {
    return `${y}-${m}-${d}T${pad2(date.getHours())}`;
  }
  if (mode === "day") {
    return `${y}-${m}-${d}`;
  }
  if (mode === "month") {
    return `${y}-${m}`;
  }
  const start = new Date(y, date.getMonth(), date.getDate());
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  return `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
      resetPeriod:
        record.resetPeriod === "hour" ||
        record.resetPeriod === "day" ||
        record.resetPeriod === "week" ||
        record.resetPeriod === "month"
          ? record.resetPeriod
          : "none",
      periodStart: Number.isFinite(record.periodStart) ? (record.periodStart as number) : null,
      history,
    };
    usedIds.add(counter.id);
    state.counters.push(counter);
  }

  return state;
}
