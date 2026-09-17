<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  clamp,
  createTugState,
  makeTugConfig,
  pullTug,
  stepTug,
  tapAllowed,
} from "./touwTrekkenEngine";
import type { PlayerIndex, TugConfig, TugState } from "./touwTrekkenEngine";

// Red team (top) vs blue team (bottom) — tug-of-war's own identity, not
// Pong's sky-vs-pink.
const TOP_COLOR = "#f87171";
const BOTTOM_COLOR = "#60a5fa";

const shellRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const started = ref(false);
const scores = ref<[number, number]>([0, 0]);
/** null = infinite (never ends); 3/5 = first player to that many points wins. */
const winTarget = ref<number | null>(loadWinTarget());
/** null = no winner yet; 0/1 = that player won the match. */
const winner = ref<PlayerIndex | null>(null);
const muted = ref(loadMuted());
/** "3" | "2" | "1" shown while a round counts down */
const countdownText = ref<string | null>(null);
/** "TREK!" right after go, "PUNT!" after a score */
const centerFlash = ref<string | null>(null);
const flashClass = ref<"go" | "top" | "bottom">("go");

let config: TugConfig | null = null;
let state: TugState | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastTime = 0;
let time = 0;
/** true while the current history entry is our in-game state (see onPopState) */
let inGameHistory = false;

// Rope anchor points: where each player's hand "holds" the rope, just inside
// the safe area at their edge (above/below the win lines).
let topAnchorY = 0;
let bottomAnchorY = 0;

let flashTimer = 0;
let lastCountdownShown = -1;

/** performance.now() of each player's last counted pull (anti multi-touch spam). */
const lastTapAt: [number, number] = [0, 0];

// ---- visual timers ----
let shakeT = 0;
let flashT = 0;
let flashColor = "";
let jerkT = 0;
let jerkDir = 1;
const pullGlow: [number, number] = [0, 0];

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
let rings: { x: number; y: number; t: number; max: number; color: string }[] = [];

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

/** Deep thud per pull — quiet so a fast mash stays pleasant. */
function soundPull(): void {
  beep(90 + Math.random() * 30, 0.05, 0.16, "sine");
}
function soundTick(): void {
  beep(300, 0.05, 0.16, "sine");
}
function soundGo(): void {
  beep(196, 0.14, 0.2, "triangle");
  beep(392, 0.12, 0.16, "triangle");
  beep(523, 0.16, 0.14, "triangle", 0.06);
}
function soundScore(): void {
  beep(330, 0.12, 0.18, "triangle");
  beep(415, 0.1, 0.16, "triangle");
  beep(494, 0.1, 0.16, "triangle");
  beep(659, 0.16, 0.18, "triangle");
}
/** Rising ping when a critical zone pair appears. */
function soundCriticalSpawn(): void {
  beep(660, 0.12, 0.18, "triangle");
  beep(880, 0.16, 0.14, "triangle");
}
/** Brighter with each combo hit. */
function soundCriticalHit(combo: number): void {
  beep(420 + combo * 70, 0.1, 0.2, "triangle");
  beep(640 + combo * 70, 0.14, 0.16, "triangle");
}
/** Soft let-down when a chain expires. */
function soundCriticalExpire(combo: number): void {
  if (combo > 0) beep(300, 0.16, 0.12, "sine");
}
/** Fanfare when a player wins the match (win target reached). */
function soundWin(): void {
  const notes = [523, 659, 784, 1047, 1319];
  for (let i = 0; i < notes.length; i += 1) {
    beep(notes[i], 0.18, 0.22, "triangle", i * 0.1);
  }
  beep(262, 0.5, 0.18, "sine", 0.1);
}

// ---- preferences (persisted so the next match starts with the last choice) ----
function loadWinTarget(): number | null {
  try {
    const v = window.localStorage.getItem("touwtrekken-win-target");
    if (v === "3" || v === "5") return Number(v);
  } catch {
    /* storage unavailable */
  }
  return null; // default: infinite
}

function loadMuted(): boolean {
  try {
    return window.localStorage.getItem("touwtrekken-muted") === "1";
  } catch {
    /* storage unavailable */
  }
  return false;
}

