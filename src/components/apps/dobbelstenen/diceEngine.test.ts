import { describe, expect, it } from "vitest";
import { lockedCount, lockedTotal, rollDieValue } from "./diceEngine";
import type { Die } from "./types";

function makeDie(value: number, locked = false, lockGroup: number | null = null): Die {
  return { id: 0, value: value as Die["value"], locked, lockGroup };
}

describe("lockedTotal", () => {
  it("sums only locked dice", () => {
    const dice = [
      makeDie(4, true, 1),
      makeDie(2, true, 2),
      makeDie(6, false),
      makeDie(5, false),
    ];
    expect(lockedTotal(dice)).toBe(6);
  });

  it("returns 0 with no locked dice", () => {
    expect(lockedTotal([makeDie(1), makeDie(6)])).toBe(0);
  });
});

describe("lockedCount", () => {
  it("counts locked dice", () => {
    const dice = [
      makeDie(4, true, 1),
      makeDie(2, true, 1),
      makeDie(6, false),
    ];
    expect(lockedCount(dice)).toBe(2);
  });
});

describe("rollDieValue", () => {
  it("always returns a value in 1..6", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 600; i += 1) {
      const value = rollDieValue();
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect(seen.size).toBe(6);
  });
});
