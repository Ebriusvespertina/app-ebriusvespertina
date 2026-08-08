import { describe, expect, it } from "vitest";
import type { CountersState } from "./types";
import {
  MAX_HISTORY,
  MAX_VALUE,
  addCategory,
  addCounter,
  categoryGroups,
  clearHistory,
  counterStats,
  createCategory,
  createCounter,
  emptyState,
  exportFilename,
  historySeries,
  incrementCounter,
  parseState,
  removeCategory,
  removeCounter,
  renameCategory,
  resetCounter,
  serializeState,
  totals,
  uncategorizedCounters,
  updateCounter,
} from "./countersEngine";

function stateWith(counts: Array<{ name: string; value: number }>): CountersState {
  const state = emptyState();
  for (const { name, value } of counts) {
    state.counters.push({ ...createCounter(name, { value }), createdAt: state.counters.length });
  }
  return state;
}

describe("createCounter", () => {
  it("defaults to value 0, no icon and no category", () => {
    const counter = createCounter("Bier");
    expect(counter).toMatchObject({ name: "Bier", value: 0, icon: "", categoryId: null });
    expect(counter.id.length).toBeGreaterThan(0);
  });

  it("clamps non-finite and out-of-range values", () => {
    expect(createCounter("A", { value: -5 }).value).toBe(0);
    expect(createCounter("A", { value: MAX_VALUE + 10 }).value).toBe(MAX_VALUE);
    expect(createCounter("A", { value: NaN }).value).toBe(0);
  });
});

describe("incrementCounter", () => {
  it("clamps at the minimum so counters never go negative", () => {
    const state = stateWith([{ name: "Shotjes", value: 1 }]);
    const id = state.counters[0].id;
    expect(incrementCounter(state, id, -2).counters[0].value).toBe(0);
  });

  it("clamps at the maximum", () => {
    const state = stateWith([{ name: "Km", value: MAX_VALUE }]);
    const id = state.counters[0].id;
    expect(incrementCounter(state, id, 1).counters[0].value).toBe(MAX_VALUE);
  });

  it("leaves other counters untouched", () => {
    const state = stateWith([
      { name: "A", value: 3 },
      { name: "B", value: 7 },
    ]);
    const id = state.counters[0].id;
    const next = incrementCounter(state, id, 1);
    expect(next.counters.map((c) => c.value)).toEqual([4, 7]);
  });

  it("is immutable", () => {
    const state = stateWith([{ name: "A", value: 3 }]);
    const next = incrementCounter(state, state.counters[0].id, 1);
    expect(state.counters[0].value).toBe(3);
    expect(next).not.toBe(state);
    expect(next.counters[0]).not.toBe(state.counters[0]);
  });
});

describe("updateCounter / resetCounter", () => {
  it("patches only the matching counter and clamps the value", () => {
    const state = stateWith([
      { name: "A", value: 3 },
      { name: "B", value: 7 },
    ]);
    const next = updateCounter(state, state.counters[0].id, {
      name: "Wijn",
      icon: "🍷",
      value: 99_999_999,
    });
    expect(next.counters[0]).toMatchObject({ name: "Wijn", icon: "🍷", value: MAX_VALUE });
    expect(next.counters[1]).toMatchObject({ name: "B", value: 7 });
  });

  it("resetCounter sets the value back to 0", () => {
    const state = stateWith([{ name: "A", value: 12 }]);
    expect(resetCounter(state, state.counters[0].id).counters[0].value).toBe(0);
  });

  it("removeCounter drops only the matching counter", () => {
    const state = stateWith([
      { name: "A", value: 1 },
      { name: "B", value: 2 },
    ]);
    const next = removeCounter(state, state.counters[0].id);
    expect(next.counters.map((c) => c.name)).toEqual(["B"]);
  });
});

describe("categories", () => {
  it("addCategory appends", () => {
    const state = addCategory(emptyState(), createCategory("Drank"));
    expect(state.categories.map((c) => c.name)).toEqual(["Drank"]);
  });

  it("renameCategory updates the name only", () => {
    const state = addCategory(emptyState(), createCategory("Drank"));
    const next = renameCategory(state, state.categories[0].id, "Dranken");
    expect(next.categories[0].name).toBe("Dranken");
  });

  it("removeCategory moves its counters to uncategorized", () => {
    let state = addCategory(emptyState(), createCategory("Drank"));
    const categoryId = state.categories[0].id;
    state = addCounter(state, { ...createCounter("Bier"), categoryId });
    const next = removeCategory(state, categoryId);
    expect(next.categories).toEqual([]);
    expect(next.counters[0].categoryId).toBeNull();
  });
});