function setWinTarget(value: number | null): void {
  winTarget.value = value;
  try {
    if (value === null) window.localStorage.removeItem("touwtrekken-win-target");
    else window.localStorage.setItem("touwtrekken-win-target", String(value));
  } catch {
    /* storage unavailable */
  }
}

function toggleMute(): void {
  muted.value = !muted.value;
  try {
    window.localStorage.setItem("touwtrekken-muted", muted.value ? "1" : "0");
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

  const topInset = safeInset("--sat") + 12;
  const bottomInset = safeInset("--sab") + 12;
  const prev = state;
  config = makeTugConfig(w, h, { top: topInset, bottom: bottomInset });
  topAnchorY = topInset + 14;
  bottomAnchorY = h - bottomInset - 14;
  // Mid-game resize (e.g. rotation): keep the score, restart the round.
  if (prev) {
    state = createTugState(config);
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

function showFlash(text: string, cls: "go" | "top" | "bottom", ms: number): void {
  centerFlash.value = text;
  flashClass.value = cls;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    centerFlash.value = null;
  }, ms);
}

function startGame(): void {
  if (started.value || !config) return;
  started.value = true;
  winner.value = null;
  state = createTugState(config);
  scores.value = [0, 0];
  countdownText.value = null;
  centerFlash.value = null;
  lastCountdownShown = -1;
  particles = [];
  rings = [];
  shakeT = 0;
  flashT = 0;
  jerkT = 0;
  pullGlow[0] = 0;
  pullGlow[1] = 0;
  ensureAudio();
  requestWakeLock();
  lastTime = performance.now();
  if (!inGameHistory) {
    try {
      history.pushState({ touwtrekken: "playing" }, "");
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
  countdownText.value = null;
  centerFlash.value = null;
  particles = [];
  rings = [];
}

/** Back while in-game: return to the tug main menu instead of leaving the app.
    The menu entry replaces the popped one, so one more back goes to the hub. */
function onPopState(): void {
  if (started.value || winner.value !== null) {
    backToMenu();
    inGameHistory = false;
    try {
      history.replaceState({ touwtrekken: "menu" }, "");
    } catch {
      /* history best-effort */
    }
  }
}

// ---- input ----
function handleTap(player: PlayerIndex, x?: number, y?: number): void {
  if (!started.value || !state || !config) return;
  const evs = pullTug(state, player, config, x, y);
  for (const ev of evs) {
    if (ev.type === "tug") {
      soundPull();
      pullGlow[player] = 0.35;
      jerkT = 0.18;
      jerkDir = player === 0 ? -1 : 1;
      spawnPullPuff(player);
    } else if (ev.type === "criticalHit") {
      soundPull();
      soundCriticalHit(ev.combo);
      pullGlow[player] = 0.35;
      jerkT = 0.18;
      jerkDir = player === 0 ? -1 : 1;
      spawnPullPuff(player);
      spawnCriticalBurst(ev.x, ev.y, player);
      rings.push({
        x: ev.x,
        y: ev.y,
        t: 0.5,
        max: 0.5,
        color: player === 0 ? TOP_COLOR : BOTTOM_COLOR,
      });
      shakeT = Math.max(shakeT, 0.22);
      flashT = Math.max(flashT, 0.35);
      flashColor = player === 0 ? TOP_COLOR : BOTTOM_COLOR;
      try {
        navigator.vibrate?.(40 + ev.combo * 20);
      } catch {
        /* haptics are best-effort */
      }
    } else if (ev.type === "score") {
      scores.value = [state.scores[0], state.scores[1]];
      showFlash("PUNT!", ev.winner === 0 ? "top" : "bottom", 1000);
      lastCountdownShown = -1;
      countdownText.value = null;
      const color = ev.winner === 0 ? TOP_COLOR : BOTTOM_COLOR;
      spawnScoreBurst(config.fieldW / 2, config.winLineY[ev.winner], ev.winner === 0);
      rings.push({
        x: config.fieldW / 2,
        y: config.winLineY[ev.winner],
        t: 0.4,
        max: 0.4,
        color,
      });
      shakeT = 0.3;
      flashT = 0.4;
      flashColor = color;
      soundScore();
      try {
        navigator.vibrate?.(80);
      } catch {
        /* haptics are best-effort */
      }
      const target = winTarget.value;
      if (target !== null && state.scores[ev.winner] >= target) {
        winner.value = ev.winner;
        started.value = false;
        spawnScoreBurst(config.fieldW / 2, config.fieldH / 2, ev.winner === 0);
        shakeT = 0.5;
        flashT = 0.6;
        soundWin();
        try {
          navigator.vibrate?.([140, 70, 220]);
        } catch {
          /* haptics are best-effort */
        }
      }
    }
  }
}

function onPointerDown(e: PointerEvent): void {
  if (!started.value) {
    if (winner.value === null) startGame();
    return;
  }
  const shell = shellRef.value;
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const player: PlayerIndex = y < rect.height / 2 ? 0 : 1;
  // Anti-multi-touch-spam: each finger that lands fires its own pointerdown
  // within a few ms, so several simultaneous fingers would count as several
  // pulls. The per-player cooldown lets only the first one through — one
  // physical gesture always counts as one pull. Keyboard (below) bypasses
  // this: OS key-repeat already rate-limits it and it's a desktop convenience.
  const now = performance.now();
  if (!tapAllowed(now, lastTapAt[player])) return;
  lastTapAt[player] = now;
  handleTap(player, x, y);
}

function onKeyDown(e: KeyboardEvent): void {
  if (winner.value !== null) return;
  if (!started.value && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    startGame();
    return;
  }
  // Key repeat is allowed: holding a key pulls continuously (desktop dev
  // convenience); on touch, holding does nothing, only taps pull.
  if (e.code === "Space") {
    e.preventDefault();
    handleTap(0);
  } else if (e.code === "Enter") {
    e.preventDefault();
    handleTap(1);
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

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
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

/** Dust kicked up at the pulling player's grip. */
function spawnPullPuff(player: PlayerIndex): void {
  if (!config) return;
  const y = player === 0 ? topAnchorY : bottomAnchorY;
  const baseAng = player === 0 ? -Math.PI / 2 : Math.PI / 2;
  const color = player === 0 ? TOP_COLOR : BOTTOM_COLOR;
  for (let i = 0; i < 7; i += 1) {
    const ang = baseAng + (Math.random() - 0.5) * 1.3;
    const speed = 50 + Math.random() * 130;
    const life = 0.25 + Math.random() * 0.3;
    particles.push({
      x: config.fieldW / 2 + (Math.random() - 0.5) * 14,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      gravity: player === 0 ? 140 : -140,
      life,
      maxLife: life,
      size: 1.5 + Math.random() * 2.5,
      color: Math.random() < 0.35 ? "#ffffff" : color,
    });
  }
}

/** Confetti-style burst where the knot crossed the winner's win line. */
function spawnScoreBurst(x: number, y: number, fromTop: boolean): void {
  if (!config) return;
  const color = fromTop ? TOP_COLOR : BOTTOM_COLOR;
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

/** Big dopamine burst where a critical zone was hit. */
function spawnCriticalBurst(x: number, y: number, player: PlayerIndex): void {
  if (!config) return;
  const color = player === 0 ? TOP_COLOR : BOTTOM_COLOR;
  for (let i = 0; i < 46; i += 1) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 130 + Math.random() * 320;
    const life = 0.5 + Math.random() * 0.45;
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      gravity: 300,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3,
      color: Math.random() < 0.35 ? "#ffffff" : color,
    });
  }
}

/** A rope segment with a lateral sag: taut when the owner is pulling, slack
 * when idle. One shared braided rope, not per-player colours — the teams own
 * the grips, the zones and the flag, the rope is neutral ground. */
function drawRope(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sag: number,
): void {
  if (!ctx || !config) return;
  const c = ctx;
  const w = config.ropeWidth;
  const mx = (x1 + x2) / 2 + sag;
  const my = (y1 + y2) / 2;
  const trace = (): void => {
    c.beginPath();
    c.moveTo(x1, y1);
    c.quadraticCurveTo(mx, my, x2, y2);
  };
  c.lineCap = "round";
  // Base strand, then alternating light/dark twist bands.
  c.strokeStyle = "#b0804e";
  c.lineWidth = w;
  trace();
  c.stroke();
  c.setLineDash([w, w]);
  c.strokeStyle = "#d9b17e";
  trace();
  c.stroke();
  c.strokeStyle = "#6f4c27";
  c.lineWidth = w * 0.85;
  c.lineDashOffset = w;
  trace();
  c.stroke();
  c.setLineDash([]);
  c.lineDashOffset = 0;
}

/** The tug-of-war marker: a pennant tied around the rope at the knot, its tip
 * pointing at whoever is currently winning (neutral slate when centred). */
function drawFlagMarker(y: number, leading: -1 | 0 | 1): void {
  if (!ctx || !config) return;
  const c = ctx;
  const cx = config.fieldW / 2;
  const dir = leading === 0 ? -1 : leading;
  const color = leading === 0 ? "#94a3b8" : leading === -1 ? TOP_COLOR : BOTTOM_COLOR;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(cx - 6, y);
  c.lineTo(cx + 6, y);
  c.lineTo(cx + Math.sin(time * 5) * 2, y + dir * 22);
  c.closePath();
  c.fill();
}

/** The knot the flag is tied to: white ring, fill blends from red to blue
 * with how far the knot has travelled toward each side. */
function drawKnot(y: number): void {
  if (!ctx || !config) return;
  const c = ctx;
  const cx = config.fieldW / 2;
  const cfg = config;
  const progress = clamp(
    (y - cfg.winLineY[0]) / (cfg.winLineY[1] - cfg.winLineY[0]),
    0,
    1,
  );
  c.strokeStyle = "#f8fafc";
  c.lineWidth = cfg.ropeWidth * 1.3;
  c.beginPath();
  c.arc(cx, y, cfg.knotRadius, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = lerpColor(TOP_COLOR, BOTTOM_COLOR, progress);
  c.beginPath();
  c.arc(cx, y, Math.max(cfg.knotRadius - cfg.ropeWidth * 0.65, 2), 0, Math.PI * 2);
  c.fill();
}

function drawGrip(x: number, y: number, color: string, glow: number): void {
  if (!ctx || !config) return;
  const c = ctx;
  const w = config.ropeWidth * 7;
  const h = config.ropeWidth * 2.4;
  c.save();
  c.shadowColor = color;
  c.shadowBlur = glow > 0 ? 16 : 6;
  c.fillStyle = color;
  fillRoundRect(c, x - w / 2, y - h / 2, w, h, h / 2);
  if (glow > 0) {
    c.globalAlpha = 0.5 * (glow / 0.35);
    c.fillStyle = "#ffffff";
    fillRoundRect(c, x - w / 2, y - h / 2, w, h, h / 2);
  }
  c.restore();
}

function drawWinZone(player: PlayerIndex): void {
  if (!ctx || !config || !state) return;
  const c = ctx;
  const cfg = config;
  const color = player === 0 ? TOP_COLOR : BOTTOM_COLOR;
  const y = cfg.winLineY[player];
  const h = player === 0 ? y : cfg.fieldH - y;
  c.fillStyle = color;
  c.globalAlpha = 0.05;
  c.fillRect(0, player === 0 ? 0 : y, cfg.fieldW, h);
  c.globalAlpha = 1;
  // The line the knot must cross to win.
  c.setLineDash([10, 12]);
  c.strokeStyle = color;
  c.globalAlpha = 0.55;
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(0, y);
  c.lineTo(cfg.fieldW, y);
  c.stroke();
  c.globalAlpha = 1;
  c.setLineDash([]);
}

/** The critical-tap target: a pulsing ring in the player's colour that
 * shrinks over its active window (white countdown arc), relocates after
 * each hit, and shows the current combo multiplier. A dashed ring while the
 * trailer's zone waits for their first press. */
function drawCriticalZone(p: PlayerIndex): void {
  if (!ctx || !config || !state) return;
  const z = state.zones[p];
  if (!z) return;
  const c = ctx;
  const cfg = config;
  const color = p === 0 ? TOP_COLOR : BOTTOM_COLOR;
  const active = z.phase === "active";
  const frac = active ? clamp(z.window / cfg.criticalWindow, 0, 1) : 1;
  const pulse = 1 + 0.1 * Math.sin(time * (active ? 9 : 5));
  const R = z.r * pulse;

  c.save();
  c.shadowColor = color;
  c.shadowBlur = 22;
  c.globalAlpha = 0.95;
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(z.x, z.y, R, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 0.28;
  c.fillStyle = color;
  c.beginPath();
  c.arc(z.x, z.y, R * 0.7, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.globalAlpha = 1;

  if (active) {
    // Remaining-window arc.
    c.strokeStyle = "#ffffff";
    c.lineWidth = 3.5;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.arc(z.x, z.y, R + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    c.stroke();
    c.globalAlpha = 1;
  } else {
    // Waiting: dashed ring, the trailer's zone.
    c.setLineDash([6, 8]);
    c.strokeStyle = "#ffffff";
    c.globalAlpha = 0.55;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(z.x, z.y, R + 7, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 1;
  }

  if (z.combo >= 1) {
    const mult = Math.min(
      cfg.criticalBase + (z.combo - 1) * cfg.criticalStep,
      cfg.criticalMax,
    );
    c.fillStyle = "#ffffff";
    c.font = `bold ${Math.round(clamp(cfg.fieldW * 0.055, 18, 30))}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.save();
    c.translate(z.x, z.y - R - 16);
    // The top player sits at the opposite end of the phone, so their label
    // is flipped 180° — readable by them, not just the bottom player.
    if (p === 0) c.rotate(Math.PI);
    c.fillText(`×${mult}`, 0, 0);
    c.restore();
    c.shadowBlur = 0;
  }
}

function draw(): void {
  if (!ctx || !config || !state) return;
  const cfg = config;
  const c = ctx;
  const cx = cfg.fieldW / 2;
  // Oversized clear so the screen-shake translate never leaves stale edges.
  c.clearRect(-16, -16, cfg.fieldW + 32, cfg.fieldH + 32);
  c.save();
  if (shakeT > 0) {
    const amp = 8 * (shakeT / 0.3);
    c.translate((Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp);
  }

  drawWinZone(0);
  drawWinZone(1);

  // The ground line the knot starts on.
  c.setLineDash([4, 14]);
  c.strokeStyle = "rgba(148, 163, 184, 0.25)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, cfg.fieldH / 2);
  c.lineTo(cfg.fieldW, cfg.fieldH / 2);
  c.stroke();
  c.setLineDash([]);

  // Rope: slack when a player rests, taut when they pull hard; a pull also
  // sends a quick lateral jerk down the rope.
  const knotY = state.knotY;
  const wave = Math.sin(time * 2.2) * 1.5;
  const jerk =
    jerkT > 0 ? Math.sin((jerkT / 0.18) * Math.PI) * 7 * (jerkT / 0.18) * jerkDir : 0;
  const topSlack = pullGlow[0] > 0 ? 0.25 : 1;
  const botSlack = pullGlow[1] > 0 ? 0.25 : 1;
  drawRope(cx + jerk * 0.4, topAnchorY, cx, knotY, 9 * topSlack + wave);
  drawRope(cx, knotY, cx + jerk * 0.4, bottomAnchorY, -(9 * botSlack + wave));

  // Grips: where each player holds their end.
  drawGrip(cx + jerk * 0.4, topAnchorY, TOP_COLOR, pullGlow[0]);
  drawGrip(cx + jerk * 0.4, bottomAnchorY, BOTTOM_COLOR, pullGlow[1]);

  // The marker: pennant pointing at the current leader, tied around the rope
  // at the knot.
  const leading: -1 | 0 | 1 =
    knotY < cfg.fieldH / 2 - 1 ? -1 : knotY > cfg.fieldH / 2 + 1 ? 1 : 0;
  drawFlagMarker(knotY, leading);
  drawKnot(knotY);

  // Critical-tap targets, on top of the rope.
  drawCriticalZone(0);
  drawCriticalZone(1);

  // Contact rings (scores).
  for (const r of rings) {
    const k = r.t / r.max;
    c.globalAlpha = 0.55 * (1 - k);
    c.strokeStyle = r.color;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(r.x, r.y, 5 + 34 * (1 - k), 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;

  // Particles: additive so overlapping dust glows.
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
    c.globalAlpha = (flashT / 0.4) * 0.14;
    c.fillStyle = flashColor;
    c.fillRect(0, 0, cfg.fieldW, cfg.fieldH);
    c.globalAlpha = 1;
  }
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  if (!started.value || !state || !config) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (dt <= 0) return;
  time += dt;
  shakeT = Math.max(0, shakeT - dt);
  flashT = Math.max(0, flashT - dt);
  jerkT = Math.max(0, jerkT - dt);
  pullGlow[0] = Math.max(0, pullGlow[0] - dt);
  pullGlow[1] = Math.max(0, pullGlow[1] - dt);
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    rings[i].t -= dt;
    if (rings[i].t <= 0) rings.splice(i, 1);
  }
  updateParticles(dt);

  const events = stepTug(state, dt, config);
  for (const ev of events) {
    if (ev.type === "go") {
      showFlash("TREK!", "go", 650);
      soundGo();
    } else if (ev.type === "criticalSpawn") {
      // Both zones spawn in the same frame; announce once.
      if (ev.player === 0) soundCriticalSpawn();
    } else if (ev.type === "criticalExpire") {
      soundCriticalExpire(ev.combo);
    }
  }

  if (state.phase === "countdown") {
    const n = Math.max(0, Math.ceil(state.countdown));
    if (n === 0) {
      countdownText.value = null;
    } else if (n !== lastCountdownShown) {
      lastCountdownShown = n;
      countdownText.value = String(n);
      soundTick();
    }
  } else {
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
      <span :key="`top-${scores[0]}`" class="score-num top">{{ scores[0] }}</span>
      <span :key="`bottom-${scores[1]}`" class="score-num bottom">{{ scores[1] }}</span>
    </div>

    <p v-if="started && countdownText" :key="`count-${countdownText}`" class="countdown" aria-hidden="true">
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

    <div v-if="started" class="zone-hints" aria-hidden="true">
      <span class="hint hint-top">TIK!</span>
      <span class="hint hint-bottom">TIK!</span>
    </div>

    <div v-if="!started && winner === null" class="start-overlay" @pointerdown="startGame">
      <h1 class="start-title">TOUWTREKKEN</h1>
      <p class="start-tagline">Rood tegen blauw — wie tikt het snelst?</p>
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
  /* Both numbers hug the field's vertical middle; same treatment as Pong so
     the app family reads consistently from opposite ends of the phone. */
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
  color: #f87171;
  --pop-glow: rgba(248, 113, 113, 0.9);
}

.score-num.bottom {
  color: #60a5fa;
  --pop-glow: rgba(96, 165, 250, 0.9);
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
  color: rgba(226, 232, 240, 0.85);
  text-shadow: 0 4px 24px rgba(2, 6, 23, 0.7);
  pointer-events: none;
  z-index: 6;
  animation: count-pop 0.35s ease;
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
  font-size: clamp(3rem, 14vh, 6rem);
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
  color: #f87171;
  text-shadow: 0 0 30px rgba(248, 113, 113, 0.9), 0 4px 16px rgba(2, 6, 23, 0.8);
}

.center-flash.bottom {
  color: #60a5fa;
  text-shadow: 0 0 30px rgba(96, 165, 250, 0.9), 0 4px 16px rgba(2, 6, 23, 0.8);
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
  color: rgba(248, 113, 113, 0.5);
  /* The top player reads from the opposite end of the phone: flip the hint
     so it faces them, not the bottom player. */
  transform: translateX(-50%) rotate(180deg);
}

.hint-bottom {
  bottom: 26%;
  color: rgba(96, 165, 250, 0.5);
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
  font-size: clamp(1.5rem, 6vh, 2.6rem);
  font-weight: 900;
  letter-spacing: 0.14em;
  padding-left: 0.14em;
  background: linear-gradient(180deg, #f87171, #60a5fa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.start-tagline {
  margin: 0.1rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.02em;
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
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(248, 113, 113, 0.65);
  box-shadow: 0 0 18px rgba(248, 113, 113, 0.25);
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
  background: rgba(248, 113, 113, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.4);
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
    rgba(248, 113, 113, 0.55),
    rgba(248, 113, 113, 0.2) 55%,
    transparent 80%
  );
}

.winner-glow.bottom {
  bottom: 0;
  background: radial-gradient(
    ellipse 85% 75% at 50% 95%,
    rgba(96, 165, 250, 0.55),
    rgba(96, 165, 250, 0.2) 55%,
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
  color: #f87171;
  text-shadow: 0 0 30px rgba(248, 113, 113, 0.55);
}

.winner-line.bottom {
  color: #60a5fa;
  text-shadow: 0 0 30px rgba(96, 165, 250, 0.55);
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
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(248, 113, 113, 0.6);
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
