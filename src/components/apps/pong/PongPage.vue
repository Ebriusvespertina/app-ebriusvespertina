<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { clamp, createPongState, makePongConfig, stepPong } from "./pongEngine";
import type { Direction, PlayerIndex, PongConfig, PongInput, PongState } from "./pongEngine";

const TOP_COLOR = "#38bdf8";
const BOTTOM_COLOR = "#f472b6";

const shellRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const started = ref(false);
const scores = ref<[number, number]>([0, 0]);
const serveCue = ref(false);
const serveDown = ref(false);
/** null = infinite (never ends); 3/5 = first player to that many points wins. */
const winTarget = ref<number | null>(loadWinTarget());
/** null = no winner yet; 0/1 = that player won the match. */
const winner = ref<PlayerIndex | null>(null);
const muted = ref(loadMuted());

let config: PongConfig | null = null;
let state: PongState | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastTime = 0;
/** true while the current history entry is our in-game state (see onPopState) */
let inGameHistory = false;
let trail: { x: number; y: number }[] = [];

interface Particle {
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

let particles: Particle[] = [];
let shakeT = 0;
let flashT = 0;
let flashColor = "";
let hitFlash: [number, number] = [0, 0];
let rings: { x: number; y: number; t: number; max: number; color: string }[] = [];

const input: PongInput = { top: 0, bottom: 0 };
const activePointers = new Map<number, { topHalf: boolean; dir: Direction }>();
const heldKeys = new Set<string>();

// ---- audio (WebAudio, created on the first user gesture) ----
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        audioCtx = new Ctor();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = muted.value ? 0 : 1;
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
    masterGain = null;
  }
}

function beep(
  freq: number,
  dur = 0.06,
  volume = 0.4,
  type: OscillatorType = "square",
  delay = 0,
): void {
  if (!audioCtx || !masterGain) return;
  try {
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + dur);
  } catch {
    /* audio is best-effort */
  }
}

function soundHit(): void {
  beep(560, 0.05, 0.4);
}
function soundWall(): void {
  beep(320, 0.04, 0.28);
}
function soundScore(): void {
  beep(262, 0.12, 0.45);
  beep(392, 0.1, 0.45);
  beep(523, 0.14, 0.42);
}
function soundServe(): void {
  beep(220, 0.05, 0.22);
}
function soundWin(): void {
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < notes.length; i += 1) {
    beep(notes[i], 0.18, 0.5, "square", i * 0.11);
  }
}

// ---- preferences (persisted so the next match starts with the last choice) ----
function loadWinTarget(): number | null {
  try {
    const v = window.localStorage.getItem("pong-win-target");
    if (v === "3" || v === "5") return Number(v);
  } catch {
    /* storage unavailable */
  }
  return null; // default: infinite
}

function loadMuted(): boolean {
  try {
    return window.localStorage.getItem("pong-muted") === "1";
  } catch {
    /* storage unavailable */
  }
  return false;
}

function setWinTarget(value: number | null): void {
  winTarget.value = value;
  try {
    if (value === null) window.localStorage.removeItem("pong-win-target");
    else window.localStorage.setItem("pong-win-target", String(value));
  } catch {
    /* storage unavailable */
  }
}

