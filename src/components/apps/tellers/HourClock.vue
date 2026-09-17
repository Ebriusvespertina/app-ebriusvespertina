<script setup lang="ts">
import { computed, ref, watch } from "vue";

/** A last.fm-style 24-hour clock: one wedge per hour of day, starting at
    00:00 (top) and ending just before 23:59, going clockwise. Wedge length
    and colour scale with the count for that hour. */
const props = defineProps<{
  /** Event counts per hour of day (length 24). */
  counts: number[];
}>();

const S = 250;
const C = S / 2;
const R_BASE = 46;
const R_MAX = 102;
const R_LABEL = 118;

const max = computed(() => Math.max(1, ...props.counts));
const peakHour = computed(() => {
  let best = 0;
  for (let h = 1; h < 24; h += 1) {
    if (props.counts[h] > props.counts[best]) {
      best = h;
    }
  }
  return best;
});
const activeHour = ref(peakHour.value);
const userPicked = ref(false);

/* Until the user picks an hour the selection follows the peak, including when
   the data changes later. */
watch(peakHour, (peak) => {
  if (!userPicked.value) {
    activeHour.value = peak;
  }
});

function selectHour(hour: number) {
  userPicked.value = true;
  activeHour.value = hour;
}

function onWedgeKeydown(event: KeyboardEvent, hour: number) {
  let next = hour;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    next = (hour + 1) % 24;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    next = (hour + 23) % 24;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = 23;
  } else {
    return;
  }

  event.preventDefault();
  selectHour(next);
  document.querySelector<SVGGElement>(`[data-wedge="${next}"]`)?.focus();
}

function pt(r: number, a: number): [number, number] {
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function angleFor(hour: number): [number, number] {
  const a0 = (hour / 24) * Math.PI * 2 - Math.PI / 2;
  return [a0, a0 + (Math.PI * 2) / 24];
}

function sectorPath(hour: number): string {
  const count = props.counts[hour] || 0;
  const [a0, a1] = angleFor(hour);
  // A thin base segment keeps every hour visible and tappable.
  const rOut = R_BASE + 5 + (count / max.value) * (R_MAX - R_BASE - 5);
  const [x0, y0] = pt(R_BASE, a0);
  const [x1, y1] = pt(rOut, a0);
  const [x2, y2] = pt(rOut, a1);
  const [x3, y3] = pt(R_BASE, a1);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} A${rOut.toFixed(1)},${rOut.toFixed(1)} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${x3.toFixed(1)},${y3.toFixed(1)} A${R_BASE},${R_BASE} 0 0 0 ${x0.toFixed(1)},${y0.toFixed(1)} Z`;
}

function colorFor(hour: number): string {
  const count = props.counts[hour] || 0;
  const a = count === 0 ? 0.05 : 0.15 + (count / max.value) * 0.85;
  return `rgba(56, 189, 248, ${a.toFixed(3)})`;
}

const labelPositions = computed(() =>
  Array.from({ length: 24 }, (_, hour) => {
    const [a0] = angleFor(hour);
    const mid = a0 + (Math.PI * 2) / 48;
    const x = C + Math.cos(mid) * R_LABEL;
    const y = C + Math.sin(mid) * R_LABEL;
    const cos = Math.cos(mid);
    const anchor = cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle";
    return { x, y, anchor, label: String(hour) };
  }),
);

const activeCount = computed(() => props.counts[activeHour.value] || 0);
</script>

<template>
  <div class="clock-wrap">
    <svg
      :viewBox="`0 0 ${S} ${S}`"
      class="clock"
      role="group"
      aria-label="Verdeling per uur"
    >
      <circle class="face" :cx="C" :cy="C" :r="R_MAX" />
      <circle class="mid" :cx="C" :cy="C" :r="R_BASE" fill="none" />
      <g>
        <g
          v-for="hour in 24"
          :key="hour - 1"
          :data-wedge="hour - 1"
          role="button"
          :tabindex="activeHour === hour - 1 ? 0 : -1"
          :aria-label="`${hour - 1}:00 – ${counts[hour - 1] || 0} gebeurtenissen`"
          @pointerdown="selectHour(hour - 1)"
          @focus="selectHour(hour - 1)"
          @keydown="onWedgeKeydown($event, hour - 1)"
        >
          <path
            :d="sectorPath(hour - 1)"
            :fill="colorFor(hour - 1)"
            :class="{ active: activeHour === hour - 1 }"
          />
          <title>{{ hour - 1 }}:00 – {{ counts[hour - 1] || 0 }} gebeurtenissen</title>
        </g>
      </g>
      <g class="labels" aria-hidden="true">
        <text
          v-for="(lp, i) in labelPositions"
          :key="i"
          :x="lp.x"
          :y="lp.y"
          :text-anchor="lp.anchor"
          dominant-baseline="middle"
        >
          {{ lp.label }}
        </text>
      </g>
      <text class="center-hour" :x="C" :y="C - 4" text-anchor="middle" aria-hidden="true">
        {{ String(activeHour).padStart(2, "0") }}:00
      </text>
      <text class="center-count" :x="C" :y="C + 18" text-anchor="middle" aria-hidden="true">
        {{ activeCount }}
      </text>
    </svg>
    <p class="clock-note">Tik op een uur voor het aantal gebeurtenissen.</p>
    <p class="sr-only" role="status">
      {{ String(activeHour).padStart(2, "0") }}:00 – {{ activeCount }} gebeurtenissen
    </p>
  </div>
</template>

<style scoped>
.clock-wrap {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
}

.clock {
  width: min(100%, 16rem);
  height: auto;
  display: block;
  touch-action: manipulation;
}

.face {
  fill: rgba(2, 6, 23, 0.45);
}

.mid {
  stroke: rgba(148, 163, 184, 0.18);
  stroke-width: 1;
}

path.active {
  stroke: #f8fafc;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.clock g[role="button"] {
  cursor: pointer;
}

.clock g[role="button"]:focus-visible {
  outline: none;
}

.clock g[role="button"]:focus-visible path {
  stroke: #7dd3fc;
  stroke-width: 2;
  stroke-linejoin: round;
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

.labels text {
  fill: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.center-hour {
  fill: #e2e8f0;
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.center-count {
  fill: #7dd3fc;
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.clock-note {
  margin: 0;
  font-size: 0.72rem;
  color: #94a3b8;
}
</style>
