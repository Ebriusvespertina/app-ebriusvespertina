<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  createSchwaziState,
  makeSchwaziConfig,
  resetSchwazi,
  syncFingers,
} from "./schwaziEngine";
import type {
  Circle,
  SchwaziConfig,
  SchwaziMode,
  SchwaziState,
} from "./schwaziEngine";

// Vivid identity palette; hues are far apart so nearby fingers never read as
// the same colour. Team mode recolours circles from a separate palette.
const IDENTITY = ["#ff3b6b", "#38bdf8", "#4ade80", "#fbbf24", "#a78bfa", "#22d3ee", "#fb7185", "#f8fafc"];
const TEAM = ["#f87171", "#60a5fa", "#4ade80", "#facc15", "#e879f9"];

const MODES: { value: SchwaziMode; label: string; hint: string }[] = [
  { value: "selector", label: "Selector", hint: "Kiest 1 persoon" },
  { value: "multi", label: "Multi", hint: "Kiest N personen" },
  { value: "number", label: "Number", hint: "Geeft iedereen een nummer" },
  { value: "team", label: "Team", hint: "Verdeelt in teams" },
];

const STABILITY = 2;
const MIN_PLAYERS = 2;
const LERP_RATE = 14;
/** reveal flood duration for the selector mode */
const FLOOD_MS = 900;

const shellRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const started = ref(false);
/** reactive UI phase; the engine state itself is non-reactive */
const phase = ref<"menu" | "holding" | "done">("menu");
const mode = ref<SchwaziMode>(loadPref("schwazi-mode", "selector") as SchwaziMode);
const count = ref<number>(loadCount());

const config = computed<SchwaziConfig>(() =>
  makeSchwaziConfig({ mode: mode.value, count: count.value, stabilityTime: STABILITY, minPlayers: MIN_PLAYERS, lerpRate: LERP_RATE }),
);

let state: SchwaziState | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastTime = 0;
let time = 0;
let viewW = 0;
let viewH = 0;
/** true while the current history entry is our in-game state (see onPopState) */
let inGameHistory = false;

/** raw touchpoints, keyed by pointerId (stable per finger) */
const fingers = new Map<number, { x: number; y: number }>();
/** when each circle was born, for the spawn pop */
const bornAt = new Map<number, number>();
/** seconds since the pick (drives the reveal animation) */
let revealT = -1;

let audioCtx: AudioContext | null = null;

function ensureAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) audioCtx = new Ctor();
    }
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function beep(freq: number, dur = 0.08, volume = 0.15, type: OscillatorType = "triangle", delay = 0): void {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
  } catch {
    /* audio is best-effort */
  }
}

/** Soft pop when a finger joins. */
function soundJoin(): void {
  beep(320, 0.05, 0.07, "sine");
}
/** Rising chime when a pick lands. */
function soundPick(): void {
  beep(523, 0.12, 0.16, "triangle");
  beep(784, 0.14, 0.14, "triangle", 0.08);
}

// ---- preferences ----
function loadPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadCount(): number {
  const v = Number(loadPref("schwazi-count", "3"));
  return v >= 2 && v <= 5 ? v : 3;
}

function setMode(value: SchwaziMode): void {
  mode.value = value;
  try {
    window.localStorage.setItem("schwazi-mode", value);
  } catch {
    /* storage unavailable */
  }
}

function setCount(delta: number): void {
  const next = Math.min(5, Math.max(2, count.value + delta));
  count.value = next;
  try {
    window.localStorage.setItem("schwazi-count", String(next));
  } catch {
    /* storage unavailable */
  }
}

function requestWakeLock(): void {
  try {
    void navigator.wakeLock?.request("screen").catch(() => {});
  } catch {
    /* unsupported */
  }
}

