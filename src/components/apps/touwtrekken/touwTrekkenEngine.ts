// Pure, framework-free tug-of-war simulation for a two-player (top vs bottom)
// touch game. All geometry and speeds are expressed in field pixels, so the
// exact same engine runs on any screen size; the Vue page derives a config
// from the viewport via makeTugConfig(). Gameplay numbers scale with the
// SMALLER field dimension, exactly like the pong engine.
//
// How it plays: a knot sits on a vertical rope between the two players. Each
// tap in your half pulls the knot one fixed step toward your edge; the knot
// drifts back to the centre under rope tension whenever nobody pulls. The
// first player to drag the knot past their win line scores a round; scores
// run indefinitely.
//
// Fairness design — why neither side can get an unfair edge:
//  1. Both players pull with identical mechanics: one tap = exactly
//     tapStrength px toward your own side, regardless of where you tap or
//     how hard. Only the number of taps matters.
//  2. Every round starts with a fixed countdown and taps are ignored until
//     it expires, so nobody can pre-load a lead before "go".
//  3. The knot is clamped between the two win lines, so it can never be
//     pushed past a scoring line into "dead" territory; the moment a pull
//     reaches the line the round resolves.
//  4. Tension decay is symmetric: with both players idle the knot always
//     returns to the exact centre, so an equal tap rate never decides a
//     round by accident — you have to out-tap your opponent.
//  5. A per-player tap cooldown (tapAllowed) collapses near-simultaneous
//     multi-finger presses into a single pull: one physical gesture = one
//     pull, so mashing four fingers at once can't out-pull an honest fast
//     tapper. 70ms is above the ~11-12 taps/sec a single finger sustains,
//     so legitimate tapping (and alternating fingers "in order") is never
//     throttled.
//  6. The critical tap (when config.criticalEnabled): a bonus zone spawns
//     on BOTH players' halves at once, heatmap-avoided (away from where
//     they've been tapping). Tapping inside it is a much bigger pull, and
//     consecutive hits escalate it (combo) until the episode expires — the
//     zone shrinks the whole time and relocates after every hit. The whole
//     episode is bounded: 3s for the leader, up to 5s for the trailer (the
//     zone waits for their first press or 2s of grace), so it's a comeback
//     nudge, not a runaway. Misses (an expired placement) reset the combo.
//     The entire system can be switched off by setting criticalEnabled
//     to false (e.g. from a settings button).
//
// Player 0 is the TOP player (pulls the knot up), player 1 the BOTTOM player
// (pulls it down).

export type PlayerIndex = 0 | 1;

/** Minimum ms between two counted pulls by the same player. */
export const TAP_COOLDOWN_MS = 70;

/** True when a pull may register at `now`, given the last one counted at `lastAt`. */
export function tapAllowed(now: number, lastAt: number): boolean {
  return now - lastAt >= TAP_COOLDOWN_MS;
}

export interface TugConfig {
  fieldW: number;
  fieldH: number;
  /** y of each player's win line; the knot reaching winLineY[player] wins that player the round */
  winLineY: [number, number];
  /** knot displacement per successful pull, px */
  tapStrength: number;
  /** how fast the knot drifts back to the centre when nobody pulls, px/s */
  decaySpeed: number;
  /** seconds the countdown lasts after a reset; taps are ignored meanwhile */
  countdownTime: number;
  knotRadius: number;
  ropeWidth: number;
  /** Master switch for the critical-tap system. Flip at runtime (e.g. a
   * settings button) to enable/disable it mid-match; safe to mutate. */
  criticalEnabled: boolean;
  /** Permanent crit mode: when true (default false — off until a UI toggle
   * enables it), a zone pair spawns once and never expires — no window
   * countdown, no shrink, no combo resets from missing. Hits still relocate
   * the zone and build combo; a score clears the pair and it respawns.
   * Only meaningful while criticalEnabled is true. */
  criticalPermanent: boolean;
  /** spawn radius of a critical zone, px */
  criticalRadius: number;
  /** seconds a zone episode stays active once its window has started */
  criticalWindow: number;
  /** seconds the trailer's zone waits for their first press before the
   * window auto-starts; the leader's window starts instantly at spawn */
  criticalGrace: number;
  /** pull multiplier of the first hit in an episode */
  criticalBase: number;
  /** extra multiplier per consecutive hit (combo) */
  criticalStep: number;
  /** combo multiplier cap */
  criticalMax: number;
  /** seconds of active play before the first spawn pair (randomised range) */
  criticalFirstMin: number;
  criticalFirstMax: number;
  /** seconds between spawn pairs once the previous pair has resolved */
  criticalIntervalMin: number;
  criticalIntervalMax: number;
  /** placement candidates sampled per spawn; the lowest tap-density wins */
  criticalCandidates: number;
  /** heatmap gaussian sigma, px */
  criticalSigma: number;
  /** seconds of recent taps considered for heatmap placement */
  heatmapWindow: number;
  /** radius never shrinks below this fraction of the spawn radius */
  criticalFloor: number;
  /** relocation must be at least this many spawn radii from the previous spot */
  criticalMinDrift: number;
}

