<script setup lang="ts">
const HOLD_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;

const props = withDefaults(
  defineProps<{
    delta: number;
    label: string;
    size?: "sm" | "lg";
  }>(),
  { size: "sm" },
);

const emit = defineEmits<{ count: [delta: number] }>();

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
function onPointerDown(event: PointerEvent) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  if (activePointerId !== null) {
    return;
  }
  activePointerId = event.pointerId;
  pendingDelta = props.delta;
  heldRepeat = false;
  clearTimers();
  holdTimer = window.setTimeout(() => {
    holdTimer = null;
    heldRepeat = true;
    emit("count", props.delta);
    repeatTimer = window.setInterval(() => emit("count", props.delta), REPEAT_INTERVAL_MS);
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
    heldRepeat = false;
    return;
  }
  emit("count", pendingDelta);
  pendingDelta = 0;
}
</script>

<template>
  <button
    type="button"
    class="step"
    :class="[delta < 0 ? 'minus' : 'plus', size]"
    :aria-label="label"
    @pointerdown="onPointerDown"
    @pointerup="onPointerEnd"
    @pointercancel="onPointerEnd"
    @pointerleave="onPointerEnd"
    @click.stop="onClick"
  >
    <slot>{{ delta < 0 ? "−" : "+" }}</slot>
  </button>
</template>

<style scoped>
.step {
  appearance: none;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  font: inherit;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.sm {
  font-size: 1.5rem;
  padding: 0.75rem 0;
}

.lg {
  font-size: 2rem;
  padding: 1.1rem 0;
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
</style>
