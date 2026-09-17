import { describe, expect, it } from "vitest";
import {
  clamp,
  createPongState,
  makePongConfig,
  stepPong,
} from "./pongEngine";
import type { Direction, PongConfig, PongInput, PongState } from "./pongEngine";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCfg(seed?: number, w = 390, h = 844): PongConfig {
  return makePongConfig(w, h, undefined, seed === undefined ? Math.random : mulberry32(seed));
}

function topFace(cfg: PongConfig): number {
  return cfg.topPaddleY + cfg.paddleHeight / 2;
}

/** Place the ball just below the top paddle's face, moving straight up at `speed`. */
function ballAtTopPaddle(cfg: PongConfig, s: PongState, speed: number): void {
  s.servePending = false;
  s.speed = speed;
  s.paddles = [cfg.fieldW / 2, cfg.fieldW / 2];
  s.ball = {
    x: cfg.fieldW / 2,
    y: topFace(cfg) + cfg.ballRadius + 1,
    vx: 0,
    vy: -speed,
  };
}

describe("makePongConfig", () => {
  it("scales gameplay numbers with field size", () => {
    // Sizes chosen inside the paddle/ball clamps so the fractions are exact.
    const small = makeCfg(1, 380, 700);
    const large = makeCfg(2, 400, 860);
    const smin = Math.min(small.fieldW, small.fieldH);
    const lmin = Math.min(large.fieldW, large.fieldH);
    expect(large.paddleWidth / lmin).toBeCloseTo(small.paddleWidth / smin, 10);
    expect(large.paddleHeight / large.fieldH).toBeCloseTo(small.paddleHeight / small.fieldH, 10);
    expect(large.ballRadius / lmin).toBeCloseTo(small.ballRadius / smin, 10);
    expect(large.paddleSpeed / lmin).toBeCloseTo(small.paddleSpeed / smin, 10);
    expect(large.baseBallSpeed / lmin).toBeCloseTo(small.baseBallSpeed / smin, 10);
    expect(large.maxBallSpeed / lmin).toBeCloseTo(small.maxBallSpeed / smin, 10);
  });

  it("scales speeds with the smaller dimension so landscape play stays sane", () => {
    const portrait = makeCfg(1, 390, 844);
    const landscape = makeCfg(2, 844, 390);
    expect(landscape.paddleSpeed).toBeCloseTo(portrait.paddleSpeed, 6);
    expect(landscape.baseBallSpeed).toBeCloseTo(portrait.baseBallSpeed, 6);
    expect(landscape.maxBallSpeed).toBeCloseTo(portrait.maxBallSpeed, 6);
    expect(landscape.paddleWidth).toBe(portrait.paddleWidth);
  });

  it("respects safe-area insets for paddle placement", () => {
    const cfg = makePongConfig(390, 844, { top: 47, bottom: 34 });
    expect(cfg.topPaddleY).toBeCloseTo(47 + cfg.paddleHeight / 2, 6);
    expect(cfg.bottomPaddleY).toBeCloseTo(844 - 34 - cfg.paddleHeight / 2, 6);
  });

  it("keeps paddle width and ball radius within sane bounds on extreme sizes", () => {
    const tiny = makeCfg(1, 240, 520);
    expect(tiny.paddleWidth).toBeGreaterThanOrEqual(96);
    expect(tiny.ballRadius).toBeGreaterThanOrEqual(5);
    const huge = makeCfg(2, 900, 1400);
    expect(huge.paddleWidth).toBeLessThanOrEqual(150);
    expect(huge.ballRadius).toBeLessThanOrEqual(9);
  });
});

