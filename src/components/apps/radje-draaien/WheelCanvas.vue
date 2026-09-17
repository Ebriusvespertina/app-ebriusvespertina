<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Choice } from "./types";
import { makeSlicePath, pointOnCircle, shortenLabel } from "./wheelEngine";

const props = defineProps<{
  choices: Choice[];
  palette: string[];
  rotation: number;
  spinning: boolean;
  spinDurationMs: number;
}>();

const emit = defineEmits<{
  spin: [];
  spinEnd: [];
  activeOption: [label: string];
}>();

const wheelRotorRef = ref<HTMLElement | null>(null);
let rafId: number | null = null;

// Labels stack upright along each slice's bisector, from the rim inward,
// staying clear of the center hub (radius ~13).
const LABEL_INNER = 16;
const LABEL_OUTER = 46;
const SLICE_RADIUS = 48.5;

const segments = computed(() => {
  const total = props.choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total <= 0) return [];

  const availableRadial = LABEL_OUTER - LABEL_INNER;

  let startDeg = 0;
  return props.choices.map((choice, index) => {
    const sliceDeg = (choice.weight / total) * 360;
    const endDeg = startDeg + sliceDeg;
    const color = props.palette[index % props.palette.length];
    const midDeg = startDeg + sliceDeg / 2;

    let maxChars = 11;
    if (sliceDeg < 18) {
      maxChars = 5;
    } else if (sliceDeg < 28) {
      maxChars = 8;
    }

    const label = shortenLabel(choice.label, maxChars);
    const visibleChars = Math.max(label.replaceAll(/\s+/g, "").length, 1);
    const charStep = availableRadial / visibleChars;
    const fontSize = Math.max(2, Math.min(4.2, charStep * 1.1));
    // A single upright word, rotated 90° so it runs along the slice's
    // bisector. Anchored at the radial midpoint and rotated by the slice
    // angle + 90°, every label shares one consistent orientation — no more
    // per-character drifting. (text-anchor="middle" keeps it centred.)
    const midRadial = (LABEL_INNER + LABEL_OUTER) / 2;
    const labelPos = pointOnCircle(midDeg, midRadial);
    const labelRot = midDeg + 90;

    const segment = {
      key: choice.id,
      color,
      path: makeSlicePath(startDeg, endDeg, SLICE_RADIUS),
      midDeg,
      label,
      fontSize,
      labelX: labelPos.x,
      labelY: labelPos.y,
      labelRot,
      showLabel: sliceDeg >= 6,
    };

    startDeg = endDeg;
    return segment;
  });
});

function onSpinRequest() {
  if (!props.spinning) {
    emit("spin");
  }
}

function onTransitionEnd(event: TransitionEvent) {
  if (event.target !== wheelRotorRef.value) {
    return;
  }
  if (event.propertyName && event.propertyName !== "transform") {
    return;
  }
  emit("spinEnd");
}

function getRotationFromElement(el: HTMLElement) {
  const transform = globalThis.getComputedStyle(el).transform;
  if (!transform || transform === "none") {
    return ((props.rotation % 360) + 360) % 360;
  }

  const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
  if (!matrixMatch) {
    return ((props.rotation % 360) + 360) % 360;
  }

  const values = matrixMatch[1].split(",").map((value) => Number(value.trim()));
  const [a, b] = values;
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  return (angle + 360) % 360;
}

function getActiveLabelAtRotation(rotation: number) {
  if (!props.choices.length) {
    return "";
  }

  const total = props.choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total <= 0) {
    return "";
  }

  const pointerAngle = (360 - rotation + 360) % 360;
  let start = 0;

  for (const choice of props.choices) {
    const span = (choice.weight / total) * 360;
    const end = start + span;
    if (pointerAngle >= start && pointerAngle < end) {
      return choice.label;
    }
    start = end;
  }

  return props.choices[props.choices.length - 1].label;
}

function tickActiveOption() {
  if (!props.spinning || !wheelRotorRef.value) {
    rafId = null;
    return;
  }

  const rotation = getRotationFromElement(wheelRotorRef.value);
  const active = getActiveLabelAtRotation(rotation);
  if (active) {
    emit("activeOption", active);
  }

  rafId = requestAnimationFrame(tickActiveOption);
}

watch(
  () => props.spinning,
  (spinning) => {
    if (spinning) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(tickActiveOption);
      return;
    }

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  },
);

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
});
</script>

