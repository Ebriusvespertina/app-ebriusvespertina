import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
  clampWeight,
  formatTimeWithMs,
  makeSlicePath,
  normalizePresetInput,
  normalizeSettings,
  parsePresetJson,
  parseWeightInput,
  percentages,
  pickWinner,
  presetToChoices,
  serializePreset,
  shortenLabel,
  slugifyName,
  totalWeight,
} from "./wheelEngine";
import type { Choice } from "./types";

function choice(label: string, weight: number): Choice {
  return { id: label, label, weight };
}

describe("clampWeight", () => {
  it("passes values at or above the minimum through", () => {
    expect(clampWeight(1)).toBe(1);
    expect(clampWeight(0.1)).toBe(0.1);
  });

  it("clamps values below the minimum", () => {
    expect(clampWeight(0)).toBe(0.1);
    expect(clampWeight(-3)).toBe(0.1);
  });

  it("clamps NaN to the minimum", () => {
    expect(clampWeight(Number.NaN)).toBe(0.1);
  });

  it("honors an explicit minimum of 0", () => {
    expect(clampWeight(0, 0)).toBe(0);
  });
});

describe("totalWeight", () => {
  it("sums all weights", () => {
    expect(totalWeight([choice("a", 1), choice("b", 2.5), choice("c", 0)])).toBe(3.5);
  });
});

describe("percentages", () => {
  it("converts weights to shares of 100", () => {
    const shares = percentages([choice("a", 1), choice("b", 3)]);
    expect(shares[0]).toBeCloseTo(25);
    expect(shares[1]).toBeCloseTo(75);
  });

  it("returns all zeros when the total weight is 0", () => {
    expect(percentages([choice("a", 0), choice("b", 0)])).toEqual([0, 0]);
  });
});

describe("pickWinner", () => {
  it("returns null when every weight is 0", () => {
    expect(pickWinner([choice("a", 0), choice("b", 0)])).toBeNull();
  });

  it("picks the only positive-weight choice", () => {
    expect(pickWinner([choice("a", 0), choice("b", 2)])).toBe(1);
  });

  it("returns an index within the choice list", () => {
    for (let i = 0; i < 50; i += 1) {
      const index = pickWinner([choice("a", 1), choice("b", 1), choice("c", 1)]);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });
});

describe("shortenLabel", () => {
  it("keeps short labels intact", () => {
    expect(shortenLabel("2 slokken", 12)).toBe("2 slokken");
  });

  it("truncates long labels with an ellipsis", () => {
    expect(shortenLabel("een hele lange keuze naam", 10)).toBe("een hele …");
  });

  it("returns an empty string for blank labels", () => {
    expect(shortenLabel("   ", 10)).toBe("");
  });
});

describe("makeSlicePath", () => {
  it("builds a closed wedge from the center", () => {
    const path = makeSlicePath(0, 90, 49);
    expect(path.startsWith("M 50 50 L ")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    // 90° wedge must not be a large arc
    expect(path.includes("A 49 49 0 0 1")).toBe(true);
  });

  it("flags wedges wider than 180 degrees as large arcs", () => {
    const path = makeSlicePath(0, 270, 49);
    expect(path.includes("A 49 49 0 1 1")).toBe(true);
  });
});

describe("formatTimeWithMs", () => {
  it("formats hours, minutes, seconds and milliseconds", () => {
    expect(formatTimeWithMs(new Date(2026, 0, 1, 9, 5, 3, 42))).toBe("09:05:03.042");
  });
});

describe("parseWeightInput", () => {
  it("defaults empty or missing input to 1", () => {
    expect(parseWeightInput("")).toBe(1);
    expect(parseWeightInput(null)).toBe(1);
    expect(parseWeightInput(undefined)).toBe(1);
  });

  it("passes numbers through (v-model number cast)", () => {
    expect(parseWeightInput(3)).toBe(3);
    expect(parseWeightInput(0)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(parseWeightInput("2.5")).toBe(2.5);
  });

  it("falls back to 1 for garbage", () => {
    expect(parseWeightInput("abc")).toBe(1);
    expect(parseWeightInput(Number.NaN)).toBe(1);
  });
});

describe("normalizeSettings", () => {
  it("returns defaults for missing or garbage input", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ spinSpeed: "warp" })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps explicit sound and vibrate flags", () => {
    expect(normalizeSettings({ sound: false }).sound).toBe(false);
    expect(normalizeSettings({ vibrate: false }).vibrate).toBe(false);
  });

  it("accepts known spin speeds", () => {
    expect(normalizeSettings({ spinSpeed: "fast" }).spinSpeed).toBe("fast");
    expect(normalizeSettings({ spinSpeed: "slow" }).spinSpeed).toBe("slow");
  });
});