export type RoundPhase = "countdown" | "active";

/** A tap position for heatmap-based critical placement. */
export interface TapPoint {
  x: number;
  y: number;
  /** seconds of active play when the tap landed (state.clock) */
  t: number;
}

export type CriticalPhase = "waiting" | "active";

/** A player's live critical zone (the bonus tap target). */
export interface CriticalZone {
  player: PlayerIndex;
  x: number;
  y: number;
  /** current radius; shrinks from r0 toward r0 * criticalFloor while active */
  r: number;
  r0: number;
  /** seconds of the active window remaining */
  window: number;
  /** seconds of the trailer's grace remaining while "waiting" */
  grace: number;
  phase: CriticalPhase;
  /** consecutive hits in the current episode */
  combo: number;
}

export interface TugState {
  /** absolute y of the knot; the centre is fieldH / 2 */
  knotY: number;
  scores: [number, number];
  phase: RoundPhase;
  /** seconds remaining until the round becomes active; only meaningful while phase === "countdown" */
  countdown: number;
  /** each player's critical zone, or null when none is live */
  zones: [CriticalZone | null, CriticalZone | null];
  /** recent tap positions per player, pruned to the heatmap window */
  recentTaps: [TapPoint[], TapPoint[]];
  /** seconds of active play until the next spawn pair; only advances while active */
  criticalClock: number;
  /** seconds of active play (heatmap time base) */
  clock: number;
}

export interface TugInsets {
  top: number;
  bottom: number;
}

export type TugEvent =
  | { type: "tug"; player: PlayerIndex }
  | { type: "go" }
  | { type: "score"; winner: PlayerIndex }
  | { type: "criticalSpawn"; player: PlayerIndex }
  | { type: "criticalHit"; player: PlayerIndex; combo: number; x: number; y: number }
  | { type: "criticalExpire"; player: PlayerIndex; combo: number };

