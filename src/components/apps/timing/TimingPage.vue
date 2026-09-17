<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
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
  TimingEvent,
  TimingState,
} from "./timingEngine";

import {
  BOTTOM_COLOR,
  createFx,
  drawCountdownRing,
  drawSkillPlayer,
  skillAngle,
  skillCircle,
  spawnHitSpark,
  spawnMissRing,
  spawnScoreBurst,
  TOP_COLOR,
  updateFx,
} from "./timingRender";
import type { CurveStats, FxState, SkillResult } from "./timingRender";
import SkillStats from "./SkillStats.vue";

const shellRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const mode = ref<Mode>(loadMode());
const started = ref(false);
const scores = ref<[number, number]>([0, 0]);
/** big centre number: countdown (reflex/blind), "?" (blind, hidden) or mm:ss (skill) */
const countdownText = ref<string | null>(null);
const blindHidden = ref(false);
/** short "GREAT!/GOED!/MIS!" label shown at the relevant player's side */
const sideFlash = ref<string | null>(null);
const sideFlashPlayer = ref<PlayerIndex>(0);
const sideFlashColor = ref("#ffffff");
let sideFlashTimer = 0;
/** "NU!", "GA!", "TE VROEG!" or the round result */
const centerFlash = ref<string | null>(null);
const flashClass = ref<"go" | "top" | "bottom">("go");
/** second line of the round-result flash, e.g. "BOVEN +0,042s · ONDER GEDISKWA" */
const flashSub = ref<string | null>(null);
const winner = ref<PlayerIndex | null>(null);
/** true once the match ended (any outcome, including a draw) — shows the results overlay */
const matchOver = ref(false);
const muted = ref(loadMuted());

const skillResult = ref<SkillResult | null>(null);

let config: TimingConfig | null = null;
let state: TimingState | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastTime = 0;
let time = 0;

let flashTimer = 0;
let lastCountdownShown = -1;
let wasHidden = false;

// ---- visual timers ----
let shakeT = 0;
let flashT = 0;
let flashColor = "";
/** shared canvas effects (particles, rings, marker glow, animation clock) */
const fx: FxState = createFx();

// ---- audio (WebAudio, created on the first user gesture) ----
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

