// Pure, framework-free "tap at the right moment" engine for a two-player
// (top vs bottom) touch game, in the same style as the pong and tug engines:
// all timing is expressed in seconds, all geometry in field pixels, and the
// Vue page derives a config from the viewport via makeTimingConfig().
//
// Three modes, each with its own fairness story:
//
//  1. REFLEX (visible countdown, tap at 0, too early = disqualified):
//     a shared 3-2-1 countdown ticks to zero; each player taps their half
//     when it hits 0. The FIRST tap per player per round is their one shot
//     (no retries, no spam). Taps before the exact zero moment are
//     disqualified; late taps are measured in ms against the true zero
//     (engine time, not the frame that drew "0"). Closest wins the round;
//     first to roundsToWin round wins takes the match. Both players react
//     to the same frames of the same screen, so nothing favours a side;
//     one shot each keeps a masher from drowning out an honest tapper.
//
//  2. SKILL CHECK (continuous circle, tap the small red zone, lowest average
//     deviation wins): both players share ONE continuous sweep — same marker,
//     same red target zone, same timing and count of opportunities — so
//     neither side can ever get an easier or harder hand from randomness.
//     A marker runs around the circle; a small red zone sits at a fixed
//     angle and you tap while the marker is inside it. Each lap a fresh
//     shared zone spawns far enough ahead that the marker always takes at
//     least skillReachMin seconds to reach it (never rushed, never behind
//     the marker). The first tap per player per lap is judged: in-zone = a
//     hit with a deviation in ms (angular miss converted to time), out-of-
//     zone = a miss (flat penalty), never tapping during a lap = a miss.
//     After the time limit the average deviation (misses count as the
//     penalty) decides; the page renders each player's deviation
//     distribution as a bell curve.
//
//  3. BLIND (count from 20 to 0 in your head): the countdown starts at 20
//     and is shown normally until a random point (4-12 seconds remaining,
//     re-rolled every round) at which the display disappears. From then on
//     it is pure mental counting; the first tap per player is their guess,
//     deviation is |tap - zero| and the closest wins. No disqualification
//     here — an early tap is just a bad estimate that naturally loses.
//
// Player 0 is the TOP player, player 1 the BOTTOM player.

export type PlayerIndex = 0 | 1;
export type Mode = "reflex" | "skill" | "blind";
export type RoundPhase = "countdown" | "active" | "result" | "matchover";

/** One player's single attempt in a reflex/blind round. */
export interface RoundRecord {
  tapped: boolean;
  /** seconds on the round clock at the moment of the tap */
  tapTime: number;
  /** ms deviation from zero, set at resolution; NaN while unresolved/untapped */
  devMs: number;
  /** reflex: tapped before zero (disqualified); blind: tapped before zero (sign of the miss) */
  early: boolean;
}

/** A player's live skill-check session. Each player has their own continuous
 * circle, marker and zone, so a better player is rewarded (great -> faster
 * next zone); the only shared thing is the reach distance (state.skillReach),
 * which is the same for both players so nobody gets an unfair shorter reach. */
export interface SkillPlayerState {
  /** true while this player's zone is live and awaiting a tap */
  zoneActive: boolean;
  /** seconds left in the zone's active window, while zoneActive */
  zoneWindow: number;
  /** true once the first tap of this zone was judged (one shot per zone) */
  tapped: boolean;
  /** seconds before the next zone spawns, while !zoneActive */
  cooldown: number;
  /** current zone centre (radians), while zoneActive */
  zone: number;
  /** total hits (great + good) */
  hits: number;
  greats: number;
  goods: number;
  misses: number;
  /** ms deviation of every hit (drives the bell curve) */
  deviations: number[];
  /** running average deviation in ms; misses count as skillMissPenalty */
  avg: number;
  lastResult: "great" | "good" | "miss" | null;
}

export interface TimingConfig {
  fieldW: number;
  fieldH: number;
  mode: Mode;
  /** seconds of the countdown: 3 (reflex/skill) or 20 (blind start) */
  countdown: number;
  /** reflex/blind: intermission between rounds while the result shows */
  roundPause: number;
  /** reflex/blind: first player to this many round wins takes the match */
  roundsToWin: number;
  /** reflex: how long after zero a late tap still counts */
  reflexWindow: number;
  /** blind: display hides when this many seconds remain (random per round, min..max) */
  blindHideMin: number;
  blindHideMax: number;
  /** blind: how long after zero a guess still counts */
  blindWindow: number;
  /** skill: session length in seconds after the countdown */
  skillDuration: number;
  /** skill: seconds per full sweep lap (each player's marker runs continuously) */
  skillSweepPeriod: number;
  /** skill: shared reach, min..max seconds from zone spawn to the marker
   * reaching it — ONE value per match (1-3s), the SAME for both players */
  skillReachMin: number;
  skillReachMax: number;
  /** skill: outer zone half-width (a "good" hit) in radians */
  skillZoneHalf: number;
  /** skill: inner zone half-width (a "great" hit) in radians */
  skillGreatHalf: number;
  /** skill: cooldown before the next zone after a great / good / miss */
  skillGreatCooldown: number;
  skillGoodCooldown: number;
  skillMissCooldown: number;
  /** skill: flat ms penalty every miss counts as in the average */
  skillMissPenalty: number;
  /** injectable for tests; defaults to Math.random */
  rng: () => number;
}

