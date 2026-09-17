<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** Bucketed points, chronological. */
  points: Array<{ startMs: number; value: number; events: number }>;
  /** "line" for continuous counters, "bars" for periodic (reset) counters. */
  mode: "line" | "bars";
  /** Formats the x-axis label for a bucket start. */
  xLabel: (ms: number) => string;
  /** Formats the value axis labels (defaults to compact numbers). */
  yLabel?: (value: number) => string;
}>();

const W = 600;
const H = 190;
const M = { top: 8, right: 10, bottom: 22, left: 46 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

const values = computed(() => props.points.map((point) => point.value));
const maxValue = computed(() => Math.max(1, ...values.value));
const minValue = computed(() => {
  if (props.mode === "bars") {
    return 0;
  }
  const min = Math.min(...values.value);
  return min === maxValue.value ? min - 1 : min;
});
const span = computed(() => maxValue.value - minValue.value || 1);

function y(v: number): number {
  return M.top + plotH - ((v - minValue.value) / span.value) * plotH;
}

/** 4 evenly spaced value ticks, including min and max. */
const yTicks = computed(() =>
  [0, 1, 2, 3].map((i) => minValue.value + (span.value * i) / 3),
);

const defaultYLabel = (v: number) => {
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(v));
};
const yLabel = computed(() => props.yLabel ?? defaultYLabel);

const bars = computed(() => {
  const n = props.points.length;
  if (n === 0) {
    return [] as Array<{ x: number; w: number; h: number }>;
  }
  const slot = plotW / n;
  const w = Math.max(1, slot * 0.72);
  return props.points.map((point, i) => {
    const h = (point.value / maxValue.value) * plotH;
    return { x: M.left + slot * i + (slot - w) / 2, w, h };
  });
});

const lineCoords = computed(() => {
  const n = props.points.length;
  if (n === 0) {
    return { pts: [] as Array<[number, number]>, line: "", area: "" };
  }
  const pts = props.points.map((point, i) => {
    const x = M.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    return [x, y(point.value)] as [number, number];
  });
  const line = pts.map(([x, cy]) => `${x.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `M${first[0].toFixed(1)},${M.top + plotH} L${pts
    .map(([x, cy]) => `${x.toFixed(1)},${cy.toFixed(1)}`)
    .join(" L")} L${last[0].toFixed(1)},${M.top + plotH} Z`;
  return { pts, line, area };
});

/** ~7 evenly spaced x labels, ends always included. */
const xTicks = computed(() => {
  const n = props.points.length;
  if (n === 0) {
    return [] as Array<{ label: string; x: number; anchor: string }>;
  }
  const count = Math.min(n, 7);
  return Array.from({ length: count }, (_, i) => {
    const index = Math.round((i * (n - 1)) / Math.max(count - 1, 1));
    const x = lineCoords.value.pts[index][0];
    const anchor = index === 0 ? "start" : index === n - 1 ? "end" : "middle";
    return { label: props.xLabel(props.points[index].startMs), x, anchor };
  });
});

function pointTitle(point: { startMs: number; value: number; events: number }): string {
  const date = props.xLabel(point.startMs);
  const ev = point.events === 1 ? "1 gebeurtenis" : `${point.events} gebeurtenissen`;
  return `${date} – ${point.value} (${ev})`;
}
</script>

<template>
  <div class="chart">
    <svg
      v-if="points.length > 0"
      class="plot"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      aria-label="Grafiek van de tellerwaarde in de tijd"
    >
      <g class="grid">
        <line
          v-for="tick in yTicks"
          :key="tick"
          :x1="M.left"
          :y1="y(tick)"
          :x2="W - M.right"
          :y2="y(tick)"
        />
      </g>
      <g class="y-labels">
        <text
          v-for="tick in yTicks"
          :key="tick"
          :x="M.left - 6"
          :y="y(tick) + 3"
          text-anchor="end"
        >
          {{ yLabel(tick) }}
        </text>
      </g>
      <g v-if="mode === 'bars'">
        <rect
          v-for="(bar, i) in bars"
          :key="i"
          class="bar"
          :x="bar.x"
          :y="M.top + plotH - bar.h"
          :width="bar.w"
          :height="Math.max(1, bar.h)"
          rx="1.5"
        >
          <title>{{ pointTitle(points[i]) }}</title>
        </rect>
      </g>
      <g v-else>
        <path class="area" :d="lineCoords.area" />
        <path class="line" :d="`M${lineCoords.line}`" />
        <circle
          v-for="(pt, i) in lineCoords.pts"
          :key="i"
          class="dot"
          :cx="pt[0]"
          :cy="pt[1]"
          r="2.2"
        >
          <title>{{ pointTitle(points[i]) }}</title>
        </circle>
      </g>
      <g class="x-labels">
        <text
          v-for="(tick, i) in xTicks"
          :key="i"
          :x="tick.x"
          :y="H - 5"
          :text-anchor="tick.anchor"
        >
          {{ tick.label }}
        </text>
      </g>
    </svg>
    <div v-else class="empty-chart">Nog geen geschiedenis om weer te geven.</div>
  </div>
</template>

<style scoped>
.chart {
  display: grid;
}

.plot {
  width: 100%;
  height: 12rem;
  display: block;
}

.grid line {
  stroke: rgba(148, 163, 184, 0.14);
  stroke-width: 1;
}

.y-labels text,
.x-labels text {
  fill: #64748b;
  font-size: 11px;
  font-weight: 600;
}

.x-labels text {
  fill: #94a3b8;
}

.area {
  fill: rgba(56, 189, 248, 0.14);
}

.line {
  fill: none;
  stroke: #38bdf8;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: #7dd3fc;
}

.bar {
  fill: #38bdf8;
  opacity: 0.85;
}

.empty-chart {
  display: grid;
  place-items: center;
  height: 12rem;
  font-size: 0.88rem;
  color: #64748b;
}
</style>
