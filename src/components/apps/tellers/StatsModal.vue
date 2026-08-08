<script setup lang="ts">
import { computed } from "vue";
import ModalShell from "./ModalShell.vue";
import HistoryChart from "./HistoryChart.vue";
import type { Counter } from "./types";
import { counterStats, historySeries } from "./countersEngine";

const props = defineProps<{
  counter: Counter;
}>();

const emit = defineEmits<{ clearHistory: []; close: [] }>();

const stats = computed(() => counterStats(props.counter));
const series = computed(() => historySeries(props.counter));

const chartLabels = computed(() =>
  series.value.points.map((point) => {
    const [datePart, hourPart] = point.key.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    if (hourPart === undefined) {
      return new Date(y, m - 1, d).toLocaleDateString("nl-NL", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    }
    return new Date(y, m - 1, d, Number(hourPart)).toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }),
);

function dateTimeLabel(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

function dayLabel(key: string | null) {
  if (!key) {
    return "—";
  }
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

function hourLabel(key: string | null) {
  if (!key) {
    return "—";
  }
  const [datePart, hourPart] = key.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d, Number(hourPart)).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const formatNumber = (value: number) => value.toLocaleString("nl-NL");
</script>

<template>
  <ModalShell :title="`${counter.icon || '🔢'} ${counter.name}`" @close="emit('close')">
    <template v-if="stats.eventCount > 0">
      <dl class="stats">
        <div class="tile">
          <dt>Huidige waarde</dt>
          <dd class="big">{{ formatNumber(counter.value) }}</dd>
        </div>
        <div class="tile">
          <dt>Netto</dt>
          <dd :class="stats.net >= 0 ? 'plus' : 'minus'">
            {{ stats.net >= 0 ? "+" : "" }}{{ formatNumber(stats.net) }}
          </dd>
        </div>
        <div class="tile">
          <dt>+ Totaal</dt>
          <dd class="plus">+{{ formatNumber(stats.totalPlus) }}</dd>
        </div>
        <div class="tile">
          <dt>− Totaal</dt>
          <dd class="minus">{{ formatNumber(stats.totalMinus) }}</dd>
        </div>
        <div class="tile">
          <dt>Gebeurtenissen</dt>
          <dd>{{ formatNumber(stats.eventCount) }}</dd>
        </div>
        <div class="tile">
          <dt>Actiefste dag</dt>
          <dd class="wrap">{{ dayLabel(stats.busiestDayKey) }}</dd>
        </div>
        <div class="tile">
          <dt>Actiefste uur</dt>
          <dd class="wrap">{{ hourLabel(stats.busiestHourKey) }}</dd>
        </div>
        <div class="tile">
          <dt>Eerste / laatste</dt>
          <dd class="wrap small">{{ dateTimeLabel(stats.firstAt) }} → {{ dateTimeLabel(stats.lastAt) }}</dd>
        </div>
      </dl>

      <div class="chart-panel">
        <HistoryChart
          :anchor="series.anchor"
          :points="series.points"
          :labels="chartLabels"
        />
      </div>
    </template>

    <p v-else class="no-history">
      Deze teller heeft nog geen opgeslagen geschiedenis. Zet "Geschiedenis
      bijhouden" aan in de tellerinstellingen om hier statistieken te zien.
    </p>

    <template #footer>
      <button
        v-if="stats.eventCount > 0"
        class="btn danger"
        type="button"
        @click="emit('clearHistory')"
      >
        Geschiedenis wissen
      </button>
      <span class="spacer" />
      <button class="btn ghost" type="button" @click="emit('close')">
        Sluiten
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin: 0 0 0.8rem;
}

.tile {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem;
  background: rgba(2, 6, 23, 0.4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.tile dt {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.tile dd {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 800;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.tile dd.big {
  font-size: 1.35rem;
}

.tile dd.plus {
  color: #7dd3fc;
}

.tile dd.minus {
  color: #fca5a5;
}

.tile dd.wrap {
  font-size: 0.82rem;
  line-height: 1.35;
  font-weight: 700;
}

.tile dd.small {
  font-weight: 600;
  color: #cbd5e1;
}

.chart-panel {
  padding: 0.6rem 0.4rem 0.2rem;
  border-top: 1px solid var(--border-subtle);
}

.no-history {
  margin: 0.4rem 0 0.2rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: #94a3b8;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.55rem 1rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
}

.ghost:hover {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.9);
}

.danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.danger:hover {
  background: rgba(239, 68, 68, 0.28);
}

.spacer {
  flex: 1;
}
</style>
