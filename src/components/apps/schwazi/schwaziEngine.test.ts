import { describe, expect, it } from "vitest";
import {
  createSchwaziState,
  makePick,
  makeSchwaziConfig,
  resetSchwazi,
  syncFingers,
} from "./schwaziEngine";
import type { FingerPoint, SchwaziConfig, SchwaziState } from "./schwaziEngine";

function makeCfg(partial: Partial<SchwaziConfig> = {}): SchwaziConfig {
  return makeSchwaziConfig({ minPlayers: 1, ...partial });
}

function fingers(...pts: [number, number, number][]): FingerPoint[] {
  return pts.map(([id, x, y]) => ({ id, x, y }));
}

function hold(
  cfg: SchwaziConfig,
  s: SchwaziState,
  pts: [number, number, number][],
  seconds: number,
): void {
  const f = fingers(...pts);
  let remaining = seconds;
  const step = 1 / 60;
  while (remaining > 0) {
    syncFingers(s, f, Math.min(step, remaining), cfg);
    remaining -= step;
  }
}

describe("schwazi engine — circles", () => {
  it("spawns a circle per finger and removes it when the finger leaves", () => {
    const cfg = makeCfg();
    const s = createSchwaziState();
    const evs = syncFingers(s, fingers([7, 10, 20]), 0.1, cfg);
    expect(evs).toEqual([{ type: "join", circleId: 7 }]);
    expect(s.circles).toHaveLength(1);
    expect(s.circles[0]).toMatchObject({ id: 7, x: 10, y: 20, colorIndex: 0 });

    const evs2 = syncFingers(s, [], 0.1, cfg);
    expect(evs2).toEqual([{ type: "leave", circleId: 7 }]);
    expect(s.circles).toHaveLength(0);
  });

  it("reuses the lowest freed colour index", () => {
    const cfg = makeCfg();
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.1, cfg);
    expect(s.circles.map((c) => c.colorIndex)).toEqual([0, 1]);
    syncFingers(s, fingers([1, 0, 0]), 0.1, cfg); // finger 2 leaves
    syncFingers(s, fingers([1, 0, 0], [3, 0, 0]), 0.1, cfg); // new finger
    expect(s.circles.map((c) => c.colorIndex)).toEqual([0, 1]);
  });

  it("glides circles toward their finger with a lerp, keeping identity across moves", () => {
    const cfg = makeCfg({ lerpRate: 10 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 100, 0]), 0.1, cfg);
    // Move finger 1 far away; its circle follows but stays its own.
    syncFingers(s, fingers([1, 200, 0], [2, 100, 0]), 1 / 60, cfg);
    const c1 = s.circles.find((c) => c.id === 1)!;
    expect(c1.x).toBeGreaterThan(0);
    expect(c1.x).toBeLessThan(200); // lerped, not teleported
    // The other circle is untouched.
    expect(s.circles.find((c) => c.id === 2)!.x).toBeCloseTo(100, 6);
    // Converges with time.
    hold(cfg, s, [[1, 200, 0], [2, 100, 0]], 1);
    expect(s.circles.find((c) => c.id === 1)!.x).toBeCloseTo(200, 0);
  });
});

describe("schwazi engine — stability timer", () => {
  it("accrues only while nobody joins or leaves and minPlayers are down", () => {
    const cfg = makeCfg({ stabilityTime: 2, minPlayers: 2 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0]), 1, cfg);
    expect(s.stableTime).toBe(0); // only 1 finger < minPlayers
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.5, cfg);
    expect(s.stableTime).toBeCloseTo(0.5, 6); // join reset, then accrues
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.25, cfg);
    expect(s.stableTime).toBeCloseTo(0.75, 6);
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0]), 0.5, cfg); // join
    // the join resets the timer to 0 first, then this frame accrues 0.5
    // (without the reset it would be 0.75 + 0.5 = 1.25)
    expect(s.stableTime).toBeCloseTo(0.5, 6);
  });

  it("movement does not reset the timer — only joins and leaves do", () => {
    const cfg = makeCfg({ stabilityTime: 2, minPlayers: 1 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0]), 0.5, cfg);
    // Finger moves a lot, but no join/leave happened.
    syncFingers(s, fingers([1, 300, 300]), 1.0, cfg);
    expect(s.stableTime).toBeCloseTo(1.5, 6);
  });

  it("picks once stabilityTime has passed and ignores further fingers afterwards", () => {
    const cfg = makeCfg({ stabilityTime: 1, minPlayers: 1 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0]), 0.99, cfg);
    expect(s.phase).toBe("holding");
    const evs = syncFingers(s, fingers([1, 0, 0]), 0.02, cfg);
    expect(evs.some((e) => e.type === "pick")).toBe(true);
    expect(s.phase).toBe("done");
    expect(s.reveal).not.toBeNull();
    // Frozen: further fingers do nothing.
    expect(syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.1, cfg)).toEqual([]);
    expect(s.circles).toHaveLength(1);
  });

  it("resetSchwazi clears everything for the next round", () => {
    const cfg = makeCfg({ stabilityTime: 0.1 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.2, cfg);
    expect(s.phase).toBe("done");
    resetSchwazi(s);
    expect(s).toMatchObject({ phase: "holding", circles: [], stableTime: 0, reveal: null });
  });
});

