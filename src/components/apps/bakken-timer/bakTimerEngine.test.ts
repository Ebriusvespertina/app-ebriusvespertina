import { describe, expect, it } from "vitest";
import {
  averageTime,
  bestTime,
  formatDuration,
  formatSeconds,
  formatTime,
  makeId,
} from "./bakTimerEngine";
import type { BakEntry } from "./types";

function entry(timeMs: number): BakEntry {
  return { id: String(timeMs), timeMs, at: new Date().toISOString() };
}

describe("formatSeconds", () => {
  it("formats milliseconds as seconds with three decimals", () => {
    expect(formatSeconds(2546)).toBe("2.546");
    expect(formatSeconds(0)).toBe("0.000");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatDuration(2546)).toBe("2.546 s");
  });

  it("formats minute durations as m:ss", () => {
    expect(formatDuration(65_000)).toBe("1:05.000 s");
  });

  it("never shows negative durations", () => {
    expect(formatDuration(-100)).toBe("0.000 s");
  });
});

describe("formatTime", () => {
  it("formats local time with zero-padded fields", () => {
    expect(formatTime(new Date(2026, 0, 1, 9, 5, 3))).toBe("09:05:03");
  });
});

describe("bestTime", () => {
  it("returns the fastest entry", () => {
    expect(bestTime([entry(3000), entry(2500), entry(4000)])).toBe(2500);
  });

  it("returns null for an empty log", () => {
    expect(bestTime([])).toBeNull();
  });
});

describe("averageTime", () => {
  it("returns the mean of the entries", () => {
    expect(averageTime([entry(2000), entry(3000)])).toBe(2500);
  });

  it("returns null for an empty log", () => {
    expect(averageTime([])).toBeNull();
  });
});

describe("makeId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeId()));
    expect(ids.size).toBe(100);
  });
});