function toggleMute(): void {
  muted.value = !muted.value;
  try {
    window.localStorage.setItem("pong-muted", muted.value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  if (masterGain) masterGain.gain.value = muted.value ? 0 : 1;
}

// ---- layout ----
function safeInset(prop: string): number {
  const el = shellRef.value;
  if (!el) return 0;
  const n = Number.parseFloat(getComputedStyle(el).getPropertyValue(prop));
  return Number.isFinite(n) ? n : 0;
}

function applyLayout(): void {
  const shell = shellRef.value;
  const canvas = canvasRef.value;
  if (!shell || !canvas || !ctx) return;
  const rect = shell.getBoundingClientRect();
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const prev = state;
  config = makePongConfig(w, h, {
    top: safeInset("--sat") + 12,
    bottom: safeInset("--sab") + 12,
  });
  // Mid-game resize (e.g. rotation): keep the score, re-serve the ball.
  if (prev) {
    state = createPongState(config);
    state.scores = [prev.scores[0], prev.scores[1]];
    scores.value = [prev.scores[0], prev.scores[1]];
  }
  draw();
}

// ---- input ----
function zoneOf(e: PointerEvent): { topHalf: boolean; dir: Direction } | null {
  const shell = shellRef.value;
  if (!shell) return null;
  const rect = shell.getBoundingClientRect();
  return {
    topHalf: e.clientY - rect.top < rect.height / 2,
    dir: e.clientX - rect.left < rect.width / 2 ? -1 : 1,
  };
}

function recomputeInput(): void {
  let top = heldKeys.has("KeyA") ? -1 : heldKeys.has("KeyD") ? 1 : 0;
  let bottom = heldKeys.has("ArrowLeft") ? -1 : heldKeys.has("ArrowRight") ? 1 : 0;
  for (const p of activePointers.values()) {
    if (p.topHalf) top += p.dir;
    else bottom += p.dir;
  }
  input.top = clamp(top, -1, 1) as Direction;
  input.bottom = clamp(bottom, -1, 1) as Direction;
}

function onPointerDown(e: PointerEvent): void {
  if (winner.value !== null) return;
  if (!started.value) {
    startGame();
    return;
  }
  const zone = zoneOf(e);
  if (!zone) return;
  activePointers.set(e.pointerId, zone);
  recomputeInput();
}

function onPointerMove(e: PointerEvent): void {
  if (!activePointers.has(e.pointerId)) return;
  const zone = zoneOf(e);
  if (!zone) return;
  activePointers.set(e.pointerId, zone);
  recomputeInput();
}

function onPointerUp(e: PointerEvent): void {
  if (activePointers.delete(e.pointerId)) recomputeInput();
}

function onKeyDown(e: KeyboardEvent): void {
  if (winner.value !== null) return;
  if (!started.value && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    startGame();
    return;
  }
  if (e.repeat) return;
  if (!heldKeys.has(e.code)) {
    heldKeys.add(e.code);
    recomputeInput();
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (heldKeys.delete(e.code)) recomputeInput();
}

// ---- game lifecycle ----
function requestWakeLock(): void {
  try {
    void navigator.wakeLock?.request("screen").catch(() => {});
  } catch {
    /* unsupported */
  }
}

function startGame(): void {
  if (started.value || !config) return;
  started.value = true;
  winner.value = null;
  state = createPongState(config);
  scores.value = [0, 0];
  trail = [];
  activePointers.clear();
  heldKeys.clear();
  input.top = 0;
  input.bottom = 0;
  serveCue.value = true;
  serveDown.value = state.serveDir === 1;
  ensureAudio();
  requestWakeLock();
  lastTime = performance.now();
  if (!inGameHistory) {
    try {
      history.pushState({ pong: "playing" }, "");
      inGameHistory = true;
    } catch {
      inGameHistory = false;
    }
  }
}

function backToMenu(): void {
  winner.value = null;
  started.value = false;
  scores.value = [0, 0];
  trail = [];
  activePointers.clear();
  heldKeys.clear();
  input.top = 0;
  input.bottom = 0;
}

/** Back while in-game: return to the pong main menu instead of leaving the app.
    The menu entry replaces the popped one, so one more back goes to the hub. */
function onPopState(): void {
  if (started.value || winner.value !== null) {
    backToMenu();
    inGameHistory = false;
    try {
      history.replaceState({ pong: "menu" }, "");
    } catch {
      /* history best-effort */
    }
  }
}

// ---- render ----
function fillRoundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  c.beginPath();
  if (typeof c.roundRect === "function") {
    c.roundRect(x, y, w, h, r);
  } else {
    c.rect(x, y, w, h);
  }
  c.fill();
}

function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vx *= 1 - 1.6 * dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

/** Confetti-style burst where the ball broke through the scoring line. */
function spawnScoreBurst(x: number, y: number, color: string): void {
  const fromTop = y <= 0; // particles rain down into the field from the top edge
  for (let i = 0; i < 72; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 340;
    const life = 0.7 + Math.random() * 0.55;
    particles.push({
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

/** Small contact spark for paddle and wall bounces. */
function spawnHitSpark(x: number, y: number, color: string): void {
  for (let i = 0; i < 12; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 170;
    const life = 0.22 + Math.random() * 0.2;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed * 0.8,
      gravity: 120,
      life,
      maxLife: life,
      size: 1.5 + Math.random() * 2,
      color: Math.random() < 0.4 ? "#ffffff" : color,
    });
  }
}

function drawPaddle(player: 0 | 1, color: string): void {
  if (!ctx || !config || !state) return;
  const cfg = config;
  const x = state.paddles[player] - cfg.paddleWidth / 2;
  const y =
    player === 0
      ? cfg.topPaddleY - cfg.paddleHeight / 2
      : cfg.bottomPaddleY - cfg.paddleHeight / 2;
  const pulse = hitFlash[player] > 0 ? 1 + 0.16 * (hitFlash[player] / 0.14) : 1;
  ctx.save();
  ctx.translate(x + cfg.paddleWidth / 2, y + cfg.paddleHeight / 2);
  ctx.scale(1, pulse);
  ctx.fillStyle = color;
  fillRoundRect(ctx, -cfg.paddleWidth / 2, -cfg.paddleHeight / 2, cfg.paddleWidth, cfg.paddleHeight, Math.min(cfg.paddleHeight / 2, 6));
  if (pulse > 1) {
    ctx.globalAlpha = 0.35 * ((pulse - 1) / 0.16);
    ctx.fillStyle = "#ffffff";
    fillRoundRect(ctx, -cfg.paddleWidth / 2, -cfg.paddleHeight / 2, cfg.paddleWidth, cfg.paddleHeight, Math.min(cfg.paddleHeight / 2, 6));
  }
  ctx.restore();
}

function draw(): void {
  if (!ctx || !config || !state) return;
  const cfg = config;
  const c = ctx;
  // Oversized clear so the screen-shake translate never leaves stale edges.
  c.clearRect(-16, -16, cfg.fieldW + 32, cfg.fieldH + 32);
  c.save();
  if (shakeT > 0) {
    const amp = 7 * (shakeT / 0.28);
    c.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
  }

  // Spacious dotted centreline: the score sits on it, the line segment
  // between the two numbers is the separator.
  c.strokeStyle = "rgba(148, 163, 184, 0.28)";
  c.lineWidth = 3;
  c.lineCap = "round";
  c.setLineDash([14, 26]);
  c.beginPath();
  c.moveTo(0, cfg.fieldH / 2);
  c.lineTo(cfg.fieldW, cfg.fieldH / 2);
  c.stroke();
  c.setLineDash([]);

  // Ball trail.
  for (let i = 0; i < trail.length; i += 1) {
    const t = trail[i];
    const k = (i + 1) / trail.length;
    c.globalAlpha = 0.05 + 0.12 * k;
    c.fillStyle = "#e2e8f0";
    c.beginPath();
    c.arc(t.x, t.y, cfg.ballRadius * (0.35 + 0.65 * k), 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  // Ball.
  c.fillStyle = "#f8fafc";
  c.beginPath();
  c.arc(state.ball.x, state.ball.y, cfg.ballRadius, 0, Math.PI * 2);
  c.fill();

  drawPaddle(0, TOP_COLOR);
  drawPaddle(1, BOTTOM_COLOR);

  // Contact rings (paddle hits).
  for (const r of rings) {
    const k = r.t / r.max;
    c.globalAlpha = 0.55 * (1 - k);
    c.strokeStyle = r.color;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(r.x, r.y, 5 + 30 * (1 - k), 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;

  // Particles: additive so overlapping sparks glow.
  c.globalCompositeOperation = "lighter";
  for (const p of particles) {
    const k = p.life / p.maxLife;
    c.globalAlpha = 0.85 * k;
    c.fillStyle = p.color;
    c.beginPath();
    c.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.restore();

  // Full-field colour flash on score.
  if (flashT > 0) {
    c.globalAlpha = (flashT / 0.35) * 0.14;
    c.fillStyle = flashColor;
    c.fillRect(0, 0, cfg.fieldW, cfg.fieldH);
    c.globalAlpha = 1;
  }
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  if (!started.value || winner.value !== null || !state || !config) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (dt <= 0) return;
  shakeT = Math.max(0, shakeT - dt);
  flashT = Math.max(0, flashT - dt);
  hitFlash[0] = Math.max(0, hitFlash[0] - dt);
  hitFlash[1] = Math.max(0, hitFlash[1] - dt);
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    rings[i].t -= dt;
    if (rings[i].t <= 0) rings.splice(i, 1);
  }
  updateParticles(dt);
  const events = stepPong(state, input, dt, config);
  for (const ev of events) {
    if (ev.type === "score") {
      scores.value = [state.scores[0], state.scores[1]];
      trail = [];
      serveCue.value = true;
      serveDown.value = state.serveDir === 1;
      const concededColor = ev.scorer === 0 ? BOTTOM_COLOR : TOP_COLOR;
      spawnScoreBurst(ev.x, ev.y, concededColor);
      shakeT = 0.28;
      flashT = 0.35;
      flashColor = ev.scorer === 0 ? TOP_COLOR : BOTTOM_COLOR;
      soundScore();
      try {
        navigator.vibrate?.(60);
      } catch {
        /* haptics are best-effort */
      }
      const target = winTarget.value;
      if (target !== null && state.scores[ev.scorer] >= target) {
        winner.value = ev.scorer;
        started.value = false;
        spawnScoreBurst(
          config.fieldW / 2,
          config.fieldH / 2,
          ev.scorer === 0 ? TOP_COLOR : BOTTOM_COLOR,
        );
        shakeT = 0.5;
        flashT = 0.6;
        soundWin();
        try {
          navigator.vibrate?.([140, 70, 220]);
        } catch {
          /* haptics are best-effort */
        }
      }
    } else if (ev.type === "hit") {
      soundHit();
      const faceY =
        ev.paddle === 0
          ? config.topPaddleY + config.paddleHeight / 2
          : config.bottomPaddleY - config.paddleHeight / 2;
      const color = ev.paddle === 0 ? TOP_COLOR : BOTTOM_COLOR;
      spawnHitSpark(state.ball.x, faceY, color);
      rings.push({ x: state.ball.x, y: faceY, t: 0.3, max: 0.3, color });
      hitFlash[ev.paddle] = 0.14;
    } else if (ev.type === "wall") {
      soundWall();
      spawnHitSpark(
        state.ball.x,
        clamp(state.ball.y, 0, config.fieldH),
        "#94a3b8",
      );
    } else if (ev.type === "serve") {
      trail = [];
      serveCue.value = false;
      soundServe();
    }
  }
  if (state.servePending) serveDown.value = state.serveDir === 1;
  if (!state.servePending) {
    trail.push({ x: state.ball.x, y: state.ball.y });
    if (trail.length > 10) trail.shift();
  }
  draw();
}

function onVisibility(): void {
  if (document.visibilityState === "visible" && started.value) {
    lastTime = performance.now();
    requestWakeLock();
  }
}

function onResize(): void {
  applyLayout();
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) ctx = canvas.getContext("2d");
  applyLayout();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("popstate", onPopState);
  document.addEventListener("visibilitychange", onVisibility);
  rafId = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <div
    ref="shellRef"
    class="game-shell"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @contextmenu.prevent
  >
    <canvas ref="canvasRef" class="game-canvas" aria-hidden="true"></canvas>

    <div v-if="started" class="score" aria-hidden="true">
      <span :key="`top-${scores[0]}`" class="score-num top">{{ scores[0] }}</span>
      <span :key="`bottom-${scores[1]}`" class="score-num bottom">{{ scores[1] }}</span>
    </div>

    <p
      v-if="started && serveCue"
      class="serve-cue"
      :class="serveDown ? 'down' : 'up'"
      aria-hidden="true"
    >
      Tik om te serveren
    </p>

    <div v-if="started" class="zone-hints" aria-hidden="true">
      <span class="hint hint-tl">‹</span>
      <span class="hint hint-tr">›</span>
      <span class="hint hint-bl">‹</span>
      <span class="hint hint-br">›</span>
    </div>

    <div v-if="!started && winner === null" class="start-overlay" @pointerdown="startGame">
      <h1 class="start-title">PONG</h1>
      <div class="win-options" role="radiogroup" aria-label="Winvoorwaarde">
        <button
          type="button"
          class="win-opt"
          :class="{ active: winTarget === 3 }"
          :aria-pressed="winTarget === 3"
          @pointerdown.stop="setWinTarget(3)"
        >
          <svg class="win-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="2.5" fill="currentColor" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <circle cx="19" cy="12" r="2.5" fill="currentColor" />
          </svg>
          <span>Best of 3</span>
        </button>
        <button
          type="button"
          class="win-opt"
          :class="{ active: winTarget === 5 }"
          :aria-pressed="winTarget === 5"
          @pointerdown.stop="setWinTarget(5)"
        >
          <svg class="win-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="4" cy="12" r="1.8" fill="currentColor" />
            <circle cx="8" cy="12" r="1.8" fill="currentColor" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <circle cx="16" cy="12" r="1.8" fill="currentColor" />
            <circle cx="20" cy="12" r="1.8" fill="currentColor" />
          </svg>
          <span>Best of 5</span>
        </button>
        <button
          type="button"
          class="win-opt"
          :class="{ active: winTarget === null }"
          :aria-pressed="winTarget === null"
          @pointerdown.stop="setWinTarget(null)"
        >
          <svg
            class="win-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 12c-2-2.67-3.41-4-5.5-4A3.5 3.5 0 0 0 3 11.5c0 2.25 1.5 3.5 3 3.5 2.33 0 3.93-1.33 6-4.5 2.07 3.17 3.67 4.5 6 4.5 1.5 0 3-1.25 3-3.5A3.5 3.5 0 0 0 17.5 8c-2.09 0-3.5 1.33-5.5 4z" />
          </svg>
          <span>Eindeloos</span>
        </button>
      </div>
      <button type="button" class="start-cta" @pointerdown.stop="startGame">Tik om te starten</button>
      <button
        type="button"
        class="mute-btn"
        :class="{ muted }"
        :aria-label="muted ? 'Geluid aan' : 'Geluid uit'"
        @pointerdown.stop="toggleMute"
      >
        <svg
          v-if="!muted"
          class="mute-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z" fill="currentColor" stroke="none" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
        </svg>
        <svg
          v-else
          class="mute-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z" fill="currentColor" stroke="none" />
          <path d="M16 9l6 6" />
          <path d="M22 9l-6 6" />
        </svg>
      </button>
    </div>

    <div v-if="winner !== null" class="winner-overlay">
      <div class="winner-glow" :class="winner === 0 ? 'top' : 'bottom'" aria-hidden="true"></div>
      <p class="winner-line" :class="winner === 0 ? 'top' : 'bottom'">
        {{ winner === 0 ? 'BOVEN' : 'ONDER' }}
      </p>
      <h2 class="winner-title">WINT!</h2>
      <p class="final-score" aria-hidden="true">{{ scores[0] }} – {{ scores[1] }}</p>
      <div class="winner-actions">
        <button type="button" class="winner-btn primary" @pointerdown.stop="startGame">Opnieuw</button>
        <button type="button" class="winner-btn" @pointerdown.stop="backToMenu">Menu</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-shell {
  position: fixed;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  overscroll-behavior: none;
  background: transparent;
  --sat: env(safe-area-inset-top, 0px);
  --sab: env(safe-area-inset-bottom, 0px);
}

.game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.score {
  /* Both numbers hug the field's vertical middle: the dotted centreline runs
     between them, one number per player's half. */
  position: absolute;
  left: calc(14px + env(safe-area-inset-left, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  pointer-events: none;
  z-index: 5;
}

.score-num {
  font-size: clamp(1.75rem, 6.5vh, 3rem);
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  /* Both numbers share one rotation (tops toward the left edge): each player
     tilts their head toward that edge and reads the whole score, sky on top,
     pink below. */
  transform: rotate(-90deg);
  text-shadow: 0 2px 8px rgba(2, 6, 23, 0.6);
  --pop-glow: rgba(148, 163, 184, 0.8);
  animation: score-pop 0.3s ease;
}

.score-num.top {
  color: #38bdf8;
  --pop-glow: rgba(56, 189, 248, 0.9);
}

.score-num.bottom {
  color: #f472b6;
  --pop-glow: rgba(244, 114, 182, 0.9);
}

@keyframes score-pop {
  0% {
    scale: 1.9;
    text-shadow: 0 0 24px var(--pop-glow), 0 2px 8px rgba(2, 6, 23, 0.6);
  }
  35% {
    scale: 0.92;
  }
  100% {
    scale: 1;
  }
}

.serve-cue {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.45rem 1.1rem;
  border-radius: 999px;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #e2e8f0;
  background: rgba(2, 6, 23, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.25);
  pointer-events: none;
  z-index: 6;
  animation: cue-pulse 1.4s ease-in-out infinite;
}

.serve-cue.down {
  top: 64%;
}

.serve-cue.up {
  top: 32%;
}

@keyframes cue-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.zone-hints {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}

.hint {
  position: absolute;
  font-size: clamp(2rem, 8vh, 3.5rem);
  font-weight: 700;
  animation: hint-fade 6.5s ease forwards;
}

.hint-tl,
.hint-tr {
  top: 24%;
  color: rgba(56, 189, 248, 0.45);
}

.hint-bl,
.hint-br {
  bottom: 24%;
  color: rgba(244, 114, 182, 0.45);
}

.hint-tl,
.hint-bl {
  left: 13%;
}

.hint-tr,
.hint-br {
  right: 13%;
}

@keyframes hint-fade {
  0%,
  55% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

.start-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  padding: 2rem;
  text-align: center;
  background: rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  touch-action: none;
}

.start-title {
  margin: 0;
  font-size: clamp(3rem, 14vh, 6rem);
  font-weight: 900;
  letter-spacing: 0.35em;
  /* letter-spacing adds trailing space after the last glyph; pad the left to
     keep the word visually centred */
  padding-left: 0.35em;
  background: linear-gradient(180deg, #38bdf8, #f472b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.win-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.55rem;
  margin-top: 0.6rem;
}

.win-opt {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.65rem 0.8rem;
  border-radius: 999px;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  touch-action: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.win-opt.active {
  color: #f8fafc;
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.65);
  box-shadow: 0 0 18px rgba(56, 189, 248, 0.25);
}

.win-icon {
  width: 2.2rem;
  height: 2.2rem;
  flex: none;
}

.mute-btn {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top, 0px));
  right: calc(14px + env(safe-area-inset-right, 0px));
  width: 3rem;
  height: 3rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  touch-action: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.mute-btn.muted {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.55);
}

.mute-icon {
  width: 1.5rem;
  height: 1.5rem;
}

.start-cta {
  margin-top: 1.25rem;
  font: inherit;
  font-weight: 700;
  color: #f8fafc;
  padding: 0.9rem 2.2rem;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.16);
  border: 1px solid rgba(56, 189, 248, 0.4);
  cursor: pointer;
  touch-action: none;
  animation: cta-pulse 1.6s ease-in-out infinite;
}

.winner-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  touch-action: none;
  animation: win-in 0.4s ease;
}

.winner-glow {
  position: absolute;
  left: 0;
  right: 0;
  height: 60%;
  z-index: 0;
  pointer-events: none;
  animation: glow-pulse 1.5s ease-in-out infinite;
}

.winner-glow.top {
  top: 0;
  background: radial-gradient(
    ellipse 85% 75% at 50% 5%,
    rgba(56, 189, 248, 0.55),
    rgba(56, 189, 248, 0.2) 55%,
    transparent 80%
  );
}

.winner-glow.bottom {
  bottom: 0;
  background: radial-gradient(
    ellipse 85% 75% at 50% 95%,
    rgba(244, 114, 182, 0.55),
    rgba(244, 114, 182, 0.2) 55%,
    transparent 80%
  );
}

@keyframes glow-pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}

.winner-line,
.winner-title,
.final-score,
.winner-actions {
  position: relative;
  z-index: 1;
}

.winner-line {
  margin: 0;
  font-size: clamp(2.2rem, 9vh, 4rem);
  font-weight: 900;
  letter-spacing: 0.22em;
  padding-left: 0.22em;
}

.winner-line.top {
  color: #38bdf8;
  text-shadow: 0 0 30px rgba(56, 189, 248, 0.55);
}

.winner-line.bottom {
  color: #f472b6;
  text-shadow: 0 0 30px rgba(244, 114, 182, 0.55);
}

.winner-title {
  margin: 0;
  font-size: clamp(3rem, 13vh, 5.5rem);
  font-weight: 900;
  letter-spacing: 0.14em;
  padding-left: 0.14em;
  color: #f8fafc;
}

.final-score {
  margin: 0.6rem 0 1.4rem;
  font-size: clamp(1.6rem, 6vh, 2.6rem);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
}

.winner-actions {
  display: flex;
  gap: 0.7rem;
}

.winner-btn {
  font: inherit;
  font-weight: 700;
  font-size: 0.95rem;
  color: #e2e8f0;
  padding: 0.8rem 1.8rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  touch-action: none;
}

.winner-btn.primary {
  color: #f8fafc;
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.6);
}

@keyframes win-in {
  from {
    opacity: 0;
    transform: scale(1.06);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes cta-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
