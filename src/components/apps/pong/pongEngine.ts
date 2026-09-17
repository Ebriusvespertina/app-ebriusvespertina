// Pure, framework-free pong simulation for a two-player (top vs bottom)
// touch game. All geometry and speeds are expressed in field pixels, so the
// exact same engine runs on any screen size; the Vue page derives a config
// from the viewport via makePongConfig(). Gameplay numbers scale with the
// SMALLER field dimension: portrait phones behave exactly like before (width
// is the small side), while testing in a wide desktop window stays sane.
//
// Fairness design — why corner shots can never force a loss:
//  1. Bounce angle is clamped: after any paddle hit the ball leaves at most
//     maxBounceDeg from the vertical, so it can never come back almost flat.
//  2. Horizontal speed is capped at vxSpeedRatio * paddleSpeed (strictly
//     below 1). The ball's x therefore always moves slower than a paddle, so
//     a paddle that reacts immediately can always reach the ball's x before
//     the ball arrives — no shot is physically unreachable.
//  3. Motion is integrated in fixed substeps (config.physicsStep), so the
//     ball can never tunnel through a paddle or wall at high speed and a
//     paddle can never be bypassed by frame-rate luck.
//  4. After any paddle hit the vertical speed stays >= speed * cos(maxBounceDeg),
//     so the ball always makes forward progress — no endless horizontal rallies.
//
// Player 0 is the TOP paddle, player 1 the BOTTOM paddle.

export type PlayerIndex = 0 | 1;
export type Direction = -1 | 0 | 1;

export interface PongConfig {
  fieldW: number;
  fieldH: number;
  paddleWidth: number;
  paddleHeight: number;
  /** max horizontal paddle speed, px/s */
  paddleSpeed: number;
  ballRadius: number;
  baseBallSpeed: number;
  maxBallSpeed: number;
  /** max |angle from vertical| after a paddle hit, degrees */
  maxBounceDeg: number;
  /** |vx| never exceeds this fraction of paddleSpeed */
  vxSpeedRatio: number;
  /** speed added per paddle hit, px/s */
  speedStep: number;
  /** y of the paddle centres */
  topPaddleY: number;
  bottomPaddleY: number;
  /** serve launch angle range from the vertical, degrees */
  minServeDeg: number;
  maxServeDeg: number;
  /** grace period after a point before the receiver's touch can fire the
      serve — stops a still-held finger from instantly re-serving */
  serveCooldownS: number;
  /** fixed integration step; small enough that one step moves less than the paddle height */
  physicsStep: number;
  /** PRNG for serve angles/direction; injectable for tests */
  random: () => number;
}

export interface PongState {
  /** centre x of [top, bottom] paddle */
  paddles: [number, number];
  ball: { x: number; y: number; vx: number; vy: number };
  scores: [number, number];
  /** current ball speed magnitude, px/s */
  speed: number;
  /** last paddle that hit the ball; -1 while serving */
  lastHit: -1 | PlayerIndex;
  /** true while the ball waits to be served: only the receiving player's touch launches it */
  servePending: boolean;
  /** seconds left before the receiver's touch is accepted; 0 at game start,
      set to config.serveCooldownS after each point */
  serveCooldown: number;
  /** vy sign of the pending serve: -1 = toward top, +1 = toward bottom */
  serveDir: -1 | 1;
}

export interface PongInput {
  top: Direction;
  bottom: Direction;
}

export type PongEvent =
  | { type: "score"; scorer: PlayerIndex; x: number; y: number }
  | { type: "hit"; paddle: PlayerIndex }
  | { type: "wall" }
  | { type: "serve" };

/** Base integration step; the config picks the smaller of this and the paddle-tunneling bound. */
export const PHYSICS_DT = 1 / 240;

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export interface PongInsets {
  top: number;
  bottom: number;
}

/**
 * Build a config for a field of the given size. Every gameplay number is a
 * fraction of the smaller field dimension, so small and large phones play
 * identically; only the pixel scales change.
 */
