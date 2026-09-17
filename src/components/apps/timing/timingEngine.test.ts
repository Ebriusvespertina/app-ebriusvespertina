import { describe, expect, it } from "vitest";
import {
  angularDistance,
  clamp,
  createTimingState,
  fitCurve,
  makeTimingConfig,
  stepTiming,
  tapTiming,
} from "./timingEngine";
import type {
  Mode,
  PlayerIndex,
  TimingConfig,
  TimingState,
} from "./timingEngine";

function makeCfg(mode: Mode, rng: () => number = Math.random): TimingConfig {
  return { ...makeTimingConfig(390, 844, mode), rng };
}

/** Deterministic rng that cycles through given values. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Fast-forward through the countdown; returns the events at the zero moment. */
function passCountdown(cfg: TimingConfig, s: TimingState) {
  const evs = stepTiming(s, cfg.countdown, cfg);
  expect(s.phase).toBe("active");
  return evs;
}

describe("makeTimingConfig", () => {
  it("sets the right countdown per mode", () => {
    expect(makeTimingConfig(390, 844, "reflex").countdown).toBe(3);
    expect(makeTimingConfig(390, 844, "skill").countdown).toBe(3);
    expect(makeTimingConfig(390, 844, "blind").countdown).toBe(20);
  });

  it("keeps the blind hide range sane", () => {
    const cfg = makeTimingConfig(390, 844, "blind");
    expect(cfg.blindHideMin).toBeGreaterThan(0);
    expect(cfg.blindHideMax).toBeLessThan(cfg.countdown);
    expect(cfg.blindHideMin).toBeLessThan(cfg.blindHideMax);
  });

  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("computes shortest angular distance", () => {
    expect(angularDistance(0, 0)).toBe(0);
    expect(angularDistance(0, Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(angularDistance(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2, 6);
    expect(angularDistance(1, 1 + Math.PI * 4)).toBeCloseTo(0, 6);
  });
});

describe("reflex mode", () => {
  it("disqualifies a tap during the countdown, one shot only", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    const evs = tapTiming(s, 0, cfg);
    expect(evs).toEqual([{ type: "tap", player: 0, result: "early" }]);
    // Second tap is ignored: the first tap was the one shot.
    expect(tapTiming(s, 0, cfg)).toEqual([]);
    expect(s.rounds[0].tapped).toBe(true);
    expect(s.scores).toEqual([0, 0]);
  });

  it("measures late taps in ms against the true zero and picks the closer one", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    passCountdown(cfg, s); // zero now
    // Player 0 taps 40ms late, player 1 taps 120ms late.
    stepTiming(s, 0.04, cfg);
    expect(tapTiming(s, 0, cfg)).toEqual([{ type: "tap", player: 0, result: "late", devMs: 40 }]);
    stepTiming(s, 0.08, cfg);
    expect(tapTiming(s, 1, cfg)).toEqual([{ type: "tap", player: 1, result: "late", devMs: 120 }]);
    const evs = stepTiming(s, 0.3, cfg); // both tapped -> resolves immediately
    const rr = evs.find((e) => e.type === "roundResult");
    expect(rr).toEqual({
      type: "roundResult",
      winner: 0,
      devs: [40, 120],
      early: [false, false],
    });
    expect(s.scores).toEqual([1, 0]);
    expect(s.phase).toBe("result");
  });

  it("a disqualified tapper loses the round to a valid late tap", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    tapTiming(s, 0, cfg); // early -> DQ
    passCountdown(cfg, s);
    stepTiming(s, 0.2, cfg);
    const evs = tapTiming(s, 1, cfg);
    expect(evs[0]).toMatchObject({ type: "tap", result: "late", devMs: 200 });
    const rr = stepTiming(s, 0.3, cfg).find((e) => e.type === "roundResult");
    expect(rr).toMatchObject({ winner: 1, early: [true, false] });
    expect(s.scores).toEqual([0, 1]);
  });

  it("both early means nobody scores", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    tapTiming(s, 0, cfg);
    tapTiming(s, 1, cfg);
    passCountdown(cfg, s);
    const rr = stepTiming(s, 0.01, cfg).find((e) => e.type === "roundResult");
    expect(rr).toMatchObject({ winner: null, early: [true, true] });
    expect(s.scores).toEqual([0, 0]);
    expect(s.phase).toBe("result");
  });

  it("taps after the window are ignored; the round resolves at the window end", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    stepTiming(s, cfg.reflexWindow + 0.1, cfg);
    expect(tapTiming(s, 0, cfg)).toEqual([]);
    expect(s.phase).toBe("result");
    expect(s.scores).toEqual([0, 0]);
  });

  it("a new round starts after the pause and the match ends at roundsToWin", () => {
    const cfg = makeCfg("reflex");
    const s = createTimingState(cfg);
    for (let round = 0; round < 3; round += 1) {
      passCountdown(cfg, s);
      stepTiming(s, 0.05, cfg);
      tapTiming(s, 0, cfg); // 50ms late each round
      stepTiming(s, 0.2, cfg);
      const rr = stepTiming(s, 0.3, cfg).find((e) => e.type === "roundResult");
      expect(rr).toMatchObject({ winner: 0 });
      if (round < 2) {
        stepTiming(s, cfg.roundPause, cfg);
        expect(s.phase).toBe("countdown");
        expect(s.rounds[0].tapped).toBe(false);
        expect(s.countdown).toBe(cfg.countdown);
      }
    }
    expect(s.scores).toEqual([3, 0]);
    expect(s.phase).toBe("matchover");
    expect(s.matchWinner).toBe(0);
  });
});

