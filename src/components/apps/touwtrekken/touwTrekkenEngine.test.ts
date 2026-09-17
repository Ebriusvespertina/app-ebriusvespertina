import { describe, expect, it } from "vitest";
import {
  clamp,
  createTugState,
  makeTugConfig,
  pickCriticalSpot,
  pullTug,
  stepTug,
  tapAllowed,
  TAP_COOLDOWN_MS,
} from "./touwTrekkenEngine";
import type { PlayerIndex, TugConfig, TugState } from "./touwTrekkenEngine";

function makeCfg(w = 390, h = 844): TugConfig {
  return makeTugConfig(w, h, { top: 14, bottom: 14 });
}

function centre(cfg: TugConfig): number {
  return cfg.fieldH / 2;
}

/** Tap `player` until the round resolves; returns the winning player. */
function tapToScore(cfg: TugConfig, s: TugState, player: PlayerIndex): PlayerIndex {
  const tapsNeeded = Math.ceil(
    Math.abs(centre(cfg) - cfg.winLineY[player]) / cfg.tapStrength,
  );
  // The first tapsNeeded - 1 pulls stay short of the line; the tap that
  // reaches it resolves the round with a "score" event instead of a "tug".
  for (let i = 0; i < tapsNeeded - 1; i += 1) {
    const evs = pullTug(s, player, cfg);
    expect(evs.some((e) => e.type === "tug")).toBe(true);
  }
  const evs = pullTug(s, player, cfg);
  const score = evs.find((e) => e.type === "score");
  expect(score).toBeDefined();
  return (score as { type: "score"; winner: PlayerIndex }).winner;
}

describe("makeTugConfig", () => {
  it("scales gameplay numbers with the smaller field dimension", () => {
    const small = makeCfg(380, 700);
    const large = makeCfg(400, 860);
    const smin = Math.min(small.fieldW, small.fieldH);
    const lmin = Math.min(large.fieldW, large.fieldH);
    expect(large.tapStrength / lmin).toBeCloseTo(small.tapStrength / smin, 10);
    expect(large.decaySpeed / lmin).toBeCloseTo(small.decaySpeed / smin, 10);
  });

  it("keeps the win lines inside the field, past the safe-area insets", () => {
    const cfg = makeTugConfig(390, 844, { top: 47, bottom: 34 });
    expect(cfg.winLineY[0]).toBeCloseTo(47 + 844 * 0.12, 6);
    expect(cfg.winLineY[1]).toBeCloseTo(844 - 34 - 844 * 0.12, 6);
    expect(cfg.winLineY[0]).toBeLessThan(cfg.winLineY[1]);
  });

  it("keeps knot radius and rope width within sane bounds on extreme sizes", () => {
    const tiny = makeCfg(240, 520);
    expect(tiny.knotRadius).toBeGreaterThanOrEqual(7);
    expect(tiny.ropeWidth).toBeGreaterThanOrEqual(3);
    const huge = makeCfg(900, 1400);
    expect(huge.knotRadius).toBeLessThanOrEqual(13);
    expect(huge.ropeWidth).toBeLessThanOrEqual(6);
  });
});

describe("round lifecycle", () => {
  it("starts in the countdown and goes active exactly when it expires", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    expect(s.phase).toBe("countdown");
    expect(s.countdown).toBe(cfg.countdownTime);

    const evs = stepTug(s, cfg.countdownTime - 0.001, cfg);
    expect(evs).toEqual([]);
    expect(s.phase).toBe("countdown");

    const evs2 = stepTug(s, 0.002, cfg);
    expect(evs2.some((e) => e.type === "go")).toBe(true);
    expect(s.phase).toBe("active");
    expect(s.countdown).toBe(0);
  });

  it("ignores pulls during the countdown", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    expect(pullTug(s, 0, cfg)).toEqual([]);
    expect(pullTug(s, 1, cfg)).toEqual([]);
    expect(s.knotY).toBe(centre(cfg));
    expect(s.scores).toEqual([0, 0]);
  });

  it("after a score the next round needs a fresh countdown", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg); // go
    const winner = tapToScore(cfg, s, 0);
    expect(winner).toBe(0);
    expect(s.phase).toBe("countdown");
    // Pulls are dead again until the new countdown expires.
    expect(pullTug(s, 1, cfg)).toEqual([]);
    expect(s.knotY).toBe(centre(cfg));
    stepTug(s, cfg.countdownTime, cfg);
    expect(s.phase).toBe("active");
  });
});