describe("paddles", () => {
  it("clamp inside the field and move independently", () => {
    const cfg = makeCfg(3);
    const s = createPongState(cfg);
    stepPong(s, { top: -1, bottom: 1 }, 10, cfg);
    expect(s.paddles[0]).toBe(cfg.paddleWidth / 2);
    expect(s.paddles[1]).toBe(cfg.fieldW - cfg.paddleWidth / 2);
    stepPong(s, { top: 1, bottom: -1 }, 10, cfg);
    expect(s.paddles[0]).toBe(cfg.fieldW - cfg.paddleWidth / 2);
    expect(s.paddles[1]).toBe(cfg.paddleWidth / 2);
  });

  it("moves at exactly paddleSpeed regardless of frame rate", () => {
    const cfg = makeCfg(4);
    const s = createPongState(cfg);
    stepPong(s, { top: 1, bottom: 0 }, 0.05, cfg);
    expect(s.paddles[0]).toBeCloseTo(cfg.fieldW / 2 + cfg.paddleSpeed * 0.05, 6);
  });

  it("waits for the receiving player's touch and lets paddles reposition", () => {
    const cfg = makeCfg(5);
    const s = createPongState(cfg);
    s.serveDir = 1; // ball is headed to the bottom player
    // Touches by the non-receiver do not fire the serve; paddles still move.
    stepPong(s, { top: 1, bottom: 0 }, 0.2, cfg);
    expect(s.servePending).toBe(true);
    expect(s.ball.vx).toBe(0);
    expect(s.paddles[0]).toBeGreaterThan(cfg.fieldW / 2);
    // A touch by the receiving player launches it.
    const evs = stepPong(s, { top: 1, bottom: -1 }, 0.05, cfg);
    expect(s.servePending).toBe(false);
    expect(evs.some((e) => e.type === "serve")).toBe(true);
    expect(s.ball.vy).toBeGreaterThan(0); // toward the bottom player
  });
});

describe("walls", () => {
  it("bounces cleanly off both side walls", () => {
    const cfg = makeCfg(6);
    const s = createPongState(cfg);
    s.servePending = false;
    s.ball = { x: cfg.ballRadius + 1, y: cfg.fieldH / 2, vx: -300, vy: 200 };
    const evs = stepPong(s, { top: 0, bottom: 0 }, 0.1, cfg);
    expect(evs.some((e) => e.type === "wall")).toBe(true);
    expect(s.ball.vx).toBeGreaterThan(0);
    expect(s.ball.x).toBeGreaterThanOrEqual(cfg.ballRadius - 1e-9);
  });
});

describe("paddle hits", () => {
  it("speeds the ball up per hit and never past maxBallSpeed", () => {
    const cfg = makeCfg(7);
    const s = createPongState(cfg);
    ballAtTopPaddle(cfg, s, cfg.baseBallSpeed);
    const evs = stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    expect(evs.some((e) => e.type === "hit")).toBe(true);
    expect(s.speed).toBe(cfg.baseBallSpeed + cfg.speedStep);

    s.speed = cfg.maxBallSpeed;
    s.ball = { x: cfg.fieldW / 2, y: topFace(cfg) + cfg.ballRadius + 1, vx: 0, vy: -cfg.maxBallSpeed };
    stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    expect(s.speed).toBe(cfg.maxBallSpeed);
  });

  it("returns a center hit straight back", () => {
    const cfg = makeCfg(8);
    const s = createPongState(cfg);
    ballAtTopPaddle(cfg, s, cfg.baseBallSpeed);
    stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    expect(Math.abs(s.ball.vx)).toBeLessThan(1e-9);
    expect(s.ball.vy).toBeGreaterThan(0); // bounced down into the field
  });

  it("angles an edge hit up to maxBounceDeg", () => {
    const cfg = makeCfg(9);
    const s = createPongState(cfg);
    ballAtTopPaddle(cfg, s, cfg.baseBallSpeed);
    s.ball.x = s.paddles[0] + cfg.paddleWidth / 2; // exact edge impact
    stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    const maxRad = (cfg.maxBounceDeg * Math.PI) / 180;
    expect(Math.abs(s.ball.vx)).toBeCloseTo(s.speed * Math.sin(maxRad), 5);
    expect(Math.abs(s.ball.vy)).toBeCloseTo(s.speed * Math.cos(maxRad), 5);
  });

  it("caps |vx| at vxSpeedRatio of paddleSpeed and preserves speed magnitude", () => {
    const cfg = makeCfg(10);
    const s = createPongState(cfg);
    ballAtTopPaddle(cfg, s, cfg.maxBallSpeed);
    s.ball.x = s.paddles[0] + cfg.paddleWidth / 2; // steepest possible shot
    stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    expect(Math.abs(s.ball.vx)).toBeLessThanOrEqual(cfg.vxSpeedRatio * cfg.paddleSpeed + 1e-9);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeCloseTo(cfg.maxBallSpeed, 4);
    expect(Math.abs(s.ball.vy)).toBeGreaterThanOrEqual(
      cfg.maxBallSpeed * Math.cos((cfg.maxBounceDeg * Math.PI) / 180) - 1e-9,
    );
  });

  it("does not phantom-bounce off the back of a paddle in the gap zone", () => {
    const cfg = makeCfg(11);
    const s = createPongState(cfg);
    s.servePending = false;
    // Ball already above the top face (gap between paddle and field edge), moving up.
    s.ball = { x: cfg.fieldW / 2, y: 10, vx: 0, vy: -cfg.baseBallSpeed };
    const evs = stepPong(s, { top: 0, bottom: 0 }, 1 / 240, cfg);
    expect(evs.some((e) => e.type === "hit")).toBe(false);
    expect(s.ball.vy).toBeLessThan(0);
  });

  it("never tunnels through a paddle even at max speed with a large dt", () => {
    const cfg = makeCfg(12);
    const s = createPongState(cfg);
    ballAtTopPaddle(cfg, s, cfg.maxBallSpeed);
    const evs = stepPong(s, { top: 0, bottom: 0 }, 0.05, cfg);
    expect(evs.some((e) => e.type === "hit")).toBe(true);
    expect(s.ball.vy).toBeGreaterThan(0); // bounced back down, not passed through
  });
});