export interface TimingState {
  mode: Mode;
  scores: [number, number];
  phase: RoundPhase;
  /** seconds on the current round's clock (0 = round start) */
  clock: number;
  /** seconds of the countdown remaining, while phase === "countdown" */
  countdown: number;
  /** round-clock second at which the countdown hit zero */
  zeroAt: number;
  /** blind: countdown value at which the display hides (page-side visibility) */
  hideAt: number;
  /** blind/reflex: how long the round result has been shown */
  resultT: number;
  rounds: [RoundRecord, RoundRecord];
  roundWinner: PlayerIndex | null;
  roundDevs: [number, number];
  roundEarly: [boolean, boolean];
  /** skill: session seconds elapsed since the countdown ended */
  skillClock: number;
  /** skill: shared reach (seconds) for this match — both players' zones spawn
   * exactly this far ahead of their own marker, so the distance is identical */
  skillReach: number;
  /** skill: each player's continuous marker angle (radians) */
  skillSweep: [number, number];
  skill: [SkillPlayerState, SkillPlayerState];
  skillWinner: PlayerIndex | null;
  skillAvg: [number, number];
  matchWinner: PlayerIndex | null;
}

export type TimingEvent =
  | { type: "zero" }
  | { type: "tap"; player: PlayerIndex; result: "early" | "late" | "blind" | "great" | "good" | "miss"; devMs?: number }
  | { type: "zoneSpawn"; player: PlayerIndex }
  | { type: "zoneMiss"; player: PlayerIndex }
  | { type: "roundResult"; winner: PlayerIndex | null; devs: [number, number]; early: [boolean, boolean] }
  | { type: "skillEnd"; winner: PlayerIndex | null; avg: [number, number] }
  | { type: "matchEnd"; winner: PlayerIndex };

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** Shortest angular distance between two angles in radians, in [0, π]. */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Mean and sample standard deviation of the given ms deviations. */
export function fitCurve(deviations: number[]): { mean: number; sigma: number } {
  if (deviations.length === 0) return { mean: NaN, sigma: NaN };
  const mean = deviations.reduce((a, b) => a + b, 0) / deviations.length;
  if (deviations.length === 1) return { mean, sigma: 0 };
  const varr =
    deviations.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    (deviations.length - 1);
  return { mean, sigma: Math.sqrt(varr) };
}

/**
 * Build a config for a field of the given size. Gameplay numbers are tuned
 * constants; only the (unused-by-logic) pixel size changes with the screen.
 */
export function makeTimingConfig(fieldW: number, fieldH: number, mode: Mode): TimingConfig {
  return {
    fieldW,
    fieldH,
    mode,
    countdown: mode === "blind" ? 20 : 3,
    roundPause: 1.6,
    roundsToWin: 3,
    reflexWindow: 0.45,
    blindHideMin: 4,
    blindHideMax: 12,
    blindWindow: 1.5,
    skillDuration: 30,
    skillSweepPeriod: 3.2,
    skillReachMin: 1,
    skillReachMax: 3,
    skillZoneHalf: 0.32,
    skillGreatHalf: 0.11,
    skillGreatCooldown: 1.4,
    skillGoodCooldown: 2.4,
    skillMissCooldown: 4.0,
    skillMissPenalty: 500,
    rng: Math.random,
  };
}

function freshSkill(): SkillPlayerState {
  return {
    zoneActive: false,
    zoneWindow: 0,
    tapped: false,
    cooldown: 0,
    zone: 0,
    hits: 0,
    greats: 0,
    goods: 0,
    misses: 0,
    deviations: [],
    avg: 0,
    lastResult: null,
  };
}

/** Skill: marker angular speed in radians per second. */
function skillSpeed(config: TimingConfig): number {
  return (Math.PI * 2) / config.skillSweepPeriod;
}

/** Skill: pick this match's shared reach (seconds, 1-3) — ONE value used by
 * BOTH players, so the marker-to-zone distance is identical for each. */
function pickSkillReach(config: TimingConfig): number {
  return config.skillReachMin + config.rng() * (config.skillReachMax - config.skillReachMin);
}

/** Blind: pick this round's hide point (seconds remaining when the display goes dark). */
function blindHide(config: TimingConfig): number {
  return config.blindHideMin + config.rng() * (config.blindHideMax - config.blindHideMin);
}