// ---- layout ----
function applyLayout(): void {
  const shell = shellRef.value;
  const canvas = canvasRef.value;
  if (!shell || !canvas || !ctx) return;
  const rect = shell.getBoundingClientRect();
  viewW = Math.max(rect.width, 1);
  viewH = Math.max(rect.height, 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(viewW * dpr);
  const bh = Math.round(viewH * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---- input ----
function onPointerDown(e: PointerEvent): void {
  if (!started.value) {
    startGame();
    return;
  }
  if (phase.value === "done" || !state) return;
  const shell = shellRef.value;
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  fingers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
}

function onPointerMove(e: PointerEvent): void {
  const p = fingers.get(e.pointerId);
  if (!p) return;
  const shell = shellRef.value;
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  p.x = e.clientX - rect.left;
  p.y = e.clientY - rect.top;
}

function onPointerUp(e: PointerEvent): void {
  fingers.delete(e.pointerId);
  // After a reveal, everyone lifting their finger starts a fresh round.
  if (phase.value === "done" && fingers.size === 0) {
    resetToHolding();
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (!started.value && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    startGame();
    return;
  }
  if (started.value && phase.value === "done" && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    resetToHolding();
  }
}

// ---- game lifecycle ----
function startGame(): void {
  if (started.value) return;
  started.value = true;
  phase.value = "holding";
  state = createSchwaziState();
  fingers.clear();
  bornAt.clear();
  revealT = -1;
  ensureAudio();
  requestWakeLock();
  lastTime = performance.now();
  if (!inGameHistory) {
    try {
      history.pushState({ schwazi: "playing" }, "");
      inGameHistory = true;
    } catch {
      inGameHistory = false;
    }
  }
}

function resetToHolding(): void {
  if (!state) return;
  phase.value = "holding";
  resetSchwazi(state);
  fingers.clear();
  bornAt.clear();
  revealT = -1;
}

function backToMenu(): void {
  started.value = false;
  phase.value = "menu";
  state = null;
  fingers.clear();
  bornAt.clear();
  revealT = -1;
}

/** Back while in-game: return to the schwazi menu instead of leaving the app. */
function onPopState(): void {
  if (started.value) {
    backToMenu();
    inGameHistory = false;
    try {
      history.replaceState({ schwazi: "menu" }, "");
    } catch {
      /* history best-effort */
    }
  }
}

// ---- render helpers ----
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeOutQuint(t: number): number {
  return 1 + --t * t * t * t * t;
}

function circleRadius(): number {
  return clamp(Math.min(viewW, viewH) * 0.095, 34, 58);
}

function circleColor(c: Circle): string {
  return IDENTITY[c.colorIndex % IDENTITY.length];
}

/** A holding circle: gradient fill, glow, pulsing + rotating rings, an
 * orbiting spark, and the stability progress arc around it. */
function drawOrb(c: Circle, stableFrac: number, withGlow = true): void {
  if (!ctx) return;
  const color = circleColor(c);
  const r = circleRadius();
  const phase = c.colorIndex * 1.7;
  const born = bornAt.get(c.id) ?? time;
  const t = clamp((time - born) / 0.25, 0, 1);
  const scale = 0.4 + 0.6 * easeOutQuint(t);
  const pulse = 1 + 0.05 * Math.sin(time * 4 + phase);
  const R = r * scale * pulse;

  const g = ctx.createRadialGradient(c.x - R * 0.35, c.y - R * 0.35, R * 0.12, c.x, c.y, R);
  g.addColorStop(0, "rgba(255,255,255,0.42)");
  g.addColorStop(0.55, color);
  g.addColorStop(1, color);
  ctx.save();
  if (withGlow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Pulsing white ring.
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, R + 8 + 3 * Math.sin(time * 4 + phase), 0, Math.PI * 2);
  ctx.stroke();

  // Rotating dashed ring.
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([5, 9]);
  ctx.lineDashOffset = -time * 40;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, R + 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Orbiting spark.
  const oa = time * 2.4 + phase;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(c.x + Math.cos(oa) * (R + 17), c.y + Math.sin(oa) * (R + 17), 2.6, 0, Math.PI * 2);
  ctx.fill();

  // Stability progress arc (same timer for every circle).
  if (stableFrac > 0 && stableFrac < 1) {
    ctx.strokeStyle = "rgba(248,250,252,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, R + 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stableFrac);
    ctx.stroke();
  }
}

function drawCenterText(x: number, y: number, text: string, size: number, color = "#ffffff"): void {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/** Reveal labels: digits (number mode), team letters, "KIES" under winners. */
function drawRevealLabels(): void {
  if (!ctx || !state || !state.reveal) return;
  const r = circleRadius();
  for (const e of state.reveal) {
    const c = state.circles.find((cc) => cc.id === e.circleId);
    if (!c) continue;
    if (e.label && e.label !== "KIES") {
      drawCenterText(c.x, c.y, e.label, Math.round(r * 1.1));
    } else if (e.label === "KIES" && e.winner) {
      drawCenterText(c.x, c.y + r + 34, "KIES", Math.round(Math.min(viewW, viewH) * 0.045), "#ffffff");
    }
  }
}

function drawBottomChips(items: { color: string; label: string }[]): void {
  if (!ctx) return;
  const n = items.length;
  const size = Math.min(viewW * 0.05, 26);
  const gap = size * 1.9;
  const total = n * gap;
  const startX = (viewW - total) / 2 + gap / 2;
  const y = viewH - size * 2.2;
  for (let i = 0; i < n; i += 1) {
    const x = startX + i * gap;
    ctx.fillStyle = items[i].color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.stroke();
    drawCenterText(x, y, items[i].label, size * 0.55);
  }
}

// ---- render ----
function draw(): void {
  if (!ctx || !state) return;
  const w = viewW;
  const h = viewH;
  ctx.clearRect(0, 0, w, h);

  if (state.phase === "holding") {
    const stableFrac = clamp(state.stableTime / config.value.stabilityTime, 0, 1);
    for (const c of state.circles) drawOrb(c, stableFrac);
    return;
  }

  // ---- reveal (phase "done") ----
  const reveal = state.reveal ?? [];
  const t = clamp(revealT / (FLOOD_MS / 1000), 0, 1); // 0..1 over the flood
  const fade = mode.value === "selector" || mode.value === "multi" ? 1 - t : 1;
  const r = circleRadius();

  if (mode.value === "team") {
    for (const e of reveal) {
      const c = state.circles.find((cc) => cc.id === e.circleId);
      if (!c) continue;
      const color = TEAM[e.colorIndex % TEAM.length];
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawRevealLabels();
    drawBottomChips(
      Array.from(new Set(reveal.map((e) => e.colorIndex)))
        .sort((a, b) => a - b)
        .map((i) => ({ color: TEAM[i % TEAM.length], label: String.fromCharCode(65 + i) })),
    );
    return;
  }

  for (const e of reveal) {
    const c = state.circles.find((cc) => cc.id === e.circleId);
    if (!c) continue;
    if (!e.winner && fade <= 0.02) continue;
    // The selector winner is drawn after the flood (glowless) so its glow
    // can't wash out the dark buffer ring inside the cutout.
    if (e.winner && mode.value === "selector") continue;
    ctx.globalAlpha = e.winner ? 1 : clamp(fade, 0, 1);
    drawOrb(c, 0);
    if (e.winner && mode.value === "multi") {
      // Gold winner ring.
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 4;
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r + 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  ctx.globalAlpha = 1;
  drawRevealLabels();

  if (mode.value === "multi") {
    drawBottomChips(
      reveal.filter((e) => e.winner).map((e) => ({ color: circleColorById(e.circleId), label: "KIES" })),
    );
    return;
  }

  // selector: the color flood with a shrinking evenodd hole around the winner.
  const winner = reveal.find((e) => e.winner);
  if (!winner) return;
  const c = state.circles.find((cc) => cc.id === winner.circleId);
  if (!c) return;
  const startValue = Math.max(c.x, w - c.x, c.y, h - c.y);
  const endValue = r + 18; // the dark buffer ring between circle and flood
  const value = startValue - (startValue - endValue) * easeOutQuint(t);
  ctx.fillStyle = circleColor(c);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(c.x, c.y, Math.max(value, 1), 0, Math.PI * 2);
  ctx.fill("evenodd");
  // Redraw the winner orb on top so it sits inside the cutout; glowless so
  // the dark buffer ring between circle and flood stays crisp.
  drawOrb(c, 0, false);
}

function circleColorById(id: number): string {
  const c = state?.circles.find((cc) => cc.id === id);
  return c ? circleColor(c) : "#ffffff";
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  if (!started.value || !state) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (dt <= 0) return;
  time += dt;

  if (state.phase === "holding") {
    const evs = syncFingers(
      state,
      Array.from(fingers.entries()).map(([id, p]) => ({ id, x: p.x, y: p.y })),
      dt,
      config.value,
    );
    for (const ev of evs) {
      if (ev.type === "join") {
        bornAt.set(ev.circleId, time);
        soundJoin();
      } else if (ev.type === "pick") {
        revealT = 0;
        phase.value = "done";
        soundPick();
        try {
          navigator.vibrate?.([60, 40, 120]);
        } catch {
          /* haptics are best-effort */
        }
      }
    }
  } else if (state.phase === "done" && revealT >= 0 && revealT < FLOOD_MS / 1000) {
    revealT += dt;
  }
  draw();
}

function onResize(): void {
  applyLayout();
}

function onVisibility(): void {
  if (document.visibilityState === "visible" && started.value) {
    lastTime = performance.now();
    requestWakeLock();
  }
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (canvas) ctx = canvas.getContext("2d");
  applyLayout();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("popstate", onPopState);
  document.addEventListener("visibilitychange", onVisibility);
  // Chrome on Android can fire pointercancel on scroll; block the scroll.
  document.addEventListener("touchmove", preventTouchScroll, { passive: false });
  rafId = requestAnimationFrame(frame);
});

function preventTouchScroll(e: TouchEvent): void {
  e.preventDefault();
}

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("touchmove", preventTouchScroll);
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

    <p v-if="phase === 'holding'" class="hint" aria-hidden="true">
      {{
        fingers.size < 2
          ? "Iedereen: vinger op het scherm"
          : "Niemand meer bewegen…"
      }}
    </p>

    <div v-if="!started" class="start-overlay">
      <h1 class="start-title">SCHWAZI</h1>
      <p class="start-tagline">Iedereen een vinger op het scherm — de app kiest.</p>

      <div class="mode-options" role="radiogroup" aria-label="Modus">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          class="mode-opt"
          :class="{ active: mode === m.value }"
          :aria-pressed="mode === m.value"
          @pointerdown.stop="setMode(m.value)"
        >
          <span class="mode-label">{{ m.label }}</span>
          <span class="mode-hint">{{ m.hint }}</span>
        </button>
      </div>

      <div v-if="mode === 'multi' || mode === 'team'" class="count-row">
        <span class="count-caption">{{ mode === 'multi' ? 'Aantal personen' : 'Aantal teams' }}</span>
        <div class="count-stepper">
          <button type="button" class="count-btn" :disabled="count <= 2" @pointerdown.stop="setCount(-1)">−</button>
          <span class="count-value">{{ count }}</span>
          <button type="button" class="count-btn" :disabled="count >= 5" @pointerdown.stop="setCount(1)">+</button>
        </div>
      </div>

      <button type="button" class="start-cta" @pointerdown.stop="startGame">Tik om te beginnen</button>
    </div>

    <div v-if="phase === 'done'" class="done-bar">
      <button type="button" class="done-btn primary" @pointerdown.stop="resetToHolding">Opnieuw</button>
      <button type="button" class="done-btn" @pointerdown.stop="backToMenu">Menu</button>
    </div>

    <p class="sr-only" role="status" aria-live="assertive">
      {{ phase === 'done' ? 'Gekozen' : '' }}
    </p>
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
}

.game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.hint {
  position: absolute;
  top: calc(18px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(226, 232, 240, 0.75);
  text-shadow: 0 2px 8px rgba(2, 6, 23, 0.8);
  pointer-events: none;
  z-index: 4;
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
  background: rgba(2, 6, 23, 0.82);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  touch-action: none;
}

.start-title {
  margin: 0;
  font-size: clamp(2.4rem, 11vh, 4.5rem);
  font-weight: 900;
  letter-spacing: 0.24em;
  padding-left: 0.24em;
  background: linear-gradient(180deg, #f472b6, #38bdf8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.start-tagline {
  margin: 0.1rem 0 0.2rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.mode-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  width: min(100%, 26rem);
  margin-top: 0.5rem;
}

.mode-opt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.8rem 0.6rem;
  border-radius: 1rem;
  font: inherit;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  touch-action: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-opt.active {
  color: #f8fafc;
  background: rgba(244, 114, 182, 0.16);
  border-color: rgba(244, 114, 182, 0.65);
  box-shadow: 0 0 18px rgba(244, 114, 182, 0.25);
}

.mode-label {
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: 0.03em;
}

.mode-hint {
  font-size: 0.78rem;
  color: #94a3b8;
}

.count-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.3rem;
}

.count-caption {
  font-size: 0.85rem;
  font-weight: 600;
  color: #94a3b8;
}

.count-stepper {
  display: flex;
  align-items: center;
  gap: 1.1rem;
}

.count-btn {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 50%;
  font: inherit;
  font-size: 1.3rem;
  font-weight: 800;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  touch-action: none;
}

.count-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.count-value {
  min-width: 1.6rem;
  font-size: 1.6rem;
  font-weight: 900;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.start-cta {
  margin-top: 1rem;
  font: inherit;
  font-weight: 700;
  color: #f8fafc;
  padding: 0.9rem 2.2rem;
  border-radius: 999px;
  background: rgba(244, 114, 182, 0.16);
  border: 1px solid rgba(244, 114, 182, 0.4);
  cursor: pointer;
  touch-action: none;
  animation: cta-pulse 1.6s ease-in-out infinite;
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

.done-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  justify-content: center;
  gap: 0.7rem;
  z-index: 8;
  pointer-events: none;
}

.done-btn {
  pointer-events: auto;
  font: inherit;
  font-weight: 700;
  font-size: 0.95rem;
  color: #e2e8f0;
  padding: 0.75rem 1.6rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.35);
  cursor: pointer;
  touch-action: none;
}

.done-btn.primary {
  color: #f8fafc;
  background: rgba(244, 114, 182, 0.18);
  border-color: rgba(244, 114, 182, 0.6);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