describe("scoring and serving", () => {
  it("scores for the opposite player and serves toward the loser", () => {
    const cfg = makeCfg(13);
    const s = createPongState(cfg);
    s.servePending = false;
    s.scores = [2, 3];
    s.ball = { x: cfg.fieldW / 2, y: 5, vx: 0, vy: -cfg.baseBallSpeed };
    const evs = stepPong(s, { top: 0, bottom: 0 }, 1 / 30, cfg);
    const scoreEv = evs.find((e) => e.type === "score" && e.scorer === 1);
    expect(scoreEv).toBeDefined();
    if (scoreEv && scoreEv.type === "score") {
      // The event reports where the ball crossed the goal line.
      expect(scoreEv.x).toBeCloseTo(cfg.fieldW / 2, 0);
      expect(scoreEv.y).toBeLessThan(0);
    }
    expect(s.scores).toEqual([2, 4]);
    expect(s.servePending).toBe(true);
    expect(s.serveDir).toBe(-1); // top player conceded, ball comes to them
    expect(s.ball.vx).toBe(0);
    expect(s.ball.vy).toBe(0);
    expect(s.ball.x).toBe(cfg.fieldW / 2);
    expect(s.ball.y).toBe(cfg.fieldH / 2);
    expect(s.speed).toBe(cfg.baseBallSpeed);
  });

  it("scores on the bottom edge for the top player", () => {
    const cfg = makeCfg(14);
    const s = createPongState(cfg);
    s.servePending = false;
    s.ball = { x: cfg.fieldW / 2, y: cfg.fieldH - 5, vx: 0, vy: cfg.baseBallSpeed };
    const evs = stepPong(s, { top: 0, bottom: 0 }, 1 / 30, cfg);
    const scoreEv = evs.find((e) => e.type === "score" && e.scorer === 0);
    expect(scoreEv).toBeDefined();
    if (scoreEv && scoreEv.type === "score") {
      expect(scoreEv.x).toBeCloseTo(cfg.fieldW / 2, 0);
      expect(scoreEv.y).toBeGreaterThan(cfg.fieldH);
    }
    expect(s.serveDir).toBe(1); // bottom player conceded, ball comes to them
  });

  it("waits out the serve cooldown after a score even when the receiver is holding", () => {
    const cfg = makeCfg(16);
    const s = createPongState(cfg);
    s.servePending = false;
    s.ball = { x: cfg.fieldW / 2, y: 5, vx: 0, vy: -cfg.baseBallSpeed };
    const evs = stepPong(s, { top: 0, bottom: 0 }, 1 / 30, cfg);
    expect(evs.some((e) => e.type === "score")).toBe(true);
    expect(s.servePending).toBe(true);
    expect(s.serveCooldown).toBe(cfg.serveCooldownS);
    expect(s.serveDir).toBe(-1); // top player receives
    // The receiver holds the whole time; nothing fires during the cooldown.
    const early = stepPong(s, { top: -1, bottom: 0 }, 0.1, cfg);
    expect(early.some((e) => e.type === "serve")).toBe(false);
    expect(s.servePending).toBe(true);
    // Once the cooldown elapses, the held touch launches the serve.
    const late = stepPong(s, { top: -1, bottom: 0 }, cfg.serveCooldownS - 0.1, cfg);
    expect(late.some((e) => e.type === "serve")).toBe(true);
    expect(s.servePending).toBe(false);
    expect(s.ball.vy).toBeLessThan(0); // toward the top player
  });

  it("launches the serve toward the receiver at base speed with a bounded angle", () => {
    const cfg = makeCfg(15);
    const s = createPongState(cfg);
    s.serveDir = -1; // toward the top player
    const evs = stepPong(s, { top: 1, bottom: 0 }, 0.02, cfg);
    expect(s.servePending).toBe(false);
    expect(evs.some((e) => e.type === "serve")).toBe(true);
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeCloseTo(cfg.baseBallSpeed, 6);
    const angle = (Math.atan2(Math.abs(s.ball.vx), Math.abs(s.ball.vy)) * 180) / Math.PI;
    expect(angle).toBeGreaterThanOrEqual(cfg.minServeDeg - 1e-6);
    expect(angle).toBeLessThanOrEqual(cfg.maxServeDeg + 1e-6);
    expect(s.ball.vy).toBeLessThan(0); // toward the top player
  });
});