describe("pulls", () => {
  it("moves the knot one tapStrength toward the pulling player", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    const evs = pullTug(s, 0, cfg);
    expect(evs.some((e) => e.type === "tug" && e.player === 0)).toBe(true);
    expect(s.knotY).toBeCloseTo(centre(cfg) - cfg.tapStrength, 6);
  });

  it("the top player wins when the knot reaches the top win line", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    expect(tapToScore(cfg, s, 0)).toBe(0);
    expect(s.scores).toEqual([1, 0]);
    expect(s.knotY).toBe(centre(cfg));
  });

  it("the bottom player wins when the knot reaches the bottom win line", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    expect(tapToScore(cfg, s, 1)).toBe(1);
    expect(s.scores).toEqual([0, 1]);
    expect(s.knotY).toBe(centre(cfg));
  });

  it("the knot never passes a win line; the round resolves exactly on it", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    const tapsNeeded = Math.ceil(
      (centre(cfg) - cfg.winLineY[0]) / cfg.tapStrength,
    );
    // The winning tap happens exactly when the line is reached, so the knot
    // is never observed beyond the line and the round ends at the boundary.
    for (let i = 0; i < tapsNeeded; i += 1) {
      pullTug(s, 0, cfg);
      expect(s.knotY).toBeGreaterThanOrEqual(cfg.winLineY[0] - 1e-9);
    }
    expect(s.scores[0]).toBe(1);
    expect(s.knotY).toBe(centre(cfg));
  });
});

describe("fairness invariants", () => {
  it("equal pull rates leave the knot near the centre", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    for (let i = 0; i < 40; i += 1) {
      pullTug(s, 0, cfg);
      stepTug(s, 1 / 60, cfg);
      pullTug(s, 1, cfg);
      stepTug(s, 1 / 60, cfg);
    }
    // One-sided impulse is at most tapStrength; decay only shrinks it.
    expect(Math.abs(s.knotY - centre(cfg))).toBeLessThanOrEqual(
      cfg.tapStrength + 1e-6,
    );
    expect(s.scores).toEqual([0, 0]);
  });

  it("tension decay returns an idle knot to the exact centre", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    pullTug(s, 0, cfg);
    pullTug(s, 0, cfg);
    pullTug(s, 0, cfg);
    expect(s.knotY).toBeLessThan(centre(cfg));

    // Long enough for the decay to cover the offset: the knot lands exactly
    // on the centre, never overshooting it.
    stepTug(s, 60, cfg);
    expect(s.knotY).toBe(centre(cfg));
  });

  it("decay never pulls the knot past the centre while idle", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime, cfg);
    pullTug(s, 1, cfg); // knot below centre
    stepTug(s, 1 / 60, cfg);
    // Decay moves it back toward the centre but never overshoots it.
    expect(s.knotY).toBeGreaterThanOrEqual(centre(cfg));
    expect(s.knotY).toBeLessThan(centre(cfg) + cfg.tapStrength);
  });

  it("a lone player cannot farm points: pulls are dead during the countdown", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    for (let i = 0; i < 50; i += 1) {
      pullTug(s, 0, cfg);
      expect(s.knotY).toBe(centre(cfg));
    }
    expect(s.scores).toEqual([0, 0]);
  });
});

describe("tapAllowed (multi-touch anti-spam cooldown)", () => {
  it("allows a pull once the cooldown has elapsed since the last one", () => {
    const last = 1000;
    expect(tapAllowed(last, last)).toBe(false);
    expect(tapAllowed(last + TAP_COOLDOWN_MS - 0.001, last)).toBe(false);
    expect(tapAllowed(last + TAP_COOLDOWN_MS, last)).toBe(true);
  });

  it("always allows the very first tap (no previous pull)", () => {
    // lastTapAt initialises to 0 and now is performance.now() (large), so
    // the first real tap always clears the cooldown.
    expect(tapAllowed(1000, 0)).toBe(true);
  });

  it("lets a single-finger fast tapper through (~11-12 taps/sec)", () => {
    // Two pulls 85ms apart: within the cap, allowed.
    expect(tapAllowed(1000, 915)).toBe(true);
    // A sub-cooldown burst (e.g. a multi-finger mash) is blocked.
    expect(tapAllowed(1000, 950)).toBe(false);
  });
});

