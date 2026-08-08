<script setup lang="ts">
import type { Counter } from "./types";

const HOLD_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;

const props = defineProps<{
  counter: Counter;
}>();

const emit = defineEmits<{
  count: [delta: number];
  edit: [];
  stats: [];
}>();

let holdTimer: number | null = null;
let repeatTimer: number | null = null;
let activePointerId: number | null = null;
let pendingDelta = 0;
let heldRepeat = false;

function clearTimers() {
  if (holdTimer !== null) {
    window.clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (repeatTimer !== null) {
    window.clearInterval(repeatTimer);
    repeatTimer = null;
  }
}

/** Tap = one step; hold 400ms = repeat every 90ms until release. */
function onPointerDown(event: PointerEvent, delta: number) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  if (activePointerId !== null) {
    return;
  }
  activePointerId = event.pointerId;
  pendingDelta = delta;
  heldRepeat = false;
  clearTimers();
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    heldRepeat = true;
    emit("count", delta);
    repeatTimer = window.setInterval(() => emit("count", delta), REPEAT_INTERVAL_MS);
  }, HOLD_DELAY_MS);
}

function onPointerEnd(event: PointerEvent) {
  if (event.pointerId !== activePointerId) {
    return;
  }
  activePointerId = null;
  clearTimers();
}

function onClick() {
  if (heldRepeat) {
    // The hold already counted; consume the synthetic click.
    heldRepeat = false;
    return;
  }
  emit("count", pendingDelta);
  pendingDelta = 0;
}

const displayValue = () => props.counter.value.toLocaleString("nl-NL");
</script>

<template>
  <article class="card" @contextmenu.prevent>
    <header class="topline">
      <span class="icon" aria-hidden="true">{{ counter.icon || "🔢" }}</span>
      <h3 class="name">{{ counter.name }}</h3>
      <button
        v-if="counter.trackHistory && counter.history.length > 0"
        class="icon-btn"
        type="button"
        :aria-label="`${counter.name} statistieken`"
        @click="emit('stats')"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 3v18h18M7 15l4-6 3 3 5-7"
          />
        </svg>
      </button>
      <button
        class="edit"
        type="button"
        :aria-label="`${counter.name} bewerken`"
        @click="emit('edit')"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
          />
        </svg>
      </button>
    </header>

    <p class="value" :aria-label="`${counter.name}: ${displayValue()}`">
      {{ displayValue() }}
    </p>

    <div class="buttons">
      <button
        class="step minus"
        type="button"
        :aria-label="`${counter.name} omlaag`"
        @pointerdown="onPointerDown($event, -1)"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
        @pointerleave="onPointerEnd"
        @click="onClick"
      >
        −
      </button>
      <button
        class="step plus"
        type="button"
        :aria-label="`${counter.name} omhoog`"
        @pointerdown="onPointerDown($event, 1)"
        @pointerup="onPointerEnd"
        @pointercancel="onPointerEnd"
        @pointerleave="onPointerEnd"
        @click="onClick"
      >
        +
      </button>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.85rem;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.topline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.icon {
  font-size: 1.15rem;
  line-height: 1;
  filter: saturate(0.9);
}

.name {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #f8fafc;
}

.icon-btn,
.edit {
  appearance: none;
  border: none;
  background: transparent;
  color: #64748b;
  padding: 0.3rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex: none;
}

.icon-btn:hover,
.edit:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
}

.value {
  margin: 0;
  text-align: center;
  font-size: clamp(2.4rem, 10vw, 3.4rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.step {
  appearance: none;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
  padding: 0.75rem 0;
  cursor: pointer;
  touch-action: manipulation;
}

.minus {
  background: rgba(148, 163, 184, 0.1);
  color: #cbd5e1;
}

.minus:hover,
.minus:active {
  background: rgba(148, 163, 184, 0.2);
  color: #f8fafc;
}

.plus {
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(56, 189, 248, 0.45);
  color: #7dd3fc;
}

.plus:hover,
.plus:active {
  background: rgba(56, 189, 248, 0.3);
  color: #e0f2fe;
}

@media (min-width: 56rem) {
  .step {
    padding: 0.85rem 0;
  }
}
</style>