describe("blind mode", () => {
  it("hides at a random point within the configured range", () => {
    const cfg = makeCfg("blind", seqRng([0.5, 0.25]));
    const s = createTimingState(cfg);
    expect(s.hideAt).toBeGreaterThanOrEqual(cfg.blindHideMin);
    expect(s.hideAt).toBeLessThanOrEqual(cfg.blindHideMax);
  });

  it("measures absolute deviation from zero and the closest guess wins", () => {
    const cfg = makeCfg("blind", seqRng([0.5])); // hideAt = 8s remaining
    const s = createTimingState(cfg);
    expect(s.hideAt).toBe(8);
    // Player 0 taps 1.4s before zero (an estimate: display already hidden),
    // player 1 taps 0.6s after.
    stepTiming(s, cfg.countdown - 1.4, cfg);
    expect(tapTiming(s, 0, cfg)[0]).toMatchObject({ result: "blind" });
    stepTiming(s, 1.4, cfg); // pass the remaining countdown -> zero
    expect(s.phase).toBe("active");
    stepTiming(s, 0.6, cfg);
    expect(tapTiming(s, 1, cfg)[0]).toMatchObject({ result: "blind" });
    const rr = stepTiming(s, 0.01, cfg).find((e) => e.type === "roundResult");
    expect(rr).toMatchObject({ winner: 1, devs: [1400, 600], early: [true, false] });
    expect(s.scores).toEqual([0, 1]);
  });

  it("ignores guesses after the blind window", () => {
    const cfg = makeCfg("blind");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    stepTiming(s, cfg.blindWindow + 0.1, cfg);
    expect(tapTiming(s, 0, cfg)).toEqual([]);
    expect(s.phase).toBe("result");
  });

  it("a tap while the display is still visible is disqualified, not measured", () => {
    const cfg = makeCfg("blind");
    const s = createTimingState(cfg);
    stepTiming(s, 2, cfg); // 18s remaining, display still visible
    expect(tapTiming(s, 1, cfg)[0]).toMatchObject({ result: "early" });
    stepTiming(s, 18, cfg); // pass the rest of the countdown -> zero
    const rr = stepTiming(s, cfg.blindWindow, cfg).find((e) => e.type === "roundResult");
    expect(rr).toMatchObject({ winner: null, devs: [NaN, NaN], early: [false, true] });
    expect(s.scores).toEqual([0, 0]);
  });

  it("a tap after the display hides is a measured guess even when before zero", () => {
    const cfg = makeCfg("blind", seqRng([0.5])); // hideAt = 8s remaining
    const s = createTimingState(cfg);
    stepTiming(s, 13, cfg); // 7s remaining: hidden, but zero is 7s away
    expect(tapTiming(s, 0, cfg)[0]).toMatchObject({ result: "blind" });
    stepTiming(s, 7, cfg); // -> zero
    stepTiming(s, 0.6, cfg);
    expect(tapTiming(s, 1, cfg)[0]).toMatchObject({ result: "blind" });
    const rr = stepTiming(s, 0.01, cfg).find((e) => e.type === "roundResult");
    expect(rr).toMatchObject({ winner: 1, devs: [7000, 600], early: [true, false] });
    expect(s.scores).toEqual([0, 1]);
  });
});

