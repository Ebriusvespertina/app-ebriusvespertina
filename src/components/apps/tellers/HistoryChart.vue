<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** Value at the first point; the curve starts here. */
  anchor: number;
  /** Cumulative values per bucket, chronological. */
  points: Array<{ key: string; cumulative: number }>;
  /** Display label per point, parallel to points. */
  labels: string[];
}>();

const W = 600;
const H = 170;
const PAD = 10;

const min = computed(() =>
  Math.min(props.anchor, ...props.points.map((point) => point.cumulative)),
);
const max = computed(() =>
  Math.max(props.anchor, ...props.points.map((point) => point.cumulative)),
);
const span = computed(() => max.value - min.value || 1);

const coords = computed(() => {
  const n = props.points.length;
  if (n === 0) {
    return { pts: [] as Array<[number, number]>, line: "", area: "" };
  }
  const pts = props.points.map((point, i) => {
    const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - PAD - ((point.cumulative - min.value) / span.value) * (H - 2 * PAD);
    return [x, y] as [number, number];
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `M${first[0].toFixed(1)},${H} L${pts
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" L")} L${last[0].toFixed(1)},${H} Z`;
  return { pts, line, area };
});

const shownLabels = computed(() => {
  const n = props.points.length;
  if (n === 0) {
    return [] as Array<{ label: string; left: number }>;
  }
  const indexes =
    n <= 6 ? props.points.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
  return indexes.map((i) => ({
    label: props.labels[i],
    left: ((coords.value.pts[i][0] - PAD) / (W - 2 * PAD)) * 100,
  }));
});

const baselineY = computed(() =>
  H - PAD - ((min.value - min.value) / span.value) * (H - 2 * PAD),
);
</script>

<template>
  <div class="chart">
    <svg
      v-if="points.length > 0"
      class="plot"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      aria-label="Grafiek van de tellerwaarde in de tijd"
    >
      <path
        class="area"
        :d="coords.area"
        vector-effect="non-scaling-stroke"
      />
      <line
        class="baseline"
        :x1="0"
        :y1="baselineY"
        :x2="W"
        :y2="baselineY"
        vector-effect="non-scaling-stroke"
      />
      <polyline
        class="line"
        :points="coords.line"
        vector-effect="non-scaling-stroke"
      />
      <circle
        v-if="points.length === 1"
        class="dot"
        :cx="coords.pts[0][0]"
        :cy="coords.pts[0][1]"
        r="4"
      />
    </svg>
    <div v-else class="empty-chart">Nog geen geschiedenis om weer te geven.</div>
    <div v-if="shownLabels.length > 0" class="labels">
      <span
        v-for="(item, i) in shownLabels"
        :key="i"
        class="label"
        :style="{ left: `${item.left}%` }"
      >
        {{ item.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  display: grid;
  gap: 0.35rem;
}

.plot {
  width: 100%;
  height: 10.5rem;
  display: block;
}

.area {
  fill: rgba(56, 189, 248, 0.18);
}

.line {
  fill: none;
  stroke: #38bdf8;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.baseline {
  stroke: rgba(148, 163, 184, 0.25);
  stroke-width: 1;
  stroke-dasharray: 3 4;
}

.dot {
  fill: #7dd3fc;
}

.labels {
  position: relative;
  height: 1.1rem;
}

.label {
  position: absolute;
  transform: translateX(-50%);
  font-size: 0.7rem;
  font-weight: 600;
  color: #94a3b8;
  white-space: nowrap;
}

.label:first-child {
  transform: translateX(0);
}

.label:last-child {
  transform: translateX(-100%);
}

.empty-chart {
  display: grid;
  place-items: center;
  height: 10.5rem;
  font-size: 0.88rem;
  color: #64748b;
}
</style>