export function createTimingState(config: TimingConfig): TimingState {
  return {
    mode: config.mode,
    scores: [0, 0],
    phase: "countdown",
    clock: 0,
    countdown: config.countdown,
    zeroAt: NaN,
    hideAt: config.mode === "blind" ? blindHide(config) : NaN,
    resultT: 0,
    rounds: [
      { tapped: false, tapTime: 0, devMs: NaN, early: false },
      { tapped: false, tapTime: 0, devMs: NaN, early: false },
    ],
    roundWinner: null,
    roundDevs: [NaN, NaN],
    roundEarly: [false, false],
    skillClock: 0,
    skillReach: pickSkillReach(config),
    skillSweep: [0, 0],
    skill: [freshSkill(), freshSkill()],
    skillWinner: null,
    skillAvg: [NaN, NaN],
    matchWinner: null,
  };
}

function recomputeAvg(pl: SkillPlayerState, config: TimingConfig): void {
  const laps = pl.hits + pl.misses;
  if (laps === 0) {
    pl.avg = 0;
    return;
  }
  const sum = pl.deviations.reduce((a, b) => a + b, 0);
  pl.avg = (sum + pl.misses * config.skillMissPenalty) / laps;
}

/** Resolve a reflex/blind round now that the window elapsed or both tapped. */
function resolveRound(state: TimingState, config: TimingConfig, events: TimingEvent[]): void {
  const devs: [number, number] = [NaN, NaN];
  const early: [boolean, boolean] = [false, false];
  const valid: PlayerIndex[] = [];
  for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
    const r = state.rounds[p];
    if (!r.tapped) continue;
    // Disqualified: reflex tapped before zero, blind tapped while the
    // countdown was still visible. Never measured, never valid.
    if (r.early) {
      early[p] = true;
      continue;
    }
    if (state.mode === "blind") {
      const dev = Math.round(Math.abs(r.tapTime - state.zeroAt) * 1000);
      r.devMs = dev;
      devs[p] = dev;
      early[p] = r.tapTime < state.zeroAt;
      valid.push(p);
    } else {
      const dev = Math.round((r.tapTime - state.zeroAt) * 1000);
      r.devMs = dev;
      devs[p] = dev;
      valid.push(p);
    }
  }
  let winner: PlayerIndex | null = null;
  if (valid.length === 1) winner = valid[0];
  else if (valid.length === 2) winner = state.rounds[0].devMs <= state.rounds[1].devMs ? 0 : 1;
  state.roundWinner = winner;
  state.roundDevs = devs;
  state.roundEarly = early;
  if (winner !== null) state.scores[winner] += 1;
  events.push({ type: "roundResult", winner, devs, early });
  if (winner !== null && state.scores[winner] >= config.roundsToWin) {
    state.matchWinner = winner;
    state.phase = "matchover";
    events.push({ type: "matchEnd", winner });
  } else {
    state.phase = "result";
  }
}

function resetRound(state: TimingState, config: TimingConfig): void {
  state.clock = 0;
  state.countdown = config.countdown;
  state.zeroAt = NaN;
  state.hideAt = config.mode === "blind" ? blindHide(config) : NaN;
  state.resultT = 0;
  state.rounds = [
    { tapped: false, tapTime: 0, devMs: NaN, early: false },
    { tapped: false, tapTime: 0, devMs: NaN, early: false },
  ];
  state.roundWinner = null;
  state.roundDevs = [NaN, NaN];
  state.roundEarly = [false, false];
  state.phase = "countdown";
}

function stepSkill(state: TimingState, dt: number, config: TimingConfig, events: TimingEvent[]): void {
  state.skillClock += dt;
  const speed = skillSpeed(config);
  const reachAngle = state.skillReach * speed;
  const zoneWindow = state.skillReach + config.skillZoneHalf / speed + 0.25;
  for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
    const pl = state.skill[p];
    state.skillSweep[p] = (state.skillSweep[p] + speed * dt) % (Math.PI * 2);
    if (pl.zoneActive) {
      pl.zoneWindow -= dt;
      // The window elapsed without a tap (in-zone or not): a miss.
      if (pl.zoneWindow <= 0) {
        pl.zoneActive = false;
        pl.misses += 1;
        recomputeAvg(pl, config);
        pl.cooldown = config.skillMissCooldown;
        pl.lastResult = "miss";
        events.push({ type: "zoneMiss", player: p });
      }
    } else {
      pl.cooldown -= dt;
      if (pl.cooldown <= 0) {
        // Spawn the zone exactly `skillReach` ahead of this player's marker.
        pl.zone = (state.skillSweep[p] + reachAngle) % (Math.PI * 2);
        pl.zoneActive = true;
        pl.tapped = false;
        pl.zoneWindow = zoneWindow;
        events.push({ type: "zoneSpawn", player: p });
      }
    }
  }
  if (state.skillClock >= config.skillDuration) {
    let winner: PlayerIndex | null = null;
    if (state.skill[0].avg < state.skill[1].avg) winner = 0;
    else if (state.skill[1].avg < state.skill[0].avg) winner = 1;
    state.skillWinner = winner;
    state.skillAvg = [state.skill[0].avg, state.skill[1].avg];
    state.matchWinner = winner;
    state.phase = "result";
    events.push({ type: "skillEnd", winner, avg: state.skillAvg });
  }
}