describe("grouping", () => {
  it("groups counters by category in insertion order with totals", () => {
    let state = addCategory(emptyState(), createCategory("Drank"));
    const drank = state.categories[0].id;
    state = addCategory(state, createCategory("Sport"));
    const sport = state.categories[1].id;
    state = addCounter(state, { ...createCounter("Bier", { value: 4 }), categoryId: drank });
    state = addCounter(state, { ...createCounter("Wijn", { value: 2 }), categoryId: drank });
    state = addCounter(state, { ...createCounter("Push-ups", { value: 30 }), categoryId: sport });
    state = addCounter(state, createCounter("Los"));

    const groups = categoryGroups(state);
    expect(groups.map((g) => g.category.name)).toEqual(["Drank", "Sport"]);
    expect(groups[0].counters.map((c) => c.name)).toEqual(["Bier", "Wijn"]);
    expect(groups[0].total).toBe(6);
    expect(groups[1].total).toBe(30);
    expect(uncategorizedCounters(state).map((c) => c.name)).toEqual(["Los"]);
    expect(totals(state)).toBe(36);
  });
});

describe("history recording", () => {
  it("records an event for applied changes when tracking is on", () => {
    const state = stateWith([{ name: "Bier", value: 0 }]);
    const id = state.counters[0].id;
    const next = incrementCounter(state, id, 1);
    expect(next.counters[0].value).toBe(1);
    expect(next.counters[0].history).toHaveLength(1);
    expect(next.counters[0].history[0].delta).toBe(1);
    expect(typeof next.counters[0].history[0].at).toBe("string");
  });

  it("does not record a clamped no-op change", () => {
    const state = stateWith([{ name: "Bier", value: 0 }]);
    const id = state.counters[0].id;
    const next = incrementCounter(state, id, -1);
    expect(next.counters[0].value).toBe(0);
    expect(next.counters[0].history).toEqual([]);
  });

  it("does not record when tracking is off", () => {
    const state = emptyState();
    state.counters.push(createCounter("Bier", { value: 0, trackHistory: false }));
    const next = incrementCounter(state, state.counters[0].id, 1);
    expect(next.counters[0].value).toBe(1);
    expect(next.counters[0].history).toEqual([]);
  });

  it("updateCounter records the applied set-delta", () => {
    const state = stateWith([{ name: "Bier", value: 5 }]);
    const id = state.counters[0].id;
    expect(updateCounter(state, id, { value: 10 }).counters[0].history[0].delta).toBe(5);
    expect(updateCounter(state, id, { value: 10 }).counters[0].history).toHaveLength(1);
    // setting the same value records nothing
    const same = updateCounter(state, id, { value: 5 });
    expect(same.counters[0].history).toEqual([]);
  });

  it("caps history at MAX_HISTORY, dropping the oldest events", () => {
    let state = stateWith([{ name: "Push-ups", value: 0 }]);
    const id = state.counters[0].id;
    // marker event (delta 1) must be the one dropped by the cap
    state = incrementCounter(state, id, 1);
    for (let i = 0; i < MAX_HISTORY; i += 1) {
      state = incrementCounter(state, id, 2);
    }
    expect(state.counters[0].history).toHaveLength(MAX_HISTORY);
    expect(state.counters[0].history.every((event) => event.delta === 2)).toBe(true);
    expect(state.counters[0].history.reduce((sum, event) => sum + event.delta, 0)).toBe(
      MAX_HISTORY * 2,
    );
  });

  it("starts recording after tracking is enabled", () => {
    let state = emptyState();
    state.counters.push(createCounter("Bier", { value: 0, trackHistory: false }));
    const id = state.counters[0].id;
    state = incrementCounter(state, id, 1);
    expect(state.counters[0].history).toEqual([]);
    state = updateCounter(state, id, { trackHistory: true });
    state = incrementCounter(state, id, 1);
    expect(state.counters[0].history).toHaveLength(1);
  });

  it("clearHistory empties the history but keeps the value", () => {
    let state = stateWith([{ name: "Bier", value: 3 }]);
    const id = state.counters[0].id;
    state = incrementCounter(state, id, 1);
    const cleared = clearHistory(state, id);
    expect(cleared.counters[0].value).toBe(4);
    expect(cleared.counters[0].history).toEqual([]);
  });
});