/** A chosen critical-zone position. */
export interface Spot {
  x: number;
  y: number;
  r: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Build a config for a field of the given size. Every gameplay number is a
 * fraction of the smaller field dimension, so small and large phones play
 * identically; only the pixel scales change. The win lines sit 12% of the
 * field height inside each edge (past the safe-area insets).
 */
export function makeTugConfig(
  fieldW: number,
  fieldH: number,
  insets: TugInsets = { top: 14, bottom: 14 },
): TugConfig {
  const s = Math.min(fieldW, fieldH);
  const winMargin = fieldH * 0.12;
  return {
    fieldW,
    fieldH,
    winLineY: [
      insets.top + winMargin,
      fieldH - insets.bottom - winMargin,
    ],
    tapStrength: s * 0.055,
    decaySpeed: s * 0.075,
    countdownTime: 3,
    knotRadius: clamp(s * 0.026, 7, 13),
    ropeWidth: clamp(s * 0.014, 3, 6),
    criticalEnabled: true,
    criticalPermanent: false,
    criticalRadius: clamp(s * 0.11, 34, 60),
    criticalWindow: 3,
    criticalGrace: 2,
    criticalBase: 2.5,
    criticalStep: 0.5,
    criticalMax: 4,
    criticalFirstMin: 5,
    criticalFirstMax: 10,
    criticalIntervalMin: 6,
    criticalIntervalMax: 12,
    criticalCandidates: 12,
    criticalSigma: s * 0.3,
    heatmapWindow: 5,
    criticalFloor: 0.38,
    criticalMinDrift: 2.5,
  };
}

export function createTugState(config: TugConfig): TugState {
  return {
    knotY: config.fieldH / 2,
    scores: [0, 0],
    phase: "countdown",
    countdown: config.countdownTime,
    zones: [null, null],
    recentTaps: [[], []],
    criticalClock:
      config.criticalFirstMin +
      Math.random() * (config.criticalFirstMax - config.criticalFirstMin),
    clock: 0,
  };
}

/**
 * Pick a critical-zone spot on `player`'s half, away from screen borders and
 * (heatmap) away from where they've been tapping: `recentTaps` within the
 * heatmap window contribute a gaussian density, and `criticalCandidates`
 * random spots are sampled — the least dense wins. `prev` (the zone's
 * previous position) forces a visible drift. Pure and injectable for tests.
 */
export function pickCriticalSpot(
  config: TugConfig,
  player: PlayerIndex,
  recentTaps: TapPoint[],
  prev: { x: number; y: number } | null,
  rng: () => number = Math.random,
): Spot {
  const r = config.criticalRadius;
  const mx = Math.max(config.fieldW * 0.1, r * 1.6);
  const bandLow =
    player === 0
      ? config.winLineY[0] + config.fieldH * 0.05
      : config.fieldH / 2 + config.fieldH * 0.06;
  const bandHigh =
    player === 0
      ? config.fieldH / 2 - config.fieldH * 0.06
      : config.winLineY[1] - config.fieldH * 0.05;
  const yLo = Math.min(bandLow + r, bandHigh - r);
  const ySpan = Math.max(bandHigh - r - yLo, 1);
  const xSpan = Math.max(config.fieldW - 2 * mx, 1);
  const sigma2 = 2 * config.criticalSigma * config.criticalSigma;
  const driftPenalty = 1e6;

  let best: Spot = { x: mx, y: yLo, r };
  let bestScore = Infinity;
  for (let i = 0; i < config.criticalCandidates; i += 1) {
    const x = mx + rng() * xSpan;
    const y = yLo + rng() * ySpan;
    let score = 0;
    for (const tp of recentTaps) {
      const dx = tp.x - x;
      const dy = tp.y - y;
      score += Math.exp(-(dx * dx + dy * dy) / sigma2);
    }
    if (prev && Math.hypot(prev.x - x, prev.y - y) < config.criticalMinDrift * r) {
      score += driftPenalty;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { x, y, r };
    }
  }
  return best;
}

function pruneRecentTaps(state: TugState, config: TugConfig): void {
  const cutoff = state.clock - config.heatmapWindow;
  for (let p = 0; p < 2; p += 1) {
    state.recentTaps[p] = state.recentTaps[p].filter((tp) => tp.t >= cutoff);
  }
}

/** Spawn a zone for BOTH players at once; the trailer's starts in "waiting". */
function spawnCriticalZones(state: TugState, config: TugConfig, events: TugEvent[]): void {
  const centre = config.fieldH / 2;
  const loser: PlayerIndex =
    state.knotY < centre - 1 ? 1 : state.knotY > centre + 1 ? 0 : Math.random() < 0.5 ? 0 : 1;
  for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
    const spot = pickCriticalSpot(config, p, state.recentTaps[p], null);
    state.zones[p] = {
      player: p,
      x: spot.x,
      y: spot.y,
      r: spot.r,
      r0: spot.r,
      window: config.criticalWindow,
      grace: config.criticalGrace,
      phase: p === loser ? "waiting" : "active",
      combo: 0,
    };
    events.push({ type: "criticalSpawn", player: p });
  }
}

/**
 * Advance the round clock by `dt` seconds. Mutates `state`, returns the
 * events that happened (for sound/UI feedback). Handles the countdown, the
 * symmetric tension decay that pulls an idle knot back to the centre, and —
 * when config.criticalEnabled — the critical-zone schedule and lifecycles
 * (spawn pairs, trailer grace, shrinking, expiry). Win checks live in
 * pullTug: only a pull can move the knot outward, so only a pull can score.
 * Everything here only runs during active play.
 */