<template>
  <div class="wheel-box">
    <svg class="filter-defs" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <filter
          id="wheel-zoom-blur"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          color-interpolation-filters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.1" result="blur" />
          <feTransformMatrix
            type="matrix"
            values="1.03 0 0 1.03 -1.5 -1.5"
            in="blur"
            result="scale1"
          />
          <feTransformMatrix
            type="matrix"
            values="1.06 0 0 1.06 -3 -3"
            in="blur"
            result="scale2"
          />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="blur" />
            <feMergeNode in="scale1" />
            <feMergeNode in="scale2" />
          </feMerge>
        </filter>
      </defs>
    </svg>
    <svg class="pointer" viewBox="0 0 36 30" aria-hidden="true">
      <path
        d="M18 29 C13.5 20.5 5 14 2.5 8 C1.8 4.5 4 2 7.5 2.6 L18 5.5 L28.5 2.6 C32 2 34.2 4.5 33.5 8 C31 14 22.5 20.5 18 29 Z"
        fill="#f8fafc"
        stroke="#0f172a"
        stroke-width="2"
      />
    </svg>

    <button
      class="wheel"
      type="button"
      aria-label="Draai het rad"
      @click="onSpinRequest"
    >
      <div
        ref="wheelRotorRef"
        class="wheel-rotor"
        :class="{ spinning }"
        :style="{
          transform: `rotate(${rotation}deg)`,
          transitionDuration: `${spinning ? spinDurationMs : 0}ms`,
          animationDuration: spinning ? `${spinDurationMs}ms` : undefined,
        }"
        @transitionend="onTransitionEnd"
      >
        <svg class="wheel-svg" viewBox="0 0 100 100" aria-hidden="true">
          <g v-for="segment in segments" :key="segment.key">
            <path
              :d="segment.path"
              :fill="segment.color"
              stroke="#0f172a"
              stroke-width="1"
              stroke-linejoin="round"
            />
            <text
              v-if="segment.showLabel"
              class="wheel-segment-label"
              :x="segment.labelX"
              :y="segment.labelY"
              :transform="`rotate(${segment.labelRot} ${segment.labelX} ${segment.labelY})`"
              :style="{ fontSize: `${segment.fontSize}px` }"
              text-anchor="middle"
              dominant-baseline="central"
            >
              {{ segment.label }}
            </text>
          </g>
        </svg>
        <svg
          v-if="spinning"
          class="wheel-svg wheel-blur-layer"
          viewBox="0 0 100 100"
          aria-hidden="true"
          :style="{
            animationDuration: `${spinDurationMs}ms`,
          }"
        >
          <g v-for="segment in segments" :key="segment.key">
            <path
              :d="segment.path"
              :fill="segment.color"
              stroke="#0f172a"
              stroke-width="1"
              stroke-linejoin="round"
            />
          </g>
        </svg>
      </div>
      <span class="wheel-hub" aria-hidden="true"></span>
      <span class="wheel-shine" aria-hidden="true"></span>
    </button>

    <button
      class="spin"
      type="button"
      :disabled="spinning"
      aria-label="Draai het rad"
      @click="onSpinRequest"
    >
      <span class="spin-label">DRAAI</span>
    </button>
  </div>
</template>

<style scoped>
.wheel-box {
  position: relative;
  width: min(100%, clamp(14rem, 82vw, 24rem));
  min-width: 0;
  aspect-ratio: 1;
  margin-inline: auto;
}

.filter-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.pointer {
  position: absolute;
  top: -0.9rem;
  left: 50%;
  transform: translateX(-50%);
  width: 2rem;
  height: auto;
  z-index: 5;
  filter: drop-shadow(0 5px 9px rgba(2, 6, 23, 0.5));
  pointer-events: none;
}

.wheel {
  appearance: none;
  -webkit-appearance: none;
  display: block;
  padding: 0;
  margin: 0;
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  border: none;
  box-shadow:
    var(--shadow-wheel),
    inset 0 0 0 3px rgba(248, 250, 252, 0.55),
    inset 0 0 0 7px rgba(15, 23, 42, 0.85),
    inset 0 0 0 10px rgba(248, 250, 252, 0.1);
  cursor: pointer;
  touch-action: manipulation;
}

.wheel:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 3px;
}

.wheel-rotor {
  position: absolute;
  inset: 0;
  transition: transform 4.6s cubic-bezier(0.15, 0.8, 0.1, 1);
}

/* Radial (zoom) blur: a copy of the segments only — no labels — is smeared
   outward with an SVG feGaussianBlur + scaled-layer filter while the wheel
   spins fast, then fades out as it decelerates. Labels stay crisp because
   they only exist on the sharp base layer. */
.wheel-blur-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  filter: url(#wheel-zoom-blur);
}

.wheel-rotor.spinning .wheel-blur-layer {
  animation-name: wheel-zoom-fade;
  animation-timing-function: cubic-bezier(0.15, 0.8, 0.1, 1);
  animation-fill-mode: forwards;
}

@keyframes wheel-zoom-fade {
  from {
    opacity: 0.9;
  }
  to {
    opacity: 0;
  }
}

.wheel-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.wheel-segment-label {
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  fill: #f8fafc;
  paint-order: stroke;
  stroke: rgba(2, 6, 23, 0.7);
  stroke-width: 0.9px;
  stroke-linejoin: round;
  pointer-events: none;
}

.wheel-hub {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 26%;
  aspect-ratio: 1;
  border-radius: 999px;
  background: radial-gradient(circle at 40% 32%, #1e293b, #020617 72%);
  box-shadow:
    inset 0 0 0 2px rgba(2, 6, 23, 0.95),
    inset 0 0 14px rgba(2, 6, 23, 0.85),
    0 3px 12px rgba(2, 6, 23, 0.45);
  z-index: 2;
  pointer-events: none;
}

.wheel-shine {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  pointer-events: none;
  z-index: 2;
  background:
    radial-gradient(
      circle at 32% 26%,
      rgba(255, 255, 255, 0.16),
      transparent 42%
    ),
    radial-gradient(circle at 72% 82%, rgba(2, 6, 23, 0.3), transparent 55%);
}

.spin {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
  border: none;
  border-radius: 999px;
  aspect-ratio: 1;
  min-width: 4.6rem;
  padding: 0 1.1rem;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff;
  background: linear-gradient(135deg, #fb7185, #e11d48);
  box-shadow:
    0 8px 20px rgba(244, 63, 94, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    transform 0.1s ease,
    opacity 0.15s ease,
    filter 0.15s ease;
}

.spin-label {
  display: inline-block;
}

.spin:active:not(:disabled) {
  transform: translate(-50%, -50%) scale(0.94);
}

.spin:hover:not(:disabled) {
  filter: brightness(1.08);
}

.spin:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

@media (max-width: 31rem) {
  .wheel-box {
    width: min(100%, 88vw);
  }

  .spin {
    min-width: 4.1rem;
    padding: 0 0.9rem;
    font-size: 0.74rem;
  }

  .pointer {
    width: 1.7rem;
    top: -0.75rem;
  }
}
</style>