describe("critical tap zones", () => {
  /** Advance past the countdown into active play. */
  function startRound(cfg: TugConfig, s: TugState): void {
    stepTug(s, cfg.countdownTime + 0.01, cfg);
  }

  /** Make the next stepTug spawn a zone pair. */
  function forceSpawn(s: TugState): void {
    s.criticalClock = 0.001;
  }

  /** Get the game into active play with the top player leading (knot up). */
  function activeTopLeading(cfg: TugConfig, s: TugState): void {
    startRound(cfg, s);
    pullTug(s, 0, cfg);
  }

  it("is fully inert when criticalEnabled is false", () => {
    const cfg = makeCfg();
    cfg.criticalEnabled = false;
    const s = createTugState(cfg);
    startRound(cfg, s);
    forceSpawn(s);
    const evs = stepTug(s, 0.02, cfg);
    expect(evs).toEqual([]);
    expect(s.zones).toEqual([null, null]);
    expect(s.clock).toBe(0);
    pullTug(s, 0, cfg);
    expect(s.recentTaps[0].length).toBe(0);
  });

  it("spawns a zone pair for both players after the clock expires in active play", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    startRound(cfg, s);
    forceSpawn(s);
    const evs = stepTug(s, 0.02, cfg);
    expect(evs.filter((e) => e.type === "criticalSpawn")).toHaveLength(2);
    expect(s.zones[0]).not.toBeNull();
    expect(s.zones[1]).not.toBeNull();
    // both on their own half
    expect(s.zones[0]!.y).toBeLessThan(cfg.fieldH / 2);
    expect(s.zones[1]!.y).toBeGreaterThan(cfg.fieldH / 2);
    // the next pair is scheduled after a random interval
    expect(s.criticalClock).toBeGreaterThan(0);
  });

  it("never spawns during the countdown and the clock only advances in active play", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    forceSpawn(s);
    const evs = stepTug(s, 0.5, cfg);
    expect(evs.filter((e) => e.type === "criticalSpawn")).toHaveLength(0);
    expect(s.zones).toEqual([null, null]);
    expect(s.clock).toBe(0);
    // after "go" the clock starts counting
    stepTug(s, cfg.countdownTime - 0.49, cfg);
    expect(s.clock).toBe(0);
  });

  it("gives the leader an instant window and the trailer a waiting grace", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s); // top leads → bottom is the trailer
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    expect(s.zones[0]!.phase).toBe("active");
    expect(s.zones[1]!.phase).toBe("waiting");
    // the spawn frame already ticked grace by dt
    expect(s.zones[1]!.grace).toBeGreaterThan(0);
    expect(s.zones[1]!.grace).toBeLessThanOrEqual(cfg.criticalGrace);
  });

  it("the trailer's first press starts the window; pressing the zone also hits it", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    const z = s.zones[1]!;
    // press far from the zone: left edge is outside any legal placement
    const evs = pullTug(s, 1, cfg, 0, z.y);
    expect(z.phase).toBe("active");
    expect(z.window).toBeCloseTo(cfg.criticalWindow, 6);
    expect(evs.some((e) => e.type === "tug")).toBe(true);
    expect(evs.some((e) => e.type === "criticalHit")).toBe(false);
  });

  it("a first press on the waiting zone counts as a hit", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    const z = s.zones[1]!;
    const before = s.knotY;
    const evs = pullTug(s, 1, cfg, z.x, z.y);
    expect(evs.some((e) => e.type === "criticalHit" && e.combo === 1)).toBe(true);
    expect(z.phase).toBe("active");
    expect(z.combo).toBe(1);
    expect(s.knotY - before).toBeCloseTo(cfg.tapStrength * cfg.criticalBase, 6);
  });

  it("grace auto-starts the trailer's window after criticalGrace seconds", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    expect(s.zones[1]!.phase).toBe("waiting");
    stepTug(s, cfg.criticalGrace + 0.01, cfg);
    expect(s.zones[1]!.phase).toBe("active");
  });

  it("active zones shrink toward the floor and expire with a combo event", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    const z = s.zones[0]!;
    const r0 = z.r0;
    stepTug(s, 1, cfg);
    expect(z.r).toBeLessThan(r0);
    // expiry
    const evs = stepTug(s, cfg.criticalWindow + 0.01, cfg);
    expect(evs.some((e) => e.type === "criticalExpire" && e.player === 0 && e.combo === 0)).toBe(true);
    expect(s.zones[0]).toBeNull();
  });

  it("a hit applies the base multiplier, increments combo and relocates the zone", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    const z = s.zones[0]!;
    const oldX = z.x;
    const oldY = z.y;
    const before = s.knotY;
    const evs = pullTug(s, 0, cfg, oldX, oldY);
    const hit = evs.find((e) => e.type === "criticalHit");
    expect(hit).toBeDefined();
    expect((hit as { combo: number }).combo).toBe(1);
    expect(s.knotY - before).toBeCloseTo(-cfg.tapStrength * cfg.criticalBase, 6);
    expect(z.x !== oldX || z.y !== oldY).toBe(true);
  });

  it("consecutive hits escalate the multiplier and it is capped at criticalMax", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    const z = s.zones[0]!;
    // first hit
    let before = s.knotY;
    pullTug(s, 0, cfg, z.x, z.y);
    expect(s.knotY - before).toBeCloseTo(-cfg.tapStrength * cfg.criticalBase, 6);
    // second hit escalates
    before = s.knotY;
    pullTug(s, 0, cfg, z.x, z.y);
    expect(s.knotY - before).toBeCloseTo(
      -cfg.tapStrength * (cfg.criticalBase + cfg.criticalStep),
      6,
    );
    // a huge combo is capped at criticalMax
    z.combo = 20;
    before = s.knotY;
    pullTug(s, 0, cfg, z.x, z.y);
    expect(s.knotY - before).toBeCloseTo(-cfg.tapStrength * cfg.criticalMax, 6);
  });

  it("an expired episode reports the lost combo and a fresh spawn starts at zero", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    pullTug(s, 0, cfg, s.zones[0]!.x, s.zones[0]!.y); // combo → 1
    const evs = stepTug(s, cfg.criticalWindow + 0.01, cfg);
    expect(evs.some((e) => e.type === "criticalExpire" && e.player === 0 && e.combo === 1)).toBe(true);
    expect(s.zones[0]).toBeNull();
    // the trailer's zone activates from grace with a full window; let it run
    // out (the spawn check can't fire this frame: the interval clock is
    // still positive and the zone expires after the check)
    stepTug(s, cfg.criticalWindow + 0.01, cfg);
    expect(s.zones[1]).toBeNull();
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    expect(s.zones[0]).not.toBeNull();
    expect(s.zones[0]!.combo).toBe(0);
  });

  it("a score clears both zones: chains die with the round", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    activeTopLeading(cfg, s);
    forceSpawn(s);
    stepTug(s, 0.02, cfg);
    // park the knot one tap from the top win line
    s.knotY = cfg.winLineY[0] + cfg.tapStrength * 1.2;
    const z = s.zones[0]!;
    const evs = pullTug(s, 0, cfg, z.x, z.y);
    expect(evs.some((e) => e.type === "score" && e.winner === 0)).toBe(true);
    expect(s.zones).toEqual([null, null]);
    expect(s.phase).toBe("countdown");
  });

  it("records taps for the heatmap and prunes them after the heatmap window", () => {
    const cfg = makeCfg();
    const s = createTugState(cfg);
    startRound(cfg, s);
    pullTug(s, 0, cfg);
    pullTug(s, 0, cfg, 100, 200);
    expect(s.recentTaps[0].length).toBe(2);
    stepTug(s, cfg.heatmapWindow + 0.01, cfg);
    expect(s.recentTaps[0].length).toBe(0);
  });
});

