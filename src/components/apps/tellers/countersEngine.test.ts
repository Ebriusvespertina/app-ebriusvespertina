import { describe, expect, it } from "vitest";
import type { CountersState } from "./types";
import {
  MAX_VALUE,
  addCategory,
  addCounter,
  categoryGroups,
  createCategory,
  createCounter,
  emptyState,
  exportFilename,
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
});
