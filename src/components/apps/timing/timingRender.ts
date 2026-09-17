// Canvas rendering + effects for the Timing game, split out of TimingPage.vue.
// Everything here is a pure function of its arguments (a CanvasRenderingContext2D,
// the engine config/state, and the shared FxState of particles/rings/glow/time),
// so the page stays focused on input, audio and the game loop.

import type { PlayerIndex, TimingConfig, TimingState } from "./timingEngine";
import { clamp } from "./timingEngine";

// Emerald vs violet — Timing's visual identity (also used by the page).
export const TOP_COLOR = "#34d399";
export const BOTTOM_COLOR = "#a78bfa";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Ring {
  x: number;
  y: number;
  t: number;
  max: number;
  color: string;
}

/** Mutable visual state shared by all draw/effect helpers. */
export interface FxState {
  particles: Particle[];
  rings: Ring[];
  hitGlow: [number, number];
  /** seconds of play, drives pulsing animations */
  time: number;
}

export function createFx(): FxState {
  return { particles: [], rings: [], hitGlow: [0, 0], time: 0 };
}

/** Advance all effects by `dt` seconds and prune dead ones. */
export function updateFx(fx: FxState, dt: number): void {
  fx.time += dt;
  fx.hitGlow[0] = Math.max(0, fx.hitGlow[0] - dt);
  fx.hitGlow[1] = Math.max(0, fx.hitGlow[1] - dt);
  for (let i = fx.rings.length - 1; i >= 0; i -= 1) {
    fx.rings[i].t -= dt;
    if (fx.rings[i].t <= 0) fx.rings.splice(i, 1);
  }
  for (let i = fx.particles.length - 1; i >= 0; i -= 1) {
    const p = fx.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      fx.particles.splice(i, 1);
      continue;
    }
    p.vx *= 1 - 1.6 * dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

/** Geometry of a player's skill-check circle. */
export function skillCircle(
  config: TimingConfig,
  p: PlayerIndex,
): { cx: number; cy: number; R: number } {
  return {
    cx: config.fieldW / 2,
    cy: p === 0 ? config.fieldH * 0.26 : config.fieldH * 0.74,
    R: Math.min(config.fieldW * 0.3, config.fieldH * 0.14),
  };
}

/** Marker angle on a player's circle: the sweep starts at the top, clockwise.
    Both players use the same rotation, so only the sweep matters. */
export function skillAngle(sweep: number): number {
  return -Math.PI / 2 + sweep;
}

/** Confetti-style burst (round resolved / match won). */
export function spawnScoreBurst(
  fx: FxState,
  x: number,
  y: number,
  fromTop: boolean,
): void {
  const color = fromTop ? TOP_COLOR : BOTTOM_COLOR;
  for (let i = 0; i < 64; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 330;
    const life = 0.7 + Math.random() * 0.55;
    fx.particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed * 0.55 + (fromTop ? 140 : -140),
      gravity: 380,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3.5,
      color: Math.random() < 0.3 ? "#ffffff" : color,
    });
  }
}

/** Small spark at the skill marker on a hit. */
export function spawnHitSpark(
  fx: FxState,
  config: TimingConfig,
  state: TimingState,
  player: PlayerIndex,
): void {
  const { cx, cy, R } = skillCircle(config, player);
  const ang = skillAngle(state.skillSweep[player]);
  const mx = cx + Math.cos(ang) * R;
  const my = cy + Math.sin(ang) * R;
  const color = player === 0 ? TOP_COLOR : BOTTOM_COLOR;
  for (let i = 0; i < 10; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 150;
    const life = 0.2 + Math.random() * 0.25;
    fx.particles.push({
      x: mx,
      y: my,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      gravity: 100,
      life,
      maxLife: life,
      size: 1.5 + Math.random() * 2,
      color: Math.random() < 0.4 ? "#ffffff" : color,
    });
  }
  fx.rings.push({ x: mx, y: my, t: 0.3, max: 0.3, color });
}

/** Red ring at the skill marker on a miss. */
export function spawnMissRing(
  fx: FxState,
  config: TimingConfig,
  state: TimingState,
  player: PlayerIndex,
): void {
  const { cx, cy, R } = skillCircle(config, player);
  const ang = skillAngle(state.skillSweep[player]);
  const mx = cx + Math.cos(ang) * R;
  const my = cy + Math.sin(ang) * R;
  fx.rings.push({ x: mx, y: my, t: 0.35, max: 0.35, color: "#f87171" });
}