describe("critical permanent mode", () => {
  it("defaults to off", () => {
    expect(makeCfg().criticalPermanent).toBe(false);
  });

  it("spawns a pair once and never expires it", () => {
    const cfg = makeCfg();
    cfg.criticalPermanent = true;
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime + 0.01, cfg); // "go"
    expect(s.zones).toEqual([null, null]);
    stepTug(s, 0.02, cfg); // first active tick → spawn
    expect(s.zones[0]).not.toBeNull();
    expect(s.zones[1]).not.toBeNull();
    const r0 = s.zones[0]!.r0;
    // 60s later: still alive, full size, no expiry events, no reschedule
    const evs = stepTug(s, 60, cfg);
    expect(evs.filter((e) => e.type === "criticalExpire")).toHaveLength(0);
    expect(s.zones[0]).not.toBeNull();
    expect(s.zones[1]).not.toBeNull();
    expect(s.zones[0]!.r).toBe(r0);
    expect(s.zones[1]!.r).toBe(r0);
  });

  it("respawns the pair after a score clears it", () => {
    const cfg = makeCfg();
    cfg.criticalPermanent = true;
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime + 0.01, cfg);
    stepTug(s, 0.02, cfg); // spawn
    // park the knot one tap from the top win line and hit the zone to score
    s.knotY = cfg.winLineY[0] + cfg.tapStrength * 1.2;
    const z = s.zones[0]!;
    const evs = pullTug(s, 0, cfg, z.x, z.y);
    expect(evs.some((e) => e.type === "score")).toBe(true);
    expect(s.zones).toEqual([null, null]);
    // back in active play the pair comes back
    stepTug(s, cfg.countdownTime + 0.01, cfg); // countdown → "go"
    stepTug(s, 0.02, cfg);
    expect(s.zones[0]).not.toBeNull();
    expect(s.zones[1]).not.toBeNull();
  });

  it("hits still relocate the zone and build combo", () => {
    const cfg = makeCfg();
    cfg.criticalPermanent = true;
    const s = createTugState(cfg);
    stepTug(s, cfg.countdownTime + 0.01, cfg);
    stepTug(s, 0.02, cfg);
    const z = s.zones[0]!;
    const oldX = z.x;
    const oldY = z.y;
    const before = s.knotY;
    const evs = pullTug(s, 0, cfg, z.x, z.y);
    expect(evs.some((e) => e.type === "criticalHit" && e.combo === 1)).toBe(true);
    expect(s.knotY - before).toBeCloseTo(-cfg.tapStrength * cfg.criticalBase, 6);
    expect(z.x !== oldX || z.y !== oldY).toBe(true);
  });
});