describe("skill mode", () => {
  it("ignores taps during the countdown", () => {
    const cfg = makeCfg("skill");
    const s = createTimingState(cfg);
    expect(tapTiming(s, 0, cfg)).toEqual([]);
  });

  it("config: reach 1-3s, great inside good, cooldowns great<good<miss", () => {
    const cfg = makeCfg("skill");
    expect(cfg.skillReachMin).toBeGreaterThanOrEqual(1);
    expect(cfg.skillReachMax).toBeLessThanOrEqual(3);
    expect(cfg.skillReachMin).toBeLessThan(cfg.skillReachMax);
    expect(cfg.skillGreatHalf).toBeLessThan(cfg.skillZoneHalf);
    expect(cfg.skillGreatCooldown).toBeLessThan(cfg.skillGoodCooldown);
    expect(cfg.skillGoodCooldown).toBeLessThan(cfg.skillMissCooldown);
  });

  it("the reach is one shared value in 1-3s; both zones spawn exactly that far ahead", () => {
    const cfg = makeCfg("skill", seqRng([0.5]));
    const s = createTimingState(cfg);
    expect(s.skillReach).toBeGreaterThanOrEqual(1);
    expect(s.skillReach).toBeLessThanOrEqual(3);
    passCountdown(cfg, s);
    stepTiming(s, 0.02, cfg); // first zones spawn (initial cooldown 0)
    const speed = (Math.PI * 2) / cfg.skillSweepPeriod;
    for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
      expect(s.skill[p].zoneActive).toBe(true);
      // forward distance from the marker to the zone == reachAngle
      const fwd = (s.skill[p].zone - s.skillSweep[p] + Math.PI * 2) % (Math.PI * 2);
      expect(fwd).toBeCloseTo(s.skillReach * speed, 5);
    }
  });

  it("judges tiers by deviation: great < good < miss", () => {
    const cfg = makeCfg("skill");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    stepTiming(s, 0.02, cfg);
    // Marker dead-centre -> great.
    s.skillSweep[0] = s.skill[0].zone;
    const great = tapTiming(s, 0, cfg);
    expect(great).toMatchObject([{ type: "tap", result: "great" }]);
    expect((great[0] as { devMs?: number }).devMs).toBe(0);
    expect(s.skill[0].greats).toBe(1);
    // Marker between greatHalf and zoneHalf -> good.
    s.skillSweep[1] = s.skill[1].zone + (cfg.skillGreatHalf + cfg.skillZoneHalf) / 2;
    const good = tapTiming(s, 1, cfg);
    expect(good).toMatchObject([{ type: "tap", result: "good" }]);
    expect(s.skill[1].goods).toBe(1);
    expect((good[0] as { devMs?: number }).devMs).toBeGreaterThan(0);
    expect((good[0] as { devMs?: number }).devMs).toBeLessThan(cfg.skillMissPenalty);
  });

  it("an outside tap or an expired window is a miss with the longest cooldown", () => {
    const cfg = makeCfg("skill");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    stepTiming(s, 0.02, cfg);
    // Miss by tapping far outside the zone.
    s.skillSweep[0] = s.skill[0].zone + Math.PI;
    expect(tapTiming(s, 0, cfg)).toMatchObject([{ type: "tap", result: "miss" }]);
    expect(s.skill[0].misses).toBe(1);
    expect(s.skill[0].cooldown).toBe(cfg.skillMissCooldown);
    // Miss by never tapping: the zone window expires.
    expect(s.skill[1].zoneActive).toBe(true);
    const speed = (Math.PI * 2) / cfg.skillSweepPeriod;
    stepTiming(s, s.skillReach + cfg.skillZoneHalf / speed + 0.3, cfg);
    expect(s.skill[1].zoneActive).toBe(false);
    expect(s.skill[1].misses).toBe(1);
    expect(s.skill[1].cooldown).toBe(cfg.skillMissCooldown);
  });

  it("a great gives the fastest next zone; a miss the slowest", () => {
    const cfg = makeCfg("skill");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    stepTiming(s, 0.02, cfg);
    s.skillSweep[0] = s.skill[0].zone;
    tapTiming(s, 0, cfg); // great
    expect(s.skill[0].cooldown).toBe(cfg.skillGreatCooldown);
    s.skillSweep[1] = s.skill[1].zone + Math.PI;
    tapTiming(s, 1, cfg); // miss
    expect(s.skill[1].cooldown).toBe(cfg.skillMissCooldown);
    // After the great cooldown player 0 has a new zone; player 1 is still waiting.
    stepTiming(s, cfg.skillGreatCooldown + 0.01, cfg);
    expect(s.skill[0].zoneActive).toBe(true);
    expect(s.skill[1].zoneActive).toBe(false);
  });

  it("ends after the time limit; the lowest average deviation wins", () => {
    const cfg = makeCfg("skill");
    const s = createTimingState(cfg);
    passCountdown(cfg, s);
    // Player 0 greats every zone; player 1 never taps.
    while (s.phase === "active") {
      if (s.skill[0].zoneActive && !s.skill[0].tapped) {
        s.skillSweep[0] = s.skill[0].zone;
        tapTiming(s, 0, cfg);
      }
      stepTiming(s, 0.3, cfg);
    }
    expect(s.phase).toBe("result");
    expect(s.skill[0].greats).toBeGreaterThan(0);
    expect(s.skill[1].misses).toBeGreaterThan(0);
    expect(s.skill[0].avg).toBeLessThan(s.skill[1].avg);
    expect(s.skill[0].avg).toBe(0); // all perfect greats
    expect(s.skill[1].avg).toBe(cfg.skillMissPenalty);
    expect(s.skillWinner).toBe(0);
    expect(s.matchWinner).toBe(0);
  });
});

describe("fitCurve", () => {
  it("returns NaN for empty data", () => {
    expect(fitCurve([])).toEqual({ mean: NaN, sigma: NaN });
  });

  it("computes mean and sample standard deviation", () => {
    const { mean, sigma } = fitCurve([40, 50, 60]);
    expect(mean).toBeCloseTo(50, 6);
    expect(sigma).toBeCloseTo(10, 6);
  });

  it("zero sigma for a single sample", () => {
    expect(fitCurve([42])).toEqual({ mean: 42, sigma: 0 });
  });
});