export function stepTug(
  state: TugState,
  dt: number,
  config: TugConfig,
): TugEvent[] {
  if (state.phase === "countdown") {
    state.countdown -= dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      state.phase = "active";
      return [{ type: "go" }];
    }
    return [];
  }

  const events: TugEvent[] = [];
  const centre = config.fieldH / 2;
  const offset = centre - state.knotY;
  if (offset !== 0) {
    const move = Math.min(Math.abs(offset), config.decaySpeed * dt);
    state.knotY += Math.sign(offset) * move;
  }

  if (config.criticalEnabled) {
    state.clock += dt;
    pruneRecentTaps(state, config);

    if (config.criticalPermanent) {
      // One pair, always on: respawn whenever both zones are gone (e.g.
      // after a score cleared them); no interval scheduling, no expiry.
      if (!state.zones[0] && !state.zones[1]) {
        spawnCriticalZones(state, config, events);
      }
    } else {
      state.criticalClock -= dt;
      if (state.criticalClock <= 0 && !state.zones[0] && !state.zones[1]) {
        spawnCriticalZones(state, config, events);
        state.criticalClock =
          config.criticalIntervalMin +
          Math.random() * (config.criticalIntervalMax - config.criticalIntervalMin);
      }
    }

    for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
      const z = state.zones[p];
      if (!z) continue;
      if (z.phase === "waiting") {
        z.grace -= dt;
        if (z.grace <= 0) {
          z.phase = "active";
          z.window = config.criticalWindow;
        }
      } else if (config.criticalPermanent) {
        // Permanent mode: the zone stays full-size forever.
        z.window = config.criticalWindow;
        z.r = z.r0;
      } else {
        z.window -= dt;
        z.r = Math.max(
          z.r0 * config.criticalFloor,
          z.r0 * (z.window / config.criticalWindow),
        );
        if (z.window <= 0) {
          events.push({ type: "criticalExpire", player: p, combo: z.combo });
          state.zones[p] = null;
        }
      }
    }
  }
  return events;
}

/**
 * One tap by `player` at (x, y). Returns [] (and moves nothing) while the
 * round is still in the countdown, so both players always start from the
 * same line. Records the tap for the heatmap; if it lands in the player's
 * live critical zone, it's a critical hit — a much bigger pull that
 * escalates per combo hit and relocates the zone. On the tap that drags the
 * knot onto a win line the round ends, the score is awarded, the zones are
 * cleared (chains die with the round) and the next round's countdown starts
 * with the knot reset.
 */
export function pullTug(
  state: TugState,
  player: PlayerIndex,
  config: TugConfig,
  x = config.fieldW / 2,
  y = player === 0 ? config.fieldH * 0.3 : config.fieldH * 0.7,
): TugEvent[] {
  if (state.phase !== "active") return [];

  const events: TugEvent[] = [];
  if (config.criticalEnabled) {
    state.recentTaps[player].push({ x, y, t: state.clock });
  }

  const z = config.criticalEnabled ? state.zones[player] : null;
  let hit = false;
  if (z) {
    const dist = Math.hypot(x - z.x, y - z.y);
    if (z.phase === "waiting") {
      // The trailer's first press starts their window; it counts as a hit
      // if it lands on the zone.
      z.phase = "active";
      z.window = config.criticalWindow;
      hit = dist <= z.r;
    } else {
      hit = dist <= z.r;
    }
  }

  let strength = config.tapStrength;
  if (hit && z) {
    z.combo += 1;
    strength =
      config.tapStrength *
      Math.min(config.criticalBase + (z.combo - 1) * config.criticalStep, config.criticalMax);
  }

  state.knotY = clamp(
    state.knotY + (player === 0 ? -strength : strength),
    config.winLineY[0],
    config.winLineY[1],
  );

  if (state.knotY === config.winLineY[0] || state.knotY === config.winLineY[1]) {
    const winner: PlayerIndex = state.knotY === config.winLineY[0] ? 0 : 1;
    state.scores[winner] += 1;
    state.knotY = config.fieldH / 2;
    state.phase = "countdown";
    state.countdown = config.countdownTime;
    state.zones = [null, null];
    events.push({ type: "score", winner });
    return events;
  }

  if (hit && z) {
    // Relocate away from where the player is mashing. The episode clock
    // keeps running, so the radius stays consistent with the window left.
    const spot = pickCriticalSpot(config, player, state.recentTaps[player], { x: z.x, y: z.y });
    z.x = spot.x;
    z.y = spot.y;
    z.r0 = spot.r;
    z.r = Math.max(
      z.r0 * config.criticalFloor,
      z.r0 * (z.window / config.criticalWindow),
    );
    events.push({ type: "criticalHit", player, combo: z.combo, x, y });
  } else {
    events.push({ type: "tug", player });
  }

  return events;
}