export function makePongConfig(
  fieldW: number,
  fieldH: number,
  insets: PongInsets = { top: 14, bottom: 14 },
  random: () => number = Math.random,
): PongConfig {
  const s = Math.min(fieldW, fieldH);
  const paddleHeight = clamp(fieldH * 0.02, 12, 18);
  const paddleWidth = clamp(s * 0.26, 96, 150);
  const maxBallSpeed = s * 2.6;
  return {
    fieldW,
    fieldH,
    paddleWidth,
    paddleHeight,
    paddleSpeed: s * 2.8,
    ballRadius: clamp(s * 0.022, 5, 9),
    // Deliberately gentle start: the ball speeds up hit by hit (speedStep)
    // up to maxBallSpeed, so rallies build gradually instead of starting hot.
    baseBallSpeed: s * 1.35,
    maxBallSpeed,
    maxBounceDeg: 55,
    vxSpeedRatio: 0.8,
    speedStep: s * 0.04,
    topPaddleY: insets.top + paddleHeight / 2,
    bottomPaddleY: fieldH - insets.bottom - paddleHeight / 2,
    minServeDeg: 8,
    maxServeDeg: 30,
    serveCooldownS: 0.6,
    physicsStep: Math.min(PHYSICS_DT, paddleHeight / (2 * maxBallSpeed)),
    random,
  };
}

export function createPongState(config: PongConfig): PongState {
  return {
    paddles: [config.fieldW / 2, config.fieldW / 2],
    ball: { x: config.fieldW / 2, y: config.fieldH / 2, vx: 0, vy: 0 },
    scores: [0, 0],
    speed: config.baseBallSpeed,
    lastHit: -1,
    servePending: true,
    serveCooldown: 0,
    serveDir: config.random() < 0.5 ? -1 : 1,
  };
}

/**
 * Advance the simulation by `dt` seconds. Mutates `state`, returns the events
 * that happened (for sound/UI feedback). Frame-rate independent: paddles move
 * at config.paddleSpeed regardless of dt, and the ball is integrated in
 * fixed substeps.
 */
export function stepPong(
  state: PongState,
  input: PongInput,
  dt: number,
  config: PongConfig,
): PongEvent[] {
  const events: PongEvent[] = [];
  movePaddles(state, input, dt, config);

  if (state.servePending) {
    // The ball only fires when the player it is headed toward touches the
    // screen: the receiver decides when the rally starts, so nobody is
    // caught off guard by a ball launching at them. A short cooldown after
    // each point stops a still-held finger from instantly re-serving.
    state.serveCooldown = Math.max(0, state.serveCooldown - dt);
    const receiver: PlayerIndex = state.serveDir === -1 ? 0 : 1;
    const receiverInput = receiver === 0 ? input.top : input.bottom;
    if (receiverInput !== 0 && state.serveCooldown <= 0) {
      state.servePending = false;
      launchServe(state, config, events);
    }
    return events;
  }

  let remaining = dt;
  while (remaining > 0) {
    const step = Math.min(remaining, config.physicsStep);
    remaining -= step;
    stepBall(state, step, config, events);
  }
  return events;
}

function movePaddles(
  state: PongState,
  input: PongInput,
  dt: number,
  config: PongConfig,
): void {
  const half = config.paddleWidth / 2;
  state.paddles[0] = clamp(
    state.paddles[0] + input.top * config.paddleSpeed * dt,
    half,
    config.fieldW - half,
  );
  state.paddles[1] = clamp(
    state.paddles[1] + input.bottom * config.paddleSpeed * dt,
    half,
    config.fieldW - half,
  );
}