describe("fairness invariants under sustained random play", () => {
  it("keeps the ball reachable, in bounds and within speed caps for 90s", () => {
    const cfg = makeCfg(42);
    const s = createPongState(cfg);
    const maxRad = (cfg.maxBounceDeg * Math.PI) / 180;
    const dirs: Direction[] = [-1, 0, 1];
    let input: PongInput = { top: 0, bottom: 0 };
    let paddleHits = 0;

    for (let t = 0; t < 90; t += 1 / 60) {
      if (cfg.random() < 0.15) {
        input = {
          top: dirs[Math.floor(cfg.random() * 3)],
          bottom: dirs[Math.floor(cfg.random() * 3)],
        };
      }
      const evs = stepPong(s, input, 1 / 60, cfg);
      for (const e of evs) {
        if (e.type === "hit") {
          paddleHits += 1;
          // The ball always makes vertical progress after a hit.
          expect(Math.abs(s.ball.vy)).toBeGreaterThanOrEqual(s.speed * Math.cos(maxRad) - 1e-9);
        }
        if (e.type === "score") {
          expect(s.servePending).toBe(true);
          expect(s.scores[0] + s.scores[1]).toBeGreaterThan(0);
        }
      }

      // The reachability guarantee: |vx| < paddleSpeed, so the paddle can
      // always converge on the ball's x before the ball arrives.
      expect(Math.abs(s.ball.vx)).toBeLessThanOrEqual(cfg.vxSpeedRatio * cfg.paddleSpeed + 1e-9);
      expect(Math.abs(s.ball.vx)).toBeLessThanOrEqual(s.speed * Math.sin(maxRad) + 1e-9);
      expect(s.speed).toBeLessThanOrEqual(cfg.maxBallSpeed + 1e-9);

      // Ball never leaves the field horizontally; vertically it can only
      // overshoot briefly while flying out for a score.
      expect(s.ball.x).toBeGreaterThanOrEqual(cfg.ballRadius - 1e-9);
      expect(s.ball.x).toBeLessThanOrEqual(cfg.fieldW - cfg.ballRadius + 1e-9);
      if (!s.servePending) {
        expect(s.ball.y).toBeGreaterThan(-30);
        expect(s.ball.y).toBeLessThan(cfg.fieldH + 30);
      }
    }

    expect(paddleHits).toBeGreaterThan(10); // the sim actually played
    expect(s.scores[0] + s.scores[1]).toBeGreaterThan(0);
  });
});

describe("clamp", () => {
  it("clamps numbers into range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
