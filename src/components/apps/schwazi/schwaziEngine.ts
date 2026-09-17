// Pure, framework-free schwazi (finger chooser) simulation.
//
// How it plays: every finger on the screen is a touchpoint; each owns a
// persistent circle that glides toward it with an exponential lerp, so fast
// finger movement reads as smooth motion instead of teleporting. Circles are
// bound to touchpoints by stable ids — browsers DO report stable ones
// (PointerEvent.pointerId / Touch.identifier), so a circle never jumps to
// another player's finger; crossing fingers stay with their owner.
//
// When nobody joins or leaves for `stabilityTime` seconds and at least
// `minPlayers` circles are down, the app picks:
//   selector — one random circle
//   multi    — `count` distinct random circles (clamped to the circle count)
//   number   — a random order, every circle gets 1..N
//   team     — everyone is split into `count` random, balanced teams
//
// The engine is colour-agnostic: circles carry a colorIndex and the page owns
// the palettes and the reveal animation. Timer semantics follow the original
// Chooser app: only joins/leaves reset the countdown, movement never does.

export type SchwaziMode = "selector" | "multi" | "number" | "team";

export interface SchwaziConfig {
  mode: SchwaziMode;
  /** multi: how many to pick; team: how many teams; clamped to the circle count */
  count: number;
  /** seconds without a join/leave before the pick happens */
  stabilityTime: number;
  /** minimum circles required to pick (lone circles never pick themselves) */
  minPlayers: number;
  /** exponential lerp rate per second (higher = circles snap faster) */
  lerpRate: number;
}

export interface FingerPoint {
  id: number;
  x: number;
  y: number;
}

export interface Circle {
  id: number;
  x: number;
  y: number;
  /** identity colour index; the page maps it to a palette */
  colorIndex: number;
}

export interface RevealEntry {
  circleId: number;
  /** "KIES" for winners, "1".."N" for number mode, a team letter, or "" */
  label: string;
  /** true = stays on screen after the reveal (all of them in number/team) */
  winner: boolean;
  /** colour index to render with after the reveal (team mode = team index) */
  colorIndex: number;
}

export type SchwaziPhase = "holding" | "done";

export interface SchwaziState {
  phase: SchwaziPhase;
  circles: Circle[];
  /** seconds accumulated with no join/leave while enough circles are down */
  stableTime: number;
  /** per-circle reveal info; set when phase becomes "done" */
  reveal: RevealEntry[] | null;
}

export type SchwaziEvent =
  | { type: "join"; circleId: number }
  | { type: "leave"; circleId: number }
  | { type: "pick" };

export function makeSchwaziConfig(partial: Partial<SchwaziConfig> = {}): SchwaziConfig {
  return {
    mode: partial.mode ?? "selector",
    count: partial.count ?? 3,
    stabilityTime: partial.stabilityTime ?? 2,
    minPlayers: partial.minPlayers ?? 2,
    lerpRate: partial.lerpRate ?? 14,
  };
}

export function createSchwaziState(): SchwaziState {
  return { phase: "holding", circles: [], stableTime: 0, reveal: null };
}

export function resetSchwazi(state: SchwaziState): void {
  state.phase = "holding";
  state.circles = [];
  state.stableTime = 0;
  state.reveal = null;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Smallest colorIndex not currently in use, so freed colours get reused. */
function nextColorIndex(circles: Circle[]): number {
  const used = new Set(circles.map((c) => c.colorIndex));
  let i = 0;
  while (used.has(i)) i += 1;
  return i;
}

/**
 * Advance one frame. Mutates `state`, returns events for sound/effects.
 * Joins spawn circles at the finger, leaves remove them; the stability timer
 * only accrues while nobody joins or leaves and at least `minPlayers` circles
 * are down; reaching `stabilityTime` triggers the pick.
 */
export function syncFingers(
  state: SchwaziState,
  fingers: FingerPoint[],
  dt: number,
  config: SchwaziConfig,
): SchwaziEvent[] {
  if (state.phase === "done") return [];
  const events: SchwaziEvent[] = [];

  const byId = new Map(fingers.map((f) => [f.id, f]));
  const present = new Set(state.circles.map((c) => c.id));

  // Spawn a circle for every finger that just joined.
  for (const f of fingers) {
    if (present.has(f.id)) continue;
    state.circles.push({
      id: f.id,
      x: f.x,
      y: f.y,
      colorIndex: nextColorIndex(state.circles),
    });
    events.push({ type: "join", circleId: f.id });
  }

  // Glide each circle toward its own touchpoint.
  const k = 1 - Math.exp(-config.lerpRate * dt);
  for (const c of state.circles) {
    const f = byId.get(c.id);
    if (!f) continue;
    c.x += (f.x - c.x) * k;
    c.y += (f.y - c.y) * k;
  }

  // Remove circles whose finger left.
  const left = state.circles.filter((c) => !byId.has(c.id));
  if (left.length > 0) {
    state.circles = state.circles.filter((c) => byId.has(c.id));
    for (const c of left) events.push({ type: "leave", circleId: c.id });
  }

  // Stability: reset on any join/leave; only accrue with enough fingers down.
  if (state.circles.length < config.minPlayers) {
    state.stableTime = 0;
  } else {
    if (events.some((e) => e.type === "join" || e.type === "leave")) {
      state.stableTime = 0;
    }
    state.stableTime += dt;
    if (state.stableTime >= config.stabilityTime) {
      makePick(state, config);
      events.push({ type: "pick" });
    }
  }
  return events;
}

/**
 * The random decision, per mode. Mutates `state` into "done" and returns the
 * reveal entries. `rng` is injectable for deterministic tests.
 */
export function makePick(
  state: SchwaziState,
  config: SchwaziConfig,
  rng: () => number = Math.random,
): RevealEntry[] | null {
  const n = state.circles.length;
  if (n === 0) return null;

  const order = shuffle(state.circles, rng);
  let reveal: RevealEntry[];

  switch (config.mode) {
    case "selector": {
      const winnerId = order[0].id;
      reveal = state.circles.map((c) => ({
        circleId: c.id,
        label: "",
        winner: c.id === winnerId,
        colorIndex: c.colorIndex,
      }));
      break;
    }
    case "multi": {
      const k = Math.min(Math.max(Math.round(config.count), 1), n);
      const winners = new Set(order.slice(0, k).map((c) => c.id));
      reveal = state.circles.map((c) => ({
        circleId: c.id,
        label: "KIES",
        winner: winners.has(c.id),
        colorIndex: c.colorIndex,
      }));
      break;
    }
    case "number": {
      const num = new Map(order.map((c, i) => [c.id, i + 1]));
      reveal = state.circles.map((c) => ({
        circleId: c.id,
        label: String(num.get(c.id)),
        winner: true,
        colorIndex: c.colorIndex,
      }));
      break;
    }
    case "team": {
      // Random, balanced: every round the rarest team takes the next player.
      const t = Math.min(Math.max(Math.round(config.count), 2), n);
      const teamOf = new Map<number, number>();
      const counts = new Array<number>(t).fill(0);
      for (const c of shuffle([...state.circles], rng)) {
        let team = 0;
        for (let i = 1; i < t; i += 1) {
          if (counts[i] < counts[team]) team = i;
        }
        teamOf.set(c.id, team);
        counts[team] += 1;
      }
      reveal = state.circles.map((c) => ({
        circleId: c.id,
        label: String.fromCharCode(65 + (teamOf.get(c.id) as number)),
        winner: true,
        colorIndex: teamOf.get(c.id) as number,
      }));
      break;
    }
  }

  state.reveal = reveal;
  state.phase = "done";
  return reveal;
}