describe("counterStats", () => {
  it("sums plus/minus deltas and counts events", () => {
    const counter = createCounter("Bier", { value: 3, trackHistory: true });
    counter.history = [
      { at: new Date(2026, 7, 1, 10, 0).toISOString(), delta: 2 },
      { at: new Date(2026, 7, 1, 11, 0).toISOString(), delta: -1 },
      { at: new Date(2026, 7, 1, 12, 0).toISOString(), delta: 2 },
    ];
    const stats = counterStats(counter);
    expect(stats.totalPlus).toBe(4);
    expect(stats.totalMinus).toBe(-1);
    expect(stats.net).toBe(3);
    expect(stats.eventCount).toBe(3);
    expect(stats.firstAt).toBe(counter.history[0].at);
    expect(stats.lastAt).toBe(counter.history[2].at);
  });

  it("finds the busiest day and hour by event count", () => {
    const counter = createCounter("Bier", { trackHistory: true });
    counter.history = [
      { at: new Date(2026, 7, 1, 10, 0).toISOString(), delta: 1 },
      { at: new Date(2026, 7, 1, 11, 0).toISOString(), delta: 1 },
      { at: new Date(2026, 7, 1, 11, 30).toISOString(), delta: 1 },
      { at: new Date(2026, 7, 2, 9, 0).toISOString(), delta: 1 },
    ];
    const stats = counterStats(counter);
    expect(stats.busiestDayKey).toBe("2026-08-01");
    expect(stats.busiestHourKey).toBe("2026-08-01T11");
  });

  it("returns nulls for empty history", () => {
    const stats = counterStats(createCounter("Bier"));
    expect(stats.eventCount).toBe(0);
    expect(stats.firstAt).toBeNull();
    expect(stats.busiestDayKey).toBeNull();
    expect(stats.busiestHourKey).toBeNull();
  });
});

describe("historySeries", () => {
  it("returns an empty series for no history", () => {
    const counter = createCounter("Bier", { value: 7 });
    expect(historySeries(counter)).toEqual({ anchor: 7, points: [] });
  });

  it("buckets long spans per day with a correct anchor", () => {
    const counter = createCounter("Bier", { value: 10, trackHistory: true });
    counter.history = [
      { at: new Date(2026, 7, 1, 10, 0).toISOString(), delta: 2 },
      { at: new Date(2026, 7, 1, 22, 0).toISOString(), delta: 1 },
      { at: new Date(2026, 7, 5, 9, 0).toISOString(), delta: -3 },
    ];
    const series = historySeries(counter);
    // value at first event = 10 - (2+1-3) = 10
    expect(series.anchor).toBe(10);
    expect(series.points).toEqual([
      { key: "2026-08-01", cumulative: 13 },
      { key: "2026-08-05", cumulative: 10 },
    ]);
  });

  it("buckets short spans per hour", () => {
    const counter = createCounter("Bier", { value: 4, trackHistory: true });
    counter.history = [
      { at: new Date(2026, 7, 1, 10, 0).toISOString(), delta: 1 },
      { at: new Date(2026, 7, 1, 11, 30).toISOString(), delta: 2 },
      { at: new Date(2026, 7, 1, 12, 15).toISOString(), delta: -1 },
    ];
    const series = historySeries(counter);
    expect(series.anchor).toBe(2);
    expect(series.points).toEqual([
      { key: "2026-08-01T10", cumulative: 3 },
      { key: "2026-08-01T11", cumulative: 5 },
      { key: "2026-08-01T12", cumulative: 4 },
    ]);
  });
});

