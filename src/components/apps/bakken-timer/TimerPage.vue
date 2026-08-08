<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BakButton from "./BakButton.vue";
import BakLog from "./BakLog.vue";
import EdgeProgress from "./EdgeProgress.vue";
import type { BakEntry, TimerPhase } from "./types";
import {
  BAK_TARGET_MS,
  HOLD_MS,
  MIN_RUN_MS,
  RESULT_LOCK_MS,
  bestTime,
  makeId,
} from "./bakTimerEngine";

const STORAGE_KEY = "bakken-timer:v1";

function loadLog(): BakEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry: unknown) =>
          typeof (entry as BakEntry).id === "string" &&
          Number.isFinite((entry as BakEntry).timeMs),
      )
      .slice(0, 50);
  } catch {
    return [];
  }
}

const phase = ref<TimerPhase>("idle");
const elapsedMs = ref(0);
const holdProgress = ref(0);
const log = ref<BakEntry[]>(loadLog());
const hint = ref("");

const recordMs = computed(() => bestTime(log.value));
const hasRecord = computed(() => recordMs.value !== null);
const targetMs = computed(() => recordMs.value ?? BAK_TARGET_MS);
const runProgress = computed(() =>
  Math.min(1, elapsedMs.value / (2 * targetMs.value)),
);
const overTarget = computed(() => elapsedMs.value >= targetMs.value);
const runPercent = computed(() =>
  Math.round((elapsedMs.value / targetMs.value) * 100),
);

let holdStart = 0;
let runStart = 0;
let phaseBeforeArming: TimerPhase = "idle";
let resultLockUntil = 0;
let rafId: number | null = null;
let hintTimer: number | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;

function saveLog() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log.value));
  } catch {
    // storage may be unavailable (private mode, quota) — ignore
  }
}

watch(log, saveLog, { deep: true });