function stepBall(
  state: PongState,
  dt: number,
  config: PongConfig,
  events: PongEvent[],
): void {
  const b = state.ball;
  const r = config.ballRadius;
  const prevY = b.y;

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // Side walls: clean bounce, never sticks or tunnels.
  if (b.x - r < 0) {
    b.x = r;
    b.vx = Math.abs(b.vx);
    events.push({ type: "wall" });
  } else if (b.x + r > config.fieldW) {
    b.x = config.fieldW - r;
    b.vx = -Math.abs(b.vx);
    events.push({ type: "wall" });
  }

  // Top paddle (player 0): its face is its bottom edge. Only bounce when the
  // ball approached from the field side (prevY test) and actually crossed the
  // face this substep — this prevents phantom bounces off the paddle's back
  // when the ball is in the gap between paddle and field edge.
  if (b.vy < 0) {
    const face = config.topPaddleY + config.paddleHeight / 2;
    if (
      prevY - r > face &&
      b.y - r <= face &&
      Math.abs(b.x - state.paddles[0]) <= config.paddleWidth / 2 + r
    ) {
      b.y = face + r;
      bounceOffPaddle(state, 0, config, events);
    }
  }

  // Bottom paddle (player 1): its face is its top edge.
  if (b.vy > 0) {
    const face = config.bottomPaddleY - config.paddleHeight / 2;
    if (
      prevY + r < face &&
      b.y + r >= face &&
      Math.abs(b.x - state.paddles[1]) <= config.paddleWidth / 2 + r
    ) {
      b.y = face - r;
      bounceOffPaddle(state, 1, config, events);
    }
  }

  // Scoring: ball fully past a field edge. Report where the ball crossed so
  // the UI can celebrate at the goal mouth.
  if (b.y + r < 0) {
    onScore(state, 1, b.x, b.y, config, events); // bottom player scores
  } else if (b.y - r > config.fieldH) {
    onScore(state, 0, b.x, b.y, config, events); // top player scores
  }
}

function bounceOffPaddle(
  state: PongState,
  paddle: PlayerIndex,
  config: PongConfig,
  events: PongEvent[],
): void {
  const newSpeed = Math.min(state.speed + config.speedStep, config.maxBallSpeed);
  state.speed = newSpeed;

  // Bounce angle scales with impact point: center = straight, edge = steep.
  const impact = clamp(
    (state.ball.x - state.paddles[paddle]) / (config.paddleWidth / 2),
    -1,
    1,
  );
  const maxRad = (config.maxBounceDeg * Math.PI) / 180;
  const angle = impact * maxRad;
  // Top paddle sends the ball down, bottom paddle sends it up.
  const dir = paddle === 0 ? 1 : -1;

  let vx = newSpeed * Math.sin(angle);
  let vy = dir * newSpeed * Math.cos(angle);

  // Fairness cap: |vx| may never outrun the paddle. When it binds, keep the
  // speed magnitude exact by recomputing vy.
  const vxCap = config.vxSpeedRatio * config.paddleSpeed;
  if (Math.abs(vx) > vxCap) {
    vx = Math.sign(vx) * vxCap;
    vy = dir * Math.sqrt(Math.max(newSpeed * newSpeed - vx * vx, 0));
  }

  state.ball.vx = vx;
  state.ball.vy = vy;
  state.lastHit = paddle;
  events.push({ type: "hit", paddle });
}

function onScore(
  state: PongState,
  scorer: PlayerIndex,
  x: number,
  y: number,
  config: PongConfig,
  events: PongEvent[],
): void {
  state.scores[scorer] += 1;
  state.ball.x = config.fieldW / 2;
  state.ball.y = config.fieldH / 2;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.speed = config.baseBallSpeed;
  state.lastHit = -1;
  state.servePending = true;
  state.serveCooldown = config.serveCooldownS;
  // The player who conceded the point receives the next serve.
  state.serveDir = scorer === 0 ? 1 : -1;
  events.push({ type: "score", scorer, x, y });
}

function launchServe(
  state: PongState,
  config: PongConfig,
  events: PongEvent[],
): void {
  const side = config.random() < 0.5 ? -1 : 1;
  const deg = config.minServeDeg + config.random() * (config.maxServeDeg - config.minServeDeg);
  const rad = (deg * Math.PI) / 180;
  state.ball.x = config.fieldW / 2;
  state.ball.y = config.fieldH / 2;
  state.ball.vx = side * state.speed * Math.sin(rad);
  state.ball.vy = state.serveDir * state.speed * Math.cos(rad);
  state.lastHit = -1;
  events.push({ type: "serve" });
}
