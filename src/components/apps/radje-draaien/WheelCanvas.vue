<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Choice } from "./types";
import { makeSlicePath, shortenLabel } from "./wheelEngine";

const props = defineProps<{
  choices: Choice[];
  palette: string[];
  rotation: number;
  spinning: boolean;
}>();

const emit = defineEmits<{
  spin: [];
  spinEnd: [];
  activeOption: [label: string];
}>();

const wheelRotorRef = ref<HTMLElement | null>(null);
let rafId: number | null = null;
const LABEL_START_Y = 16;
const LABEL_END_Y = 43;

const segments = computed(() => {
  const total = props.choices.reduce((sum, choice) => sum + choice.weight, 0);
  if (total <= 0) return [];

  const availableVertical = LABEL_END_Y - LABEL_START_Y;

  let startDeg = 0;
  return props.choices.map((choice, index) => {
    const sliceDeg = (choice.weight / total) * 360;
    const endDeg = startDeg + sliceDeg;
    const color = props.palette[index % props.palette.length];
    const midDeg = startDeg + sliceDeg / 2;
    let maxChars = 12;
    if (sliceDeg < 18) {
      maxChars = 6;
    } else if (sliceDeg < 30) {
      maxChars = 9;
    }

    const label = shortenLabel(choice.label, maxChars);
    const visibleChars = Math.max(label.replaceAll(/\s+/g, "").length, 1);
    const maxFontByHeight = availableVertical / (visibleChars * 1.2);
    const fontSize = Math.max(1.8, Math.min(3, maxFontByHeight));

    const segment = {
      key: choice.id,
      color,
      path: makeSlicePath(startDeg, endDeg, 49),
      midDeg,
      label,
      fontSize,
      showLabel: sliceDeg >= 8,
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
    <div class="pointer" aria-hidden="true"></div>

    <button
      class="wheel"
      type="button"
      aria-label="Draai het rad"
      @click="onSpinRequest"
    >
      <div
        ref="wheelRotorRef"
        class="wheel-rotor"
        :style="{ transform: `rotate(${rotation}deg)` }"
        @transitionend="emit('spinEnd')"
      >
        <svg class="wheel-svg" viewBox="0 0 100 100" aria-hidden="true">
          <g v-for="segment in segments" :key="segment.key">
            <path :d="segment.path" :fill="segment.color" />
            <text
              v-if="segment.showLabel"
              class="wheel-segment-label"
              x="50"
              :y="LABEL_START_Y"
              :transform="`rotate(${segment.midDeg} 50 50)`"
              :style="{ fontSize: `${segment.fontSize}px` }"
            >
              {{ segment.label }}
            </text>
          </g>
        </svg>
      </div>
    </button>

    <button
      class="spin"
      type="button"
      :disabled="spinning"
      @click="onSpinRequest"
    >
      SPIN
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

.pointer {
  position: absolute;
  top: -0.75rem;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 0.55rem solid transparent;
  border-right: 0.55rem solid transparent;
  border-top: 0.95rem solid #f8fafc;
  filter: drop-shadow(0 6px 10px rgba(2, 6, 23, 0.45));
  z-index: 4;
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
    inset 0 0 0 6px rgba(248, 250, 252, 0.14),
    inset 0 0 0 8px rgba(15, 23, 42, 0.65);
  cursor: pointer;
  touch-action: manipulation;
}

.wheel-rotor {
  position: absolute;
  inset: 0;
  transition: transform 4.6s cubic-bezier(0.15, 0.8, 0.1, 1);
}

.wheel-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.wheel-segment-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
  fill: #f8fafc;
  paint-order: stroke;
  stroke: rgba(2, 6, 23, 0.65);
  stroke-width: 0.8px;
  stroke-linejoin: round;
  text-anchor: middle;
  dominant-baseline: hanging;
  writing-mode: vertical-rl;
  text-orientation: upright;
  pointer-events: none;
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
  padding: 0.95rem 1.15rem;
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  background: #e2e8f0;
  color: #0f172a;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.38);
  cursor: pointer;
}

.spin:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

@media (max-width: 31rem) {
  .wheel-box {
    width: min(100%, 88vw);
  }

  .spin {
    padding: 0.8rem 1rem;
    font-size: 0.84rem;
  }
}
</style>