describe("export/import", () => {
  it("serialize -> parse round-trips the state", () => {
    let state = addCategory(emptyState(), createCategory("Drank"));
    const drank = state.categories[0].id;
    state = addCounter(state, { ...createCounter("Bier", { value: 3 }), categoryId: drank });

    const restored = parseState(serializeState(state));
    expect(restored).toEqual(state);
  });

  it("rejects invalid JSON and non-object payloads", () => {
    expect(parseState("niet geldig")).toBeNull();
    expect(parseState("[1, 2, 3]")).toBeNull();
    expect(parseState("null")).toBeNull();
    expect(parseState("{}")).toEqual(emptyState());
  });

  it("repairs missing ids and clamps values on import", () => {
    const state = parseState(
      JSON.stringify({
        counters: [
          { name: "Bier", value: -2 },
          { name: "Wijn", value: 1e12 },
          { name: "Push-ups", value: 10 },
        ],
        categories: [],
      }),
    );
    expect(state).not.toBeNull();
    const values = state!.counters.map((c) => c.value);
    expect(values).toEqual([0, MAX_VALUE, 10]);
    expect(new Set(state!.counters.map((c) => c.id)).size).toBe(3);
  });

  it("drops counters with unknown category ids", () => {
    const state = parseState(
      JSON.stringify({
        counters: [{ name: "Bier", value: 1, categoryId: "missing" }],
        categories: [],
      }),
    );
    expect(state!.counters[0].categoryId).toBeNull();
  });

  it("dedupes colliding ids", () => {
    const state = parseState(
      JSON.stringify({
        counters: [
          { id: "same", name: "A" },
          { id: "same", name: "B" },
        ],
        categories: [],
      }),
    );
    expect(new Set(state!.counters.map((c) => c.id)).size).toBe(2);
  });

  it("skips entries without a name", () => {
    const state = parseState(
      JSON.stringify({
        counters: [{ value: 5 }, { name: "Bier", value: 2 }],
        categories: [],
      }),
    );
    expect(state!.counters.map((c) => c.name)).toEqual(["Bier"]);
  });

  it("caps the number of imported entries", () => {
    const counters = Array.from({ length: 1000 }, (_, i) => ({ name: `Teller ${i}` }));
    const state = parseState(JSON.stringify({ counters, categories: [] }));
    expect(state!.counters.length).toBeLessThanOrEqual(500);
  });

  it("exportFilename contains a zero-padded date", () => {
    const name = exportFilename(new Date(2026, 0, 5));
    expect(name).toMatch(/^tellers-backup-2026-01-05\.json$/);
  });

  it("round-trips recorded history", () => {
    let state = stateWith([{ name: "Bier", value: 2 }]);
    state = incrementCounter(state, state.counters[0].id, 1);
    const restored = parseState(serializeState(state));
    expect(restored).toEqual(state);
  });

  it("imports history with validation: bad entries dropped, capped, sorted", () => {
    const state = parseState(
      JSON.stringify({
        counters: [
          {
            name: "Bier",
            value: 5,
            trackHistory: true,
            history: [
              { at: "geen datum", delta: 1 },
              { at: "2026-08-02T10:00:00.000Z", delta: 0 },
              { at: "2026-08-03T10:00:00.000Z", delta: 2 },
              { at: "2026-08-01T10:00:00.000Z", delta: 1 },
            ],
          },
        ],
        categories: [],
      }),
    );
    const counter = state!.counters[0];
    expect(counter.trackHistory).toBe(true);
    expect(counter.history.map((e) => e.delta)).toEqual([1, 2]);
    expect(counter.history[0].at).toBe("2026-08-01T10:00:00.000Z");
  });

  it("defaults trackHistory to false and history to empty when missing", () => {
    const state = parseState(
      JSON.stringify({ counters: [{ name: "Bier", value: 1 }], categories: [] }),
    );
    expect(state!.counters[0].trackHistory).toBe(false);
    expect(state!.counters[0].history).toEqual([]);
  });

  it("caps imported history at MAX_HISTORY keeping the newest", () => {
    const history = Array.from({ length: MAX_HISTORY + 50 }, (_, i) => ({
      at: new Date(2026, 7, 1, 0, 0, i).toISOString(),
      delta: 1,
    }));
    const state = parseState(
      JSON.stringify({ counters: [{ name: "Bier", value: 1, history }], categories: [] }),
    );
    expect(state!.counters[0].history).toHaveLength(MAX_HISTORY);
    expect(state!.counters[0].history[0].at).toBe(history[50].at);
  });
});