function beep(
  freq: number,
  dur = 0.06,
  volume = 0.12,
  type: OscillatorType = "square",
  delay = 0,
): void {
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

function soundTick(): void {
  beep(300, 0.045, 0.06, "sine");
}
/** Low drop when the blind countdown goes dark. */
function soundHide(): void {
  beep(170, 0.3, 0.1, "sine");
}
function soundGo(): void {
  beep(196, 0.14, 0.14, "triangle");
  beep(392, 0.1, 0.09, "triangle");
}
function soundDq(): void {
  beep(150, 0.18, 0.16, "sawtooth");
}
function soundLate(): void {
  beep(520, 0.05, 0.22, "square");
}
/** Better hits ring higher. */
function soundHit(devMs: number): void {
  beep(clamp(920 - devMs, 380, 920), 0.06, 0.18, "triangle");
}
/** Golden pop for a great skill check. */
function soundGreat(): void {
  beep(784, 0.07, 0.16, "triangle");
  beep(1047, 0.12, 0.14, "triangle", 0.05);
}
function soundMiss(): void {
  beep(150, 0.18, 0.14, "sawtooth");
}
/** Short pop announcing a new red target zone. */
function soundZoneSpawn(): void {
  beep(660, 0.05, 0.1, "triangle");
}
function soundScore(): void {
  beep(330, 0.12, 0.1, "triangle");
  beep(415, 0.1, 0.1, "triangle");
  beep(494, 0.1, 0.1, "triangle");
  beep(659, 0.16, 0.11, "triangle");
}
function soundWin(): void {
  const notes = [523, 659, 784, 1047];
  for (let i = 0; i < notes.length; i += 1) {
    beep(notes[i], 0.18, 0.14, "square", i * 0.11);
  }
}

// ---- preferences (persisted so the next match starts with the last choice) ----
function loadMode(): Mode {
  try {
    const v = window.localStorage.getItem("timing-mode");
    if (v === "reflex" || v === "skill" || v === "blind") return v;
  } catch {
    /* storage unavailable */
  }
  return "reflex";
}

function loadMuted(): boolean {
  try {
    return window.localStorage.getItem("timing-muted") === "1";
  } catch {
    /* storage unavailable */
  }
  return false;
}

function setMode(value: Mode): void {
  mode.value = value;
  try {
    window.localStorage.setItem("timing-mode", value);
  } catch {
    /* storage unavailable */
  }
  // The engine config carries the mode (it drives countdown length and the
  // rule set); rebuild it so the next match actually uses the new mode.
  if (ctx) applyLayout();
}

function toggleMute(): void {
  muted.value = !muted.value;
  try {
    window.localStorage.setItem("timing-muted", muted.value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
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
  config = makeTimingConfig(w, h, mode.value);
  // Mid-game resize (e.g. rotation): keep the score, restart the round.
  if (prev) {
    state = createTimingState(config);
    state.scores = [prev.scores[0], prev.scores[1]];
    scores.value = [prev.scores[0], prev.scores[1]];
    lastCountdownShown = -1;
    countdownText.value = null;
  }
  draw();
}

// ---- game lifecycle ----
function requestWakeLock(): void {
  try {
    void navigator.wakeLock?.request("screen").catch(() => {});
  } catch {
    /* unsupported */
  }
}

function showFlash(text: string, cls: "go" | "top" | "bottom", ms: number, sub?: string): void {
  centerFlash.value = text;
  flashClass.value = cls;
  flashSub.value = sub ?? null;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    centerFlash.value = null;
    flashSub.value = null;
  }, ms);
}

/** true while the current history entry is our in-game state (see onPopState) */
let inGameHistory = false;

function startGame(): void {
  if (started.value || !config) return;
  started.value = true;
  winner.value = null;
  matchOver.value = false;
  skillResult.value = null;
  state = createTimingState(config);
  scores.value = [0, 0];
  countdownText.value = null;
  lastCountdownShown = -1;
  wasHidden = false;
  fx.particles = [];
  fx.rings = [];
  ensureAudio();
  requestWakeLock();
  lastTime = performance.now();
  if (!inGameHistory) {
    try {
      history.pushState({ timing: "playing" }, "");
      inGameHistory = true;
    } catch {
      inGameHistory = false;
    }
  }
}

function backToMenu(): void {
  winner.value = null;
  matchOver.value = false;
  started.value = false;
  skillResult.value = null;
  scores.value = [0, 0];
  countdownText.value = null;
  centerFlash.value = null;
  flashSub.value = null;
  sideFlash.value = null;
  fx.particles = [];
  fx.rings = [];
}

/** Back while in-game: return to the mode menu instead of leaving the app.
    The menu entry replaces the popped one, so one more back goes to the hub. */
function onPopState(): void {
  if (started.value || matchOver.value) {
    backToMenu();
    inGameHistory = false;
    try {
      history.replaceState({ timing: "menu" }, "");
    } catch {
      /* history best-effort */
    }
  }
}

// ---- input ----
function onPointerDown(e: PointerEvent): void {
  if (winner.value !== null) return;
  if (!started.value) {
    startGame();
    return;
  }
  const shell = shellRef.value;
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const player: PlayerIndex = y < rect.height / 2 ? 0 : 1;
  handleTap(player);
}

function onKeyDown(e: KeyboardEvent): void {
  if (!started.value && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    startGame();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    handleTap(0);
  } else if (e.code === "Enter") {
    e.preventDefault();
    handleTap(1);
  }
}

function handleTap(player: PlayerIndex): void {
  if (!started.value || !state || !config) return;
  const events = tapTiming(state, player, config);
  for (const ev of events) handleTapEvent(ev);
}

/** Small per-side label ("GREAT!"/"GOED!"/"MIS!") at the tapping player. */
function showSkillFlash(player: PlayerIndex, text: string, color: string): void {
  sideFlash.value = text;
  sideFlashPlayer.value = player;
  sideFlashColor.value = color;
  window.clearTimeout(sideFlashTimer);
  sideFlashTimer = window.setTimeout(() => {
    sideFlash.value = null;
  }, 750);
}

function handleTapEvent(ev: TimingEvent): void {
  if (ev.type !== "tap") return;
  if (!config || !state) return;
  const player = ev.player;
  if (ev.result === "early") {
    showFlash("TE VROEG!", player === 0 ? "top" : "bottom", 700);
    soundDq();
    try {
      navigator.vibrate?.(30);
    } catch {
      /* haptics are best-effort */
    }
  } else if (ev.result === "late") {
    soundLate();
  } else if (ev.result === "great") {
    soundGreat();
    fx.hitGlow[player] = 0.25;
    spawnHitSpark(fx, config, state, player);
    showSkillFlash(player, "GREAT!", "#fbbf24");
  } else if (ev.result === "good") {
    soundHit(ev.devMs ?? 0);
    fx.hitGlow[player] = 0.25;
    spawnHitSpark(fx, config, state, player);
    showSkillFlash(player, "GOED!", player === 0 ? TOP_COLOR : BOTTOM_COLOR);
  } else if (ev.result === "miss") {
    soundMiss();
    shakeT = Math.max(shakeT, 0.12);
    spawnMissRing(fx, config, state, player);
    showSkillFlash(player, "MIS!", "#ef4444");
    try {
      navigator.vibrate?.(25);
    } catch {
      /* haptics are best-effort */
    }
  }
}

function draw(): void {
  if (!ctx || !config || !state) return;
  const cfg = config;
  const c = ctx;
  c.clearRect(-16, -16, cfg.fieldW + 32, cfg.fieldH + 32);
  c.save();
  if (shakeT > 0) {
    const amp = 8 * (shakeT / 0.25);
    c.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
  }

  // Faint player tints so each half reads as "theirs".
  c.fillStyle = TOP_COLOR;
  c.globalAlpha = 0.05;
  c.fillRect(0, 0, cfg.fieldW, cfg.fieldH / 2);
  c.fillStyle = BOTTOM_COLOR;
  c.fillRect(0, cfg.fieldH / 2, cfg.fieldW, cfg.fieldH / 2);
  c.globalAlpha = 1;

  if (state.mode === "skill") {
    drawSkillPlayer(ctx, fx, config, state, 0);
    drawSkillPlayer(ctx, fx, config, state, 1);
  } else {
    drawCountdownRing(ctx, config, state);
  }

  // Contact rings.
  for (const r of fx.rings) {
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
  for (const p of fx.particles) {
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

  if (flashT > 0) {
    c.globalAlpha = (flashT / 0.35) * 0.14;
    c.fillStyle = flashColor;
    c.fillRect(0, 0, cfg.fieldW, cfg.fieldH);
    c.globalAlpha = 1;
  }
}

// ---- results / bell curve ----
function buildSkillResult(): void {
  if (!state) return;
  const stats = ([0, 1] as const).map((p): CurveStats => {
    const pl = state!.skill[p];
    const { mean, sigma } = fitCurve(pl.deviations);
    return {
      hits: pl.hits,
      greats: pl.greats,
      goods: pl.goods,
      misses: pl.misses,
      deviations: [...pl.deviations],
      mean,
      sigma,
      avg: pl.avg,
      best: pl.deviations.length ? Math.min(...pl.deviations) : NaN,
    };
  });
  skillResult.value = {
    avg: [Math.round(state.skillAvg[0]), Math.round(state.skillAvg[1])],
    stats: [stats[0], stats[1]],
  };
}

// ---- main loop ----
function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  if (!started.value || !state || !config) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (dt <= 0) return;
  updateFx(fx, dt);
  shakeT = Math.max(0, shakeT - dt);
  flashT = Math.max(0, flashT - dt);

  const events = stepTiming(state, dt, config);
  for (const ev of events) {
    if (ev.type === "zero") {
      if (state.mode === "reflex") showFlash("NU!", "go", 500);
      else if (state.mode === "skill") showFlash("GA!", "go", 600);
      soundGo();
    } else if (ev.type === "tap") {
      handleTapEvent(ev);
    } else if (ev.type === "zoneSpawn") {
      // A fresh red zone appeared for this player: ping it so they see the
      // new target.
      soundZoneSpawn();
      const p = ev.player;
      const { cx, cy, R } = skillCircle(config, p);
      const zAng = skillAngle(state.skill[p].zone);
      fx.rings.push({
        x: cx + Math.cos(zAng) * R,
        y: cy + Math.sin(zAng) * R,
        t: 0.35,
        max: 0.35,
        color: "#ef4444",
      });
    } else if (ev.type === "zoneMiss") {
      soundMiss();
      spawnMissRing(fx, config, state, ev.player);
      showSkillFlash(ev.player, "MIS!", "#ef4444");
    } else if (ev.type === "roundResult") {
      scores.value = [state.scores[0], state.scores[1]];
      lastCountdownShown = -1;
      wasHidden = false;
      const dev = (p: PlayerIndex): string => {
        const d = ev.devs[p];
        if (Number.isNaN(d)) return ev.early[p] ? "GEDISKWA" : "—";
        const sign = ev.early[p] ? "−" : "+";
        return `${sign}${(d / 1000).toFixed(3).replace(".", ",")}s`;
      };
      const sub = `BOVEN ${dev(0)} · ONDER ${dev(1)}`;
      if (ev.winner === null) {
        showFlash("GEEN PUNT!", "go", 1600, sub);
      } else {
        showFlash(
          ev.winner === 0 ? "BOVEN WINT!" : "ONDER WINT!",
          ev.winner === 0 ? "top" : "bottom",
          1600,
          sub,
        );
        const color = ev.winner === 0 ? TOP_COLOR : BOTTOM_COLOR;
        spawnScoreBurst(fx, config.fieldW / 2, config.fieldH / 2, ev.winner === 0);
        fx.rings.push({ x: config.fieldW / 2, y: config.fieldH / 2, t: 0.4, max: 0.4, color });
        shakeT = 0.25;
        flashT = 0.35;
        flashColor = color;
        soundScore();
        try {
          navigator.vibrate?.(60);
        } catch {
          /* haptics are best-effort */
        }
      }
    } else if (ev.type === "skillEnd") {
      buildSkillResult();
      winner.value = ev.winner;
      matchOver.value = true;
      started.value = false;
      if (ev.winner === null) {
        showFlash("GELIJKSPEL!", "go", 1600);
      } else {
        spawnScoreBurst(fx, config.fieldW / 2, config.fieldH / 2, ev.winner === 0);
        shakeT = 0.4;
        flashT = 0.55;
        flashColor = ev.winner === 0 ? TOP_COLOR : BOTTOM_COLOR;
      }
      soundWin();
      try {
        navigator.vibrate?.([120, 60, 220]);
      } catch {
        /* haptics are best-effort */
      }
    } else if (ev.type === "matchEnd") {
      winner.value = ev.winner;
      matchOver.value = true;
      started.value = false;
      spawnScoreBurst(fx, config.fieldW / 2, config.fieldH / 2, ev.winner === 0);
      shakeT = 0.45;
      flashT = 0.6;
      flashColor = ev.winner === 0 ? TOP_COLOR : BOTTOM_COLOR;
      soundWin();
      try {
        navigator.vibrate?.([120, 60, 220]);
      } catch {
        /* haptics are best-effort */
      }
    }
  }

  // Centre text: countdown / "?" / skill clock.
  if (state.phase === "countdown") {
    const n = Math.max(0, Math.ceil(state.countdown));
    const visible = state.mode !== "blind" || state.countdown > state.hideAt;
    blindHidden.value = !visible;
    if (!visible) {
      if (n === 0) countdownText.value = null;
      else {
        if (!wasHidden) {
          wasHidden = true;
          soundHide();
        }
        countdownText.value = "?";
      }
    } else if (n === 0) {
      countdownText.value = null;
    } else if (n !== lastCountdownShown) {
      lastCountdownShown = n;
      countdownText.value = String(n);
      soundTick();
    }
  } else if (state.mode === "skill" && state.phase === "active") {
    blindHidden.value = false;
    const rem = Math.max(0, Math.ceil(config.skillDuration - state.skillClock));
    countdownText.value = `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, "0")}`;
  } else {
    blindHidden.value = false;
    countdownText.value = null;
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

/** Score-slot value: rounds won (reflex/blind) or live average ms (skill). */
function scoreText(p: PlayerIndex): string {
  if (mode.value !== "skill" || !state) return String(scores.value[p]);
  const pl = state.skill[p];
  return pl.hits + pl.misses > 0 ? String(Math.round(pl.avg)) : "—";
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
  rafId = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  window.clearTimeout(flashTimer);
  window.clearTimeout(sideFlashTimer);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("orientationchange", onResize);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("visibilitychange", onVisibility);
});
</script>

<template>
  <div
    ref="shellRef"
    class="game-shell"
    @pointerdown="onPointerDown"
    @contextmenu.prevent
  >
    <canvas ref="canvasRef" class="game-canvas" aria-hidden="true"></canvas>

    <div v-if="started" class="score" aria-hidden="true">
      <span :key="`top-${scores[0]}`" class="score-num top">{{ scoreText(0) }}</span>
      <span :key="`bottom-${scores[1]}`" class="score-num bottom">{{ scoreText(1) }}</span>
    </div>

    <p
      v-if="started && countdownText"
      :key="`count-${countdownText}-${blindHidden}`"
      class="countdown"
      :class="{ blind: blindHidden }"
      aria-hidden="true"
    >
      {{ countdownText }}
    </p>

    <p
      v-if="started && centerFlash"
      :key="`flash-${centerFlash}-${flashClass}`"
      class="center-flash"
      :class="flashClass"
      aria-hidden="true"
    >
      {{ centerFlash }}
    </p>

    <p v-if="started && flashSub" :key="`sub-${flashSub}`" class="flash-sub" aria-hidden="true">
      {{ flashSub }}
    </p>

    <p
      v-if="started && sideFlash"
      :key="`side-${sideFlash}-${sideFlashPlayer}`"
      class="side-flash"
      :class="sideFlashPlayer === 0 ? 'top' : 'bottom'"
      :style="{ color: sideFlashColor }"
      aria-hidden="true"
    >
      {{ sideFlash }}
    </p>

    <div v-if="started" class="zone-hints" aria-hidden="true">
      <span class="hint hint-top">{{ mode === "skill" ? "TIK!" : "TIK BIJ 0!" }}</span>
      <span class="hint hint-bottom">{{ mode === "skill" ? "TIK!" : "TIK BIJ 0!" }}</span>
    </div>

    <div v-if="!started && !matchOver" class="start-overlay" @pointerdown="startGame">
      <h1 class="start-title">TIMING</h1>
      <p class="start-tagline">Twee spelers, één telefoon. Tik op het juiste moment.</p>

      <div class="mode-options" role="radiogroup" aria-label="Spelmodus">
        <button
          type="button"
          class="mode-card reflex"
          :class="{ active: mode === 'reflex' }"
          :aria-pressed="mode === 'reflex'"
          @pointerdown.stop="setMode('reflex')"
        >
          <svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
          </svg>
          <span class="mode-name">REFLEX</span>
          <span class="mode-desc">Tik bij 0. Te vroeg = eruit.</span>
        </button>

        <button
          type="button"
          class="mode-card skill"
          :class="{ active: mode === 'skill' }"
          :aria-pressed="mode === 'skill'"
          @pointerdown.stop="setMode('skill')"
        >
          <svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="5" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          <span class="mode-name">SKILL CHECK</span>
          <span class="mode-desc">Tik als de stip de rode zone raakt. Klein = great, groot = good, mis = straf.</span>
        </button>

        <button
          type="button"
          class="mode-card blind"
          :class="{ active: mode === 'blind' }"
          :aria-pressed="mode === 'blind'"
          @pointerdown.stop="setMode('blind')"
        >
          <svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M3 3l18 18" />
          </svg>
          <span class="mode-name">OP GEVOEL</span>
          <span class="mode-desc">Van 20 naar 0. De klok verdwijnt — tik bij 0.</span>
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

    <div v-if="matchOver" class="winner-overlay">
      <div v-if="winner !== null" class="winner-glow" :class="winner === 0 ? 'top' : 'bottom'" aria-hidden="true"></div>
      <p v-if="winner !== null" class="winner-line" :class="winner === 0 ? 'top' : 'bottom'">
        {{ winner === 0 ? 'BOVEN' : 'ONDER' }}
      </p>
      <h2 class="winner-title">{{ winner === null ? 'GELIJKSPEL!' : 'WINT!' }}</h2>

      <SkillStats v-if="mode === 'skill' && skillResult" :result="skillResult" />

      <p v-else class="final-score" aria-hidden="true">{{ scores[0] }} – {{ scores[1] }}</p>

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
  /* Same treatment as Pong/Tug: both numbers hug the middle, rotated so the
     whole score reads from either end of the phone. */
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
  transform: rotate(-90deg);
  text-shadow: 0 2px 8px rgba(2, 6, 23, 0.6);
  --pop-glow: rgba(148, 163, 184, 0.8);
  animation: score-pop 0.3s ease;
}

.score-num.top {
  color: #34d399;
  --pop-glow: rgba(52, 211, 153, 0.9);
}

.score-num.bottom {
  color: #a78bfa;
  --pop-glow: rgba(167, 139, 250, 0.9);
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

.countdown {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  font-size: clamp(4rem, 18vh, 8rem);
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgba(226, 232, 240, 0.85);
  text-shadow: 0 4px 24px rgba(2, 6, 23, 0.7);
  pointer-events: none;
  z-index: 6;
  animation: count-pop 0.35s ease;
}

.countdown.blind {
  font-size: clamp(2.5rem, 10vh, 4.5rem);
  color: rgba(148, 163, 184, 0.5);
  text-shadow: none;
}

@keyframes count-pop {
  0% {
    scale: 1.5;
    opacity: 0.4;
  }
  100% {
    scale: 1;
    opacity: 1;
  }
}

.center-flash {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  margin: 0;
  font-size: clamp(2.6rem, 12vh, 5rem);
  font-weight: 900;
  letter-spacing: 0.12em;
  padding-left: 0.12em;
  white-space: nowrap;
  pointer-events: none;
  z-index: 7;
  animation: flash-in 0.5s ease;
}

.center-flash.go {
  color: #f8fafc;
  text-shadow: 0 0 30px rgba(148, 163, 184, 0.9), 0 4px 16px rgba(2, 6, 23, 0.8);
}

.center-flash.top {
  color: #34d399;
  text-shadow: 0 0 30px rgba(52, 211, 153, 0.9), 0 4px 16px rgba(2, 6, 23, 0.8);
}

.center-flash.bottom {
  color: #a78bfa;
  text-shadow: 0 0 30px rgba(167, 139, 250, 0.9), 0 4px 16px rgba(2, 6, 23, 0.8);
}

@keyframes flash-in {
  0% {
    scale: 1.6;
    opacity: 0;
  }
  30% {
    scale: 0.95;
    opacity: 1;
  }
  100% {
    scale: 1;
    opacity: 1;
  }
}

.flash-sub {
  position: absolute;
  left: 50%;
  top: calc(50% + clamp(2.6rem, 12vh, 5rem) * 0.7);
  transform: translate(-50%, -50%);
  margin: 0;
  font-size: clamp(0.8rem, 3.4vh, 1.1rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #cbd5e1;
  text-shadow: 0 2px 10px rgba(2, 6, 23, 0.8);
  white-space: nowrap;
  pointer-events: none;
  z-index: 7;
  animation: flash-in 0.5s ease;
}

.side-flash {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  font-size: clamp(1.3rem, 6vh, 2.4rem);
  font-weight: 900;
  letter-spacing: 0.1em;
  text-shadow: 0 2px 12px rgba(2, 6, 23, 0.85), 0 0 24px currentColor;
  pointer-events: none;
  z-index: 7;
  animation: flash-in 0.45s ease;
}

.side-flash.top {
  top: 20%;
  /* The top player reads from the opposite end of the phone. */
  transform: translateX(-50%) rotate(180deg);
}

.side-flash.bottom {
  bottom: 20%;
}

.zone-hints {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}

.hint {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: clamp(1.6rem, 7vh, 3rem);
  font-weight: 800;
  letter-spacing: 0.18em;
  padding-left: 0.18em;
  animation: hint-fade 6.5s ease forwards;
}

.hint-top {
  top: 26%;
  color: rgba(52, 211, 153, 0.5);
  /* The top player reads from the opposite end of the phone. */
  transform: translateX(-50%) rotate(180deg);
}

.hint-bottom {
  bottom: 26%;
  color: rgba(167, 139, 250, 0.5);
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
  overflow-y: auto;
}

.start-title {
  margin: 0;
  font-size: clamp(3rem, 12vh, 5.5rem);
  font-weight: 900;
  letter-spacing: 0.35em;
  padding-left: 0.35em;
  background: linear-gradient(180deg, #34d399, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.start-tagline {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.mode-options {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 100%;
  max-width: 21rem;
  margin-top: 0.4rem;
}

.mode-card {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.7rem;
  align-items: center;
  padding: 0.7rem 1rem;
  border-radius: 1rem;
  font: inherit;
  text-align: left;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.3);
  cursor: pointer;
  touch-action: none;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-icon {
  grid-row: 1 / 3;
  width: 1.9rem;
  height: 1.9rem;
  color: #94a3b8;
  transition: color 0.15s ease;
}

.mode-name {
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.mode-desc {
  font-size: 0.78rem;
  font-weight: 500;
  color: #94a3b8;
}

.mode-card.reflex.active {
  color: #f8fafc;
  background: rgba(251, 191, 36, 0.14);
  border-color: rgba(251, 191, 36, 0.65);
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.25);
}
.mode-card.reflex.active .mode-icon {
  color: #fbbf24;
}

.mode-card.skill.active {
  color: #f8fafc;
  background: rgba(52, 211, 153, 0.14);
  border-color: rgba(52, 211, 153, 0.65);
  box-shadow: 0 0 18px rgba(52, 211, 153, 0.25);
}
.mode-card.skill.active .mode-icon {
  color: #34d399;
}

.mode-card.blind.active {
  color: #f8fafc;
  background: rgba(167, 139, 250, 0.14);
  border-color: rgba(167, 139, 250, 0.65);
  box-shadow: 0 0 18px rgba(167, 139, 250, 0.25);
}
.mode-card.blind.active .mode-icon {
  color: #a78bfa;
}

.start-cta {
  margin-top: 0.75rem;
  font: inherit;
  font-weight: 700;
  color: #f8fafc;
  padding: 0.9rem 2.2rem;
  border-radius: 999px;
  background: rgba(52, 211, 153, 0.16);
  border: 1px solid rgba(52, 211, 153, 0.4);
  cursor: pointer;
  touch-action: none;
  animation: cta-pulse 1.6s ease-in-out infinite;
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
  overflow-y: auto;
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
    rgba(52, 211, 153, 0.55),
    rgba(52, 211, 153, 0.2) 55%,
    transparent 80%
  );
}

.winner-glow.bottom {
  bottom: 0;
  background: radial-gradient(
    ellipse 85% 75% at 50% 95%,
    rgba(167, 139, 250, 0.55),
    rgba(167, 139, 250, 0.2) 55%,
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
.winner-actions,
.skill-stats {
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
  color: #34d399;
  text-shadow: 0 0 30px rgba(52, 211, 153, 0.55);
}

.winner-line.bottom {
  color: #a78bfa;
  text-shadow: 0 0 30px rgba(167, 139, 250, 0.55);
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
  margin: 0.6rem 0 0.4rem;
  font-size: clamp(1.4rem, 5.5vh, 2.2rem);
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
  background: rgba(52, 211, 153, 0.18);
  border-color: rgba(52, 211, 153, 0.6);
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
