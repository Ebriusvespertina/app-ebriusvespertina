import type { BackupFile, Category, Counter, CountersState } from "./types";

export const STORAGE_KEY = "counters:v1";
export const MIN_VALUE = 0;
export const MAX_VALUE = 999_999;
/** Hard caps on imported data so a hostile/accidental backup can't bloat storage. */
export const MAX_COUNTERS = 500;
export const MAX_CATEGORIES = 200;
export const MAX_NAME_LENGTH = 60;

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
  options: { icon?: string; categoryId?: string | null; value?: number } = {},
): Counter {
  return {
    id: makeId(),
    name: name.slice(0, MAX_NAME_LENGTH),
    value: clampValue(options.value ?? 0),
    icon: (options.icon ?? "").slice(0, 16),
    categoryId: options.categoryId ?? null,
    createdAt: Date.now(),
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
  patch: Partial<Pick<Counter, "name" | "value" | "icon" | "categoryId">>,
): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) => {
      if (counter.id !== id) {
        return counter;
      }
      return {
        ...counter,
        ...patch,
        name: patch.name !== undefined ? patch.name.slice(0, MAX_NAME_LENGTH) : counter.name,
        value: patch.value !== undefined ? clampValue(patch.value) : counter.value,
        icon: patch.icon !== undefined ? patch.icon.slice(0, 16) : counter.icon,
        categoryId: patch.categoryId !== undefined ? patch.categoryId : counter.categoryId,
      };
    }),
  };
}

export function incrementCounter(state: CountersState, id: string, delta: number): CountersState {
  return {
    ...state,
    counters: state.counters.map((counter) =>
      counter.id === id ? { ...counter, value: clampValue(counter.value + delta) } : counter,
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
    const counter: Counter = {
      id: typeof record.id === "string" && record.id && !usedIds.has(record.id) ? record.id : makeId(),
      name: name.slice(0, MAX_NAME_LENGTH),
      value: clampValue(typeof record.value === "number" ? record.value : 0),
      icon: typeof record.icon === "string" ? record.icon.slice(0, 16) : "",
      categoryId: categoryId !== null && categoryIds.has(categoryId) ? categoryId : null,
      createdAt: Number.isFinite(record.createdAt) ? (record.createdAt as number) : Date.now(),
    };
    usedIds.add(counter.id);
    state.counters.push(counter);
  }

  return state;
}