function startTicker() {
  stopTicker();
  const loop = () => {
    const now = performance.now();
    if (phase.value === "arming") {
      const next = Math.min(1, (now - holdStart) / HOLD_MS);
      if (Math.abs(next - holdProgress.value) >= 0.01 || next >= 1) {
        holdProgress.value = next;
      }
    } else if (phase.value === "running") {
      const ms = Math.floor(performance.now() - runStart);
      if (ms !== elapsedMs.value) {
        elapsedMs.value = ms;
      }
    } else {
      stopTicker();
      return;
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function stopTicker() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function showHint(text: string) {
  hint.value = text;
  if (hintTimer !== null) {
    window.clearTimeout(hintTimer);
    hintTimer = null;
  }
  if (text) {
    hintTimer = window.setTimeout(() => {
      hint.value = "";
      hintTimer = null;
    }, 1600);
  }
}

async function acquireWakeLock() {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    wakeLock = (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    try {
      wakeLock.release();
    } catch {
      // already released — ignore
    }
    wakeLock = null;
  }
}

let pendingArmTimer: number | null = null;

function beginArming(heldSince: number) {
  phaseBeforeArming = phase.value;
  phase.value = "arming";
  holdStart = heldSince;
  holdProgress.value = 0;
  startTicker();
}

function schedulePendingArm() {
  if (pendingArmTimer !== null) {
    return;
  }
  const remaining = resultLockUntil - performance.now();
  const pressedAt = performance.now();
  pendingArmTimer = window.setTimeout(() => {
    pendingArmTimer = null;
    if (phase.value === "idle" || phase.value === "result") {
      beginArming(pressedAt);
    }
  }, Math.max(0, remaining));
}

function clearPendingArm() {
  if (pendingArmTimer !== null) {
    window.clearTimeout(pendingArmTimer);
    pendingArmTimer = null;
  }
}

function onVisibilityChange() {
  if (document.visibilityState !== "visible" || phase.value !== "running") {
    return;
  }
  // rAF pauses while the tab is hidden, so the display may lag behind the
  // wall clock. Sync it and re-arm the wake lock in case the screen slept
  // and released it mid-run.
  elapsedMs.value = Math.floor(performance.now() - runStart);
  acquireWakeLock();
}

function onTouchDown() {
  if (phase.value === "running") {
    if (performance.now() - runStart < MIN_RUN_MS) {
      return;
    }
    stopRun();
    return;
  }

  if (phase.value === "idle" || phase.value === "result") {
    if (performance.now() < resultLockUntil) {
      schedulePendingArm();
      return;
    }
    beginArming(performance.now());
  }
}

function onTouchUp() {
  clearPendingArm();
  if (phase.value !== "arming") {
    return;
  }
  const held = performance.now() - holdStart;
  if (held >= HOLD_MS) {
    startRun();
  } else {
    cancelArming(true);
  }
}

function onTouchCancel() {
  clearPendingArm();
  if (phase.value === "arming") {
    cancelArming(false);
  }
}

let pagePointerId: number | null = null;

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }
  const el = target.closest("button, a, input, select, textarea, [role='button']");
  if (!el) {
    return false;
  }
  return !el.classList.contains("bak-btn");
}

function onPagePointerDown(event: PointerEvent) {
  if (isInteractiveTarget(event.target)) {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  if (phase.value === "running") {
    onTouchDown();
    return;
  }
  if (pagePointerId !== null && pagePointerId !== event.pointerId) {
    pagePointerId = null;
  }
  if (pagePointerId !== null) {
    return;
  }
  pagePointerId = event.pointerId;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // pointer capture may be unavailable for the active pointer — ignore
  }
  onTouchDown();
}

function onPagePointerUp(event: PointerEvent) {
  if (event.pointerId !== pagePointerId) {
    return;
  }
  pagePointerId = null;
  onTouchUp();
}

function onPagePointerCancel(event: PointerEvent) {
  if (event.pointerId !== pagePointerId) {
    return;
  }
  pagePointerId = null;
  onTouchCancel();
}

function onPageLostCapture() {
  pagePointerId = null;
  onTouchCancel();
}

function startRun() {
  stopTicker();
  phase.value = "running";
  runStart = performance.now();
  elapsedMs.value = 0;
  acquireWakeLock();
  startTicker();
}

function stopRun() {
  const now = performance.now();
  elapsedMs.value = now - runStart;
  stopTicker();
  releaseWakeLock();
  recordEntry(elapsedMs.value);
  phase.value = "result";
  resultLockUntil = now + RESULT_LOCK_MS;
}

function cancelArming(tooShort: boolean) {
  stopTicker();
  phase.value = phaseBeforeArming;
  holdProgress.value = 0;
  if (tooShort) {
    showHint("Te snel! Houd vast om te starten.");
  }
}

function recordEntry(timeMs: number) {
  log.value.unshift({
    id: makeId(),
    timeMs,
    at: new Date().toISOString(),
  });
  log.value = log.value.slice(0, 50);
}

function removeEntry(id: string) {
  log.value = log.value.filter((entry) => entry.id !== id);
}

function clearLog() {
  if (phase.value === "running" || phase.value === "arming") {
    return;
  }
  log.value = [];
}

onMounted(() => {
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopTicker();
  releaseWakeLock();
  clearPendingArm();
  if (hintTimer !== null) {
    window.clearTimeout(hintTimer);
  }
});
</script>

<template>
  <main
    @pointerdown="onPagePointerDown"
    @pointerup="onPagePointerUp"
    @pointercancel="onPagePointerCancel"
    @lostpointercapture="onPageLostCapture"
    @contextmenu.prevent
  >
    <section class="hero" aria-labelledby="page-title">
      <div class="eyebrow">Dispuut Ebrius Vespertina</div>
      <h1 id="page-title">Bakken timer</h1>
      <p>
        Houd je vinger ergens op het scherm vast om te starten. Laat los zodra
        je begint te drinken en tik weer als de bak leeg is.
      </p>
    </section>

    <section class="panel timer-panel" aria-label="Timer">
      <BakButton
        :phase="phase"
        :elapsed-ms="elapsedMs"
        :hold-progress="holdProgress"
        :run-percent="runPercent"
        :has-record="hasRecord"
        @touch-down="onTouchDown"
        @touch-up="onTouchUp"
      />
      <div class="hint" aria-live="polite">{{ hint }}</div>
    </section>

    <section class="panel log-panel" aria-labelledby="log-title">
      <div class="panel-header">
        <h2 id="log-title">Logboek</h2>
        <button
          class="btn-ghost"
          type="button"
          :disabled="log.length === 0"
          @click="clearLog"
        >
          Wis
        </button>
      </div>
      <BakLog :entries="log" @remove-entry="removeEntry" />
    </section>
  </main>

  <EdgeProgress
    :phase="phase"
    :hold-progress="holdProgress"
    :run-progress="runProgress"
    :over-target="overTarget"
  />
</template>

<style scoped>
main {
  width: min(100%, 58rem);
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
  min-height: 100dvh;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
}

.hero {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0.1rem 0.25rem;
}

.eyebrow {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #f59e0b;
}

h1 {
  margin: 0;
  font-size: clamp(2.1rem, 6vw, 3.2rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
  color: #f8fafc;
}

.hero p {
  margin: 0;
  max-width: 42rem;
  font-size: 0.98rem;
  line-height: 1.6;
  color: #94a3b8;
}

.panel {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  padding: 1rem;
  min-width: 0;
}

.timer-panel {
  display: grid;
  place-items: center;
  gap: 0.7rem;
  padding-top: 2rem;
  padding-bottom: 1.4rem;
}

.hint {
  min-height: 1.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: center;
  color: #fbbf24;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.btn-ghost {
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
  border-radius: 0.6rem;
  padding: 0.45rem 0.75rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.btn-ghost:hover:not(:disabled) {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.9);
}

.btn-ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

@media (min-width: 56rem) {
  main {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: start;
    padding: 1.5rem;
    gap: 1.25rem;
  }

  .hero {
    grid-column: 1 / -1;
  }
}
</style>