describe("pickCriticalSpot", () => {
  /** Deterministic rng over the given values (one per rng() call). */
  function seq(...values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  }

  it("places the zone on the player's half, away from borders and the win line", () => {
    const cfg = makeCfg();
    const spot = pickCriticalSpot(cfg, 0, [], null, seq(0, 0));
    const r = cfg.criticalRadius;
    expect(spot.x).toBeGreaterThanOrEqual(r * 1.6 - 1e-6);
    expect(spot.x + r).toBeLessThanOrEqual(cfg.fieldW - r * 1.6 + 1e-6);
    expect(spot.y - r).toBeGreaterThanOrEqual(cfg.winLineY[0] + cfg.fieldH * 0.05 - 1e-6);
    expect(spot.y + r).toBeLessThanOrEqual(cfg.fieldH / 2 - cfg.fieldH * 0.06 + 1e-6);
  });

  it("avoids where the player has been tapping (heatmap)", () => {
    const cfg = makeCfg();
    // Where the constant-0.5 rng puts the candidates
    const hotspot = pickCriticalSpot(cfg, 0, [], null, seq(0.5, 0.5));
    const hot = { x: hotspot.x, y: hotspot.y };
    // Same candidates, but a dense tap cluster sits exactly on candidate 1
    const spot = pickCriticalSpot(cfg, 0, [{ x: hot.x, y: hot.y, t: 0 }], null, seq(0.5, 0.5, 0.9, 0.9));
    expect(spot.x !== hot.x || spot.y !== hot.y).toBe(true);
  });

  it("drifts at least criticalMinDrift radii away from the previous spot", () => {
    const cfg = makeCfg();
    const prev = pickCriticalSpot(cfg, 0, [], null, seq(0.5, 0.5));
    const spot = pickCriticalSpot(cfg, 0, [], { x: prev.x, y: prev.y }, seq(0.5, 0.5, 0.9, 0.9));
    expect(Math.hypot(spot.x - prev.x, spot.y - prev.y)).toBeGreaterThanOrEqual(
      cfg.criticalMinDrift * cfg.criticalRadius - 1e-6,
    );
  });
});

describe("clamp", () => {
  it("clamps numbers into range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