/**
 * Advance the game by `dt` seconds. Mutates `state`, returns the events that
 * happened (for sound/UI feedback). Matches stay frozen once decided.
 */
export function stepTiming(state: TimingState, dt: number, config: TimingConfig): TimingEvent[] {
  const events: TimingEvent[] = [];
  if (state.matchWinner !== null || state.mode !== config.mode) return events;

  if (state.phase === "countdown") {
    state.countdown -= dt;
    state.clock += dt;
    if (state.countdown <= 0) {
      state.countdown = 0;
      state.zeroAt = state.clock;
      state.phase = "active";
      events.push({ type: "zero" });
    }
  } else if (state.phase === "active") {
    if (state.mode === "skill") {
      stepSkill(state, dt, config, events);
    } else {
      state.clock += dt;
      const window = state.mode === "reflex" ? config.reflexWindow : config.blindWindow;
      if (
        (state.rounds[0].tapped && state.rounds[1].tapped) ||
        state.clock >= state.zeroAt + window
      ) {
        resolveRound(state, config, events);
      }
    }
  } else if (state.phase === "result") {
    state.resultT += dt;
    if (state.resultT >= config.roundPause) resetRound(state, config);
  }
  return events;
}

/**
 * One tap by `player`. Returns [] (and changes nothing) when the tap is not
 * a live attempt: already used up this round/lap, outside the window, or the
 * match is over. First tap per player per round (reflex/blind) or per lap
 * (skill) is the only one that counts.
 */
export function tapTiming(state: TimingState, player: PlayerIndex, config: TimingConfig): TimingEvent[] {
  if (state.matchWinner !== null || state.mode !== config.mode) return [];

  if (state.mode === "skill") {
    if (state.phase !== "active") return [];
    const pl = state.skill[player];
    if (!pl.zoneActive || pl.tapped) return [];
    pl.tapped = true;
    const diff = angularDistance(state.skillSweep[player], pl.zone);
    pl.zoneActive = false;
    if (diff <= config.skillZoneHalf) {
      const devMs = Math.round((diff / skillSpeed(config)) * 1000);
      pl.deviations.push(devMs);
      pl.hits += 1;
      if (diff <= config.skillGreatHalf) {
        pl.greats += 1;
        pl.cooldown = config.skillGreatCooldown;
        pl.lastResult = "great";
        recomputeAvg(pl, config);
        return [{ type: "tap", player, result: "great", devMs }];
      }
      pl.goods += 1;
      pl.cooldown = config.skillGoodCooldown;
      pl.lastResult = "good";
      recomputeAvg(pl, config);
      return [{ type: "tap", player, result: "good", devMs }];
    }
    // Tapped outside the zone: a miss.
    pl.misses += 1;
    pl.cooldown = config.skillMissCooldown;
    pl.lastResult = "miss";
    recomputeAvg(pl, config);
    return [{ type: "tap", player, result: "miss" }];
  }

  // reflex / blind
  if (state.phase === "countdown") {
    const r = state.rounds[player];
    if (r.tapped) return [];
    r.tapped = true;
    r.tapTime = state.clock;
    if (state.mode === "blind") {
      // Tapping while the countdown is still on screen is disqualification,
      // exactly like reflex: you had full information, so it cannot be a
      // guess. Only taps after the display hides count as estimates.
      if (state.countdown > state.hideAt) {
        r.early = true;
        return [{ type: "tap", player, result: "early" }];
      }
      return [{ type: "tap", player, result: "blind" }];
    }
    r.early = true;
    return [{ type: "tap", player, result: "early" }];
  }
  if (state.phase === "active") {
    const r = state.rounds[player];
    if (r.tapped) return [];
    const window = state.mode === "reflex" ? config.reflexWindow : config.blindWindow;
    if (state.clock > state.zeroAt + window) return [];
    r.tapped = true;
    r.tapTime = state.clock;
    if (state.mode === "reflex") {
      r.devMs = Math.round((state.clock - state.zeroAt) * 1000);
      return [{ type: "tap", player, result: "late", devMs: r.devMs }];
    }
    return [{ type: "tap", player, result: "blind" }];
  }
  return [];
}