/** The depleting ring around the countdown (reflex: 3→0; blind: only while visible). */
export function drawCountdownRing(
  c: CanvasRenderingContext2D,
  config: TimingConfig,
  state: TimingState,
): void {
  if (state.phase !== "countdown") return;
  if (state.mode === "blind" && state.countdown <= state.hideAt) return;
  const R = Math.min(config.fieldW, config.fieldH) * 0.13;
  const frac = clamp(state.countdown / config.countdown, 0, 1);
  c.strokeStyle = "rgba(226, 232, 240, 0.35)";
  c.lineWidth = 4;
  c.lineCap = "round";
  c.beginPath();
  c.arc(config.fieldW / 2, config.fieldH / 2, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  c.stroke();
}

/** One player's skill-check circle: their own continuous marker and their own
    zone with a good (outer) and great (inner) band. A better result earns a
    faster next zone, but the reach distance is the same for both players. */
export function drawSkillPlayer(
  c: CanvasRenderingContext2D,
  fx: FxState,
  config: TimingConfig,
  state: TimingState,
  p: PlayerIndex,
): void {
  const { cx, cy, R } = skillCircle(config, p);
  const color = p === 0 ? TOP_COLOR : BOTTOM_COLOR;
  const pl = state.skill[p];

  // Track.
  c.strokeStyle = "rgba(148, 163, 184, 0.22)";
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.stroke();

  if (pl.zoneActive) {
    const zoneAng = skillAngle(pl.zone);
    // Good band: dimmer outer arc.
    c.globalAlpha = 0.14;
    c.fillStyle = "#ef4444";
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, zoneAng - config.skillZoneHalf, zoneAng + config.skillZoneHalf);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.7;
    c.strokeStyle = "#f87171";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, R, zoneAng - config.skillZoneHalf, zoneAng + config.skillZoneHalf);
    c.stroke();
    c.globalAlpha = 1;
    // Great band: bright small red arc (the precise target).
    c.globalAlpha = 0.24 + 0.1 * Math.sin(fx.time * 7);
    c.fillStyle = "#ef4444";
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, zoneAng - config.skillGreatHalf, zoneAng + config.skillGreatHalf);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    c.save();
    c.shadowColor = "#ef4444";
    c.shadowBlur = 16;
    c.strokeStyle = "#f87171";
    c.lineWidth = 5;
    c.beginPath();
    c.arc(cx, cy, R, zoneAng - config.skillGreatHalf, zoneAng + config.skillGreatHalf);
    c.stroke();
    c.restore();
  } else {
    // Cooldown: a depleting arc showing when the next zone comes.
    const frac = clamp(pl.cooldown / config.skillMissCooldown, 0, 1);
    c.strokeStyle = "rgba(148, 163, 184, 0.28)";
    c.lineWidth = 3;
    c.lineCap = "round";
    c.beginPath();
    c.arc(cx, cy, R + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    c.stroke();
    c.lineCap = "butt";
  }

  // Continuously-sweeping marker, glowing brighter right after a hit.
  const glow = fx.hitGlow[p] > 0 ? 0.3 * (fx.hitGlow[p] / 0.25) : 0;
  const ang = skillAngle(state.skillSweep[p]);
  const mx = cx + Math.cos(ang) * R;
  const my = cy + Math.sin(ang) * R;
  c.save();
  c.shadowColor = color;
  c.shadowBlur = 16 + glow * 30;
  c.fillStyle = color;
  c.beginPath();
  c.arc(mx, my, 8, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.9;
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.arc(mx, my, 3.5, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Display stats for the skill results screen. */
export interface CurveStats {
  hits: number;
  greats: number;
  goods: number;
  misses: number;
  deviations: number[];
  mean: number;
  sigma: number;
  /** game average in ms (misses count as the penalty) — the deciding stat */
  avg: number;
  /** best single hit in ms */
  best: number;
}

export interface SkillResult {
  avg: [number, number];
  stats: [CurveStats, CurveStats];
}
