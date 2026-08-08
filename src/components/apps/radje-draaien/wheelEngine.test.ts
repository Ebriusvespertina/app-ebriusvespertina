import { describe, expect, it } from "vitest";
import {
  clampWeight,
  formatTimeWithMs,
  makeSlicePath,
  percentages,
  pickWinner,
  shortenLabel,
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