describe("schwazi engine — modes", () => {
  it("selector picks exactly one winner", () => {
    const cfg = makeCfg({ mode: "selector" });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0]), 0.02, cfg);
    const reveal = makePick(s, cfg);
    expect(reveal!.filter((e) => e.winner)).toHaveLength(1);
    expect(reveal!.map((e) => e.circleId).sort()).toEqual([1, 2, 3]);
  });

  it("selector is deterministic with an injected rng", () => {
    const cfg = makeCfg({ mode: "selector" });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0]), 0.02, cfg);
    // Fisher–Yates with a constant rng of 0 yields a fixed permutation:
    // [1,2,3] → swap(i=2,j=0) → [3,2,1] → swap(i=1,j=0) → [2,3,1].
    const reveal = makePick(s, cfg, () => 0);
    const winner = reveal!.find((e) => e.winner)!;
    expect(winner.circleId).toBe(2);
    expect(winner.label).toBe("");
  });

  it("multi picks `count` distinct circles and clamps to the circle count", () => {
    const cfg = makeCfg({ mode: "multi", count: 2 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]), 0.02, cfg);
    const reveal = makePick(s, cfg);
    expect(reveal!.filter((e) => e.winner)).toHaveLength(2);
    expect(reveal!.filter((e) => e.winner && e.label === "KIES")).toHaveLength(2);

    // count larger than the circle count → pick all
    const cfg5 = makeCfg({ mode: "multi", count: 5 });
    const s2 = createSchwaziState();
    syncFingers(s2, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0]), 0.02, cfg5);
    const reveal2 = makePick(s2, cfg5);
    expect(reveal2!.filter((e) => e.winner)).toHaveLength(3);
  });

  it("number assigns every circle a distinct 1..N label", () => {
    const cfg = makeCfg({ mode: "number" });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0]), 0.02, cfg);
    // Same fixed permutation as above: order [2,3,1] → labels 1,2,3.
    const reveal = makePick(s, cfg, () => 0);
    expect(reveal!.map((e) => e.label).sort()).toEqual(["1", "2", "3"]);
    expect(reveal!.every((e) => e.winner)).toBe(true);
    expect(reveal!.find((e) => e.circleId === 2)!.label).toBe("1");
    expect(reveal!.find((e) => e.circleId === 1)!.label).toBe("3");
  });

  it("team splits everyone into balanced, random teams", () => {
    const cfg = makeCfg({ mode: "team", count: 2 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]), 0.02, cfg);
    const reveal = makePick(s, cfg, () => 0);
    const teams = reveal!.map((e) => e.colorIndex);
    expect(teams.every((t) => t === 0 || t === 1)).toBe(true);
    expect(teams.filter((t) => t === 0)).toHaveLength(2);
    expect(teams.filter((t) => t === 1)).toHaveLength(2);
    expect(reveal!.map((e) => e.label).sort()).toEqual(["A", "A", "B", "B"]);
  });

  it("team clamps the team count to the circle count", () => {
    const cfg = makeCfg({ mode: "team", count: 5 });
    const s = createSchwaziState();
    syncFingers(s, fingers([1, 0, 0], [2, 0, 0]), 0.02, cfg);
    const reveal = makePick(s, cfg);
    const teams = new Set(reveal!.map((e) => e.colorIndex));
    expect(teams.size).toBe(2);
    expect(reveal!.every((e) => e.winner)).toBe(true);
  });

  it("makePick returns null with no circles", () => {
    const s = createSchwaziState();
    expect(makePick(s, makeCfg())).toBeNull();
    expect(s.phase).toBe("holding");
  });
});