describe("normalizePresetInput", () => {
  it("rejects missing or blank names", () => {
    expect("error" in normalizePresetInput(null)).toBe(true);
    expect("error" in normalizePresetInput({ choices: [] })).toBe(true);
  });

  it("rejects presets without choices", () => {
    const result = normalizePresetInput({ name: "X", choices: [] });
    expect("error" in result).toBe(true);
  });

  it("normalizes weights, clamping negatives to zero", () => {
    const result = normalizePresetInput({
      name: "Test",
      choices: [{ label: "A", weight: -4 }, { label: "B", weight: 2.5 }],
    });
    expect(result).not.toHaveProperty("error");
    if ("preset" in result) {
      expect(result.preset.choices).toEqual([
        { label: "A", weight: 0 },
        { label: "B", weight: 2.5 },
      ]);
    }
  });

  it("rejects non-finite weights", () => {
    const result = normalizePresetInput({
      name: "Test",
      choices: [{ label: "A", weight: Infinity }],
    });
    expect("error" in result).toBe(true);
  });

  it("rejects blank labels and overlong names", () => {
    expect("error" in normalizePresetInput({ name: "X", choices: [{ label: "  ", weight: 1 }] })).toBe(true);
    expect("error" in normalizePresetInput({ name: "x".repeat(61), choices: [{ label: "A", weight: 1 }] })).toBe(true);
  });
});

describe("parsePresetJson / serializePreset", () => {
  it("round-trips a preset through JSON", () => {
    const preset = { name: "Avondeten", choices: [{ label: "Pizza", weight: 1 }] };
    const parsed = parsePresetJson(serializePreset(preset));
    expect(parsed).toEqual({ preset });
  });

  it("rejects invalid JSON", () => {
    expect("error" in parsePresetJson("{ nope")).toBe(true);
  });

  it("rejects a foreign format envelope", () => {
    expect("error" in parsePresetJson('{"format":"other","name":"X","choices":[{"label":"A","weight":1}]}')).toBe(true);
  });

  it("accepts a bare { name, choices } object", () => {
    const parsed = parsePresetJson('{"name":"X","choices":[{"label":"A","weight":1}]}');
    expect(parsed).toEqual({ preset: { name: "X", choices: [{ label: "A", weight: 1 }] } });
  });
});

describe("slugifyName", () => {
  it("slugs accents and spaces", () => {
    expect(slugifyName("Avondeten")).toBe("avondeten");
    expect(slugifyName("Wie begint?")).toBe("wie-begint");
    expect(slugifyName("Hé! Twee?" )).toBe("he-twee");
  });

  it("falls back for empty input", () => {
    expect(slugifyName("!!!")).toBe("preset");
  });
});

describe("presetToChoices", () => {
  it("assigns fresh ids and keeps labels and weights", () => {
    const choices = presetToChoices({
      name: "X",
      choices: [{ label: "A", weight: 0.5 }],
    });
    expect(choices).toHaveLength(1);
    expect(choices[0].label).toBe("A");
    expect(choices[0].weight).toBe(0.5);
    expect(typeof choices[0].id).toBe("string");
    expect(choices[0].id.length).toBeGreaterThan(0);
  });
});

describe("built-in presets", () => {
  it("are all valid presets with at least one positive-weight choice", () => {
    for (const preset of BUILT_IN_PRESETS) {
      const normalized = normalizePresetInput(preset);
      expect("error" in normalized).toBe(false);
      if ("preset" in normalized) {
        expect(normalized.preset.choices.some((c) => c.weight > 0)).toBe(true);
      }
    }
  });
});
