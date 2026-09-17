<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import HistoryChart from "./HistoryChart.vue";
import HoldButton from "./HoldButton.vue";
import HourClock from "./HourClock.vue";
import type { Category, Counter, ResetPeriod } from "./types";
import {
  MAX_VALUE,
  MIN_VALUE,
  RESET_PERIOD_LABELS,
  counterStats,
  effectiveValue,
  historyWindow,
  periodRows,
  weekdayHourCounts,
} from "./countersEngine";
import type { BucketPrecision, PeriodMode } from "./countersEngine";

const props = defineProps<{
  counter: Counter;
  categories: Category[];
  nowMs: number;
}>();

const emit = defineEmits<{
  count: [delta: number];
  save: [
    payload: {
      name: string;
      icon: string;
      value: number;
      categoryId: string | null;
      resetPeriod: ResetPeriod;
      periodStart: number | null;
    },
  ];
  delete: [id: string];
  clearHistory: [];
  close: [];
}>();

const DAY_NAMES = ["ma", "di", "wo", "do", "vr", "za", "zo"];

const dialogEl = ref<HTMLElement | null>(null);

/* Parts of a counter: the counting surface, the numbers and charts, and
   management. */
const TABS = ["counter", "stats", "settings"] as const;
type TabId = (typeof TABS)[number];
const activeTab = ref<TabId>("counter");

function onTabKeydown(event: KeyboardEvent, id: TabId) {
  const index = TABS.indexOf(id);
  let next = index;

  if (event.key === "ArrowRight") {
    next = (index + 1) % TABS.length;
  } else if (event.key === "ArrowLeft") {
    next = (index - 1 + TABS.length) % TABS.length;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = TABS.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const target = TABS[next];
  activeTab.value = target;
  void nextTick(() => document.getElementById(`tab-${target}`)?.focus());
}

const now = computed(() => new Date(props.nowMs));
const display = computed(() => effectiveValue(props.counter, now.value));
const stats = computed(() => counterStats(props.counter));
const chartMode = computed(() => (props.counter.resetPeriod === "none" ? "line" : "bars"));
const cycleLabel = computed(() => RESET_PERIOD_LABELS[props.counter.resetPeriod]);

// ---- heatmap ----
const heatmap = computed(() => weekdayHourCounts(props.counter));
const heatmapMax = computed(() => Math.max(1, ...heatmap.value.flat()));
const rowTotals = computed(() => heatmap.value.map((row) => row.reduce((sum, c) => sum + c, 0)));
const colTotals = computed(() => {
  const cols = new Array<number>(24).fill(0);
  for (const row of heatmap.value) {
    for (let h = 0; h < 24; h += 1) {
      cols[h] += row[h];
    }
  }
  return cols;
});
const selectedCell = ref<{ weekday: number; hour: number } | null>(null);
/** "grid" = dag × uur heatmap, "clock" = 24-uurs radiale weergave. */
const heatView = ref<"grid" | "clock">("grid");
const cellCount = computed(() =>
  selectedCell.value ? heatmap.value[selectedCell.value.weekday][selectedCell.value.hour] : 0,
);
const hourAvg = computed(() =>
  selectedCell.value ? colTotals.value[selectedCell.value.hour] / 7 : 0,
);
const dayAvg = computed(() =>
  selectedCell.value ? rowTotals.value[selectedCell.value.weekday] / 24 : 0,
);

function selectCell(weekday: number, hour: number) {
  selectedCell.value =
    selectedCell.value?.weekday === weekday && selectedCell.value.hour === hour
      ? null
      : { weekday, hour };
}

/* One tab stop for the whole heatmap, arrows move between cells: otherwise all
   168 cells sit in the tab order. */
const focusedCell = ref<{ weekday: number; hour: number }>({ weekday: 0, hour: 0 });

function onCellKeydown(event: KeyboardEvent, weekday: number, hour: number) {
  let nextWeekday = weekday;
  let nextHour = hour;

  if (event.key === "ArrowRight") {
    nextHour = (hour + 1) % 24;
  } else if (event.key === "ArrowLeft") {
    nextHour = (hour + 23) % 24;
  } else if (event.key === "ArrowDown") {
    nextWeekday = (weekday + 1) % 7;
  } else if (event.key === "ArrowUp") {
    nextWeekday = (weekday + 6) % 7;
  } else if (event.key === "Home") {
    nextHour = 0;
  } else if (event.key === "End") {
    nextHour = 23;
  } else {
    return;
  }

  event.preventDefault();
  focusedCell.value = { weekday: nextWeekday, hour: nextHour };
  document.querySelector<HTMLButtonElement>(`[data-cell="${nextWeekday}-${nextHour}"]`)?.focus();
}

function heatIntensity(count: number): number {
  return count === 0 ? 0 : 0.08 + (count / heatmapMax.value) * 0.85;
}

function formatAvg(value: number): string {
  return value.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
}

// ---- period overview ----
const PERIOD_CONFIG: Record<PeriodMode, { limit: number; label: string }> = {
  day: { limit: 14, label: "Dag" },
  week: { limit: 8, label: "Week" },
  month: { limit: 12, label: "Maand" },
};
const periodMode = ref<PeriodMode>("day");
const periods = computed(() =>
  periodRows(props.counter, periodMode.value, PERIOD_CONFIG[periodMode.value].limit),
);
const periodMax = computed(() => Math.max(1, ...periods.value.map((row) => row.events)));

function periodLabel(row: { key: string }): string {
  const [y, m, d] = row.key.split("-").map(Number);
  const mode = periodMode.value;
  if (mode === "day") {
    return new Date(y, m - 1, d).toLocaleDateString("nl-NL", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }
  if (mode === "week") {
    const start = new Date(y, m - 1, d);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`;
  }
  return new Date(y, m - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}

function dayLabel(key: string | null): string {
  if (!key) {
    return "—";
  }
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function hourLabel(key: string | null): string {
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

function setResetPeriod(mode: ResetPeriod) {
  form.resetPeriod = mode;
  if (mode === "none") {
    periodStartText.value = "";
  }
}

// ---- chart: zoom, precision and time navigation ----
const ZOOMS = [
  { id: "24h", label: "24 uur", spanMs: 24 * 3_600_000, precisions: ["15m", "1h"] },
  { id: "7d", label: "7 dagen", spanMs: 7 * 86_400_000, precisions: ["1h", "6h", "1d"] },
  { id: "1m", label: "1 maand", spanMs: 30 * 86_400_000, precisions: ["1d", "1w"] },
  { id: "1y", label: "1 jaar", spanMs: 365 * 86_400_000, precisions: ["1d", "1w", "1M"] },
] as const;
type ZoomId = (typeof ZOOMS)[number]["id"];

const PRECISION_LABELS: Record<BucketPrecision, string> = {
  "15m": "15 min",
  "1h": "uur",
  "6h": "6 uur",
  "1d": "dag",
  "1w": "week",
  "1M": "maand",
};

const zoom = ref<ZoomId>("1m");
const precision = ref<BucketPrecision>("1d");
const windowEndMs = ref(props.nowMs);

const zoomCfg = computed(() => ZOOMS.find((z) => z.id === zoom.value)!);
const minEndMs = computed(() =>
  props.counter.history.length > 0 ? Date.parse(props.counter.history[0].at) : props.nowMs,
);
const canGoBack = computed(() => windowEndMs.value - zoomCfg.value.spanMs > minEndMs.value);
const canGoForward = computed(() => windowEndMs.value < props.nowMs - 1000);

function setZoom(id: ZoomId) {
  zoom.value = id;
  precision.value = ZOOMS.find((z) => z.id === id)!.precisions[0];
  if (windowEndMs.value > props.nowMs) {
    windowEndMs.value = props.nowMs;
  }
}

function setPrecision(p: BucketPrecision) {
  precision.value = p;
}

function goBack() {
  windowEndMs.value = Math.max(minEndMs.value, windowEndMs.value - zoomCfg.value.spanMs);
}

function goForward() {
  windowEndMs.value = Math.min(props.nowMs, windowEndMs.value + zoomCfg.value.spanMs);
}

function goNow() {
  windowEndMs.value = props.nowMs;
}

const windowPoints = computed(() =>
  historyWindow(
    props.counter,
    windowEndMs.value - zoomCfg.value.spanMs,
    windowEndMs.value,
    precision.value,
  ),
);

function xLabel(ms: number): string {
  const d = new Date(ms);
  switch (zoom.value) {
    case "24h":
      return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    case "7d":
      return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" });
    case "1m":
      return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    default:
      return d.toLocaleDateString("nl-NL", { month: "short" });
  }
}

const windowLabel = computed(() => {
  const from = new Date(windowEndMs.value - zoomCfg.value.spanMs);
  const to = new Date(windowEndMs.value);
  if (zoom.value === "24h") {
    const fmtDate = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    const fmtTime = (d: Date) => d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    return `${fmtDate(from)} ${fmtTime(from)} – ${fmtDate(to)} ${fmtTime(to)}`;
  }
  return `${from.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })} – ${to.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}`;
});

// ---- settings form (staged until save) ----
const EMOTICONS = [
  "🍺", "🍷", "🥃", "🍾", "🍸", "🍻",
  "💧", "🥤", "☕", "🏃", "💪", "🚴",
  "🏊", "📖", "💵", "🎯", "📅", "⭐",
];

const form = reactive({
  name: props.counter.name,
  icon: props.counter.icon,
  categoryId: props.counter.categoryId,
  resetPeriod: props.counter.resetPeriod,
});
const valueLabel = computed(() =>
  form.resetPeriod === "none" ? "Waarde" : "Waarde deze periode",
);
const valueText = ref(String(effectiveValue(props.counter, now.value)));
const periodStartText = ref(periodStartToText(props.counter.periodStart));
const settingsError = ref("");
const savedHint = ref("");

watch(display, (value) => {
  valueText.value = String(value);
});
watch(
  () => props.counter.periodStart,
  (value) => {
    periodStartText.value = periodStartToText(value);
  },
);

function periodStartToText(ms: number | null): string {
  if (ms === null) {
    return "";
  }
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function pickEmoticon(emoticon: string) {
  form.icon = form.icon === emoticon ? "" : emoticon;
}

function setPeriodStartNow() {
  const d = now.value;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  periodStartText.value = `${d.getFullYear()}-${mm}-${dd}`;
}

function saveSettings() {
  const parsed = Number(valueText.value.trim());
  if (!Number.isFinite(parsed)) {
    settingsError.value = "Voer een geldig getal in.";
    return;
  }
  const name = form.name.trim();
  if (!name) {
    settingsError.value = "Geef de teller een naam.";
    return;
  }
  settingsError.value = "";
  let periodStart: number | null = null;
  if (periodStartText.value) {
    const [y, m, d] = periodStartText.value.split("-").map(Number);
    periodStart = new Date(y, m - 1, d).getTime();
  }
  emit("save", {
    name,
    icon: form.icon,
    value: Math.min(MAX_VALUE, Math.max(MIN_VALUE, Math.round(parsed))),
    categoryId: form.categoryId,
    resetPeriod: form.resetPeriod,
    periodStart,
  });
  savedHint.value = "Opgeslagen.";
  window.setTimeout(() => {
    savedHint.value = "";
  }, 2000);
}

// ---- history list ----
const recentEvents = computed(() => props.counter.history.slice(-60).reverse());

function eventLabel(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---- close on Escape ----
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  dialogEl.value?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div
    ref="dialogEl"
    class="detail"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    :aria-label="counter.name"
  >
    <header class="head">
      <button type="button" class="back" aria-label="Terug naar tellers" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M15 18l-6-6 6-6"
          />
        </svg>
      </button>
      <span class="head-icon" aria-hidden="true">{{ counter.icon || "🔢" }}</span>
      <div class="head-text">
        <h2>{{ counter.name }}</h2>
        <span class="cycle">{{ cycleLabel }}</span>
      </div>
    </header>

    <div class="tab-panels">
      <section
        id="panel-counter"
        v-show="activeTab === 'counter'"
        class="tab-panel counter"
        role="tabpanel"
        aria-labelledby="tab-counter"
      >
        <p class="head-value">{{ display.toLocaleString("nl-NL") }}</p>

        <section class="stepper">
          <HoldButton :delta="-1" :label="`${counter.name} omlaag`" size="lg" @count="emit('count', $event)">−</HoldButton>
          <HoldButton :delta="1" :label="`${counter.name} omhoog`" size="lg" @count="emit('count', $event)">+</HoldButton>
        </section>

        <p v-if="counter.resetPeriod !== 'none'" class="lifetime-note">
          Deze periode: <strong>{{ display.toLocaleString("nl-NL") }}</strong>
          <span v-if="stats.eventCount > 0" class="muted">
            · totaal ooit {{ counter.value.toLocaleString("nl-NL") }}
          </span>
        </p>
      </section>

      <section
        id="panel-stats"
        v-show="activeTab === 'stats'"
        class="tab-panel"
        role="tabpanel"
        aria-labelledby="tab-stats"
      >
        <section v-if="stats.eventCount > 0" class="panel" aria-labelledby="stats-title">
          <h3 id="stats-title">Statistieken</h3>

          <dl class="tiles">
            <div class="tile">
              <dt>Netto</dt>
              <dd :class="stats.net >= 0 ? 'plus' : 'minus'">
                {{ stats.net >= 0 ? "+" : "" }}{{ stats.net.toLocaleString("nl-NL") }}
              </dd>
            </div>
            <div class="tile">
              <dt>+ Totaal</dt>
              <dd class="plus">+{{ stats.totalPlus.toLocaleString("nl-NL") }}</dd>
            </div>
            <div class="tile">
              <dt>− Totaal</dt>
              <dd class="minus">{{ stats.totalMinus.toLocaleString("nl-NL") }}</dd>
            </div>
            <div class="tile">
              <dt>Gebeurtenissen</dt>
              <dd>{{ stats.eventCount.toLocaleString("nl-NL") }}</dd>
            </div>
            <div class="tile">
              <dt>Actiefste dag</dt>
              <dd class="wrap">{{ dayLabel(stats.busiestDayKey) }}</dd>
            </div>
            <div class="tile">
              <dt>Actiefste uur</dt>
              <dd class="wrap">{{ hourLabel(stats.busiestHourKey) }}</dd>
            </div>
          </dl>

          <div class="sub" aria-labelledby="heat-title">
            <div class="seg-head">
              <h4 id="heat-title">Warmtekaart</h4>
              <div class="segmented" role="tablist" aria-label="Warmtekaart weergave">
                <button
                  type="button"
                  class="seg"
                  :class="{ active: heatView === 'grid' }"
                  @click="heatView = 'grid'"
                >
                  Dag × uur
                </button>
                <button
                  type="button"
                  class="seg"
                  :class="{ active: heatView === 'clock' }"
                  @click="heatView = 'clock'"
                >
                  24 uur
                </button>
              </div>
            </div>

            <template v-if="heatView === 'grid'">
              <div class="heatmap">
                <div v-for="(row, weekday) in heatmap" :key="weekday" class="hm-row">
                  <span class="hm-day">{{ DAY_NAMES[weekday] }}</span>
                  <span class="hm-row-total" :title="`${DAY_NAMES[weekday]}: ${rowTotals[weekday]} gebeurtenissen`">
                    {{ rowTotals[weekday] }}
                  </span>
                  <button
                    v-for="(count, hour) in row"
                    :key="hour"
                    type="button"
                    class="hm-cell"
                    :class="{
                      selected:
                        selectedCell !== null &&
                        selectedCell.weekday === weekday &&
                        selectedCell.hour === hour,
                    }"
                    :style="{ '--heat': heatIntensity(count) }"
                    :aria-label="`${DAY_NAMES[weekday]} ${hour}:00 – ${count} gebeurtenissen`"
                    :data-cell="`${weekday}-${hour}`"
                    :tabindex="
                      focusedCell.weekday === weekday && focusedCell.hour === hour ? 0 : -1
                    "
                    @click="selectCell(weekday, hour)"
                    @focus="focusedCell = { weekday, hour }"
                    @keydown="onCellKeydown($event, weekday, hour)"
                  ></button>
                </div>
                <div class="hm-row hm-bottom">
                  <span class="hm-day" aria-hidden="true"></span>
                  <span class="hm-row-total" aria-hidden="true"></span>
                  <span v-for="h in 24" :key="h" class="hm-hour">{{ h - 1 }}</span>
                </div>
              </div>
              <div class="hm-legend" aria-hidden="true">
                <span>minder</span>
                <span class="legend-bar"></span>
                <span>meer</span>
              </div>
              <div v-if="selectedCell" class="hm-info" role="status">
                <strong>
                  {{ DAY_NAMES[selectedCell.weekday] }} {{ String(selectedCell.hour).padStart(2, "0") }}:00
                </strong>
                <span>{{ cellCount }} {{ cellCount === 1 ? "gebeurtenis" : "gebeurtenissen" }}</span>
                <span>Gem. dit uur: {{ formatAvg(hourAvg) }} / dag</span>
                <span>Gem. deze dag: {{ formatAvg(dayAvg) }} / uur</span>
              </div>
            </template>

            <HourClock v-else :counts="colTotals" />
          </div>

          <div class="sub">
            <div class="seg-head">
              <h4>Overzicht per</h4>
              <div class="segmented" role="tablist" aria-label="Periode">
                <button
                  v-for="(cfg, mode) in PERIOD_CONFIG"
                  :key="mode"
                  type="button"
                  class="seg"
                  :class="{ active: periodMode === mode }"
                  @click="periodMode = mode"
                >
                  {{ cfg.label }}
                </button>
              </div>
            </div>
            <div class="periods">
              <div v-for="row in periods" :key="row.key" class="period-row">
                <span class="period-label">{{ periodLabel(row) }}</span>
                <span class="period-bar-wrap">
                  <span
                    class="period-bar"
                    :style="{ width: `${(row.events / periodMax) * 100}%` }"
                  ></span>
                </span>
                <span class="period-count">{{ row.events }}</span>
                <span class="period-net" :class="row.net >= 0 ? 'plus' : 'minus'">
                  {{ row.net >= 0 ? "+" : "" }}{{ row.net }}
                </span>
              </div>
            </div>
          </div>

          <div class="sub">
            <div class="seg-head">
              <h4>Verloop</h4>
              <div class="segmented" role="tablist" aria-label="Zoom niveau">
                <button
                  v-for="cfg in ZOOMS"
                  :key="cfg.id"
                  type="button"
                  class="seg"
                  :class="{ active: zoom === cfg.id }"
                  @click="setZoom(cfg.id)"
                >
                  {{ cfg.label }}
                </button>
              </div>
            </div>

            <div class="nav-row">
              <button
                type="button"
                class="nav-btn"
                aria-label="Eerder"
                :disabled="!canGoBack"
                @click="goBack"
              >
                ‹
              </button>
              <span class="nav-range">{{ windowLabel }}</span>
              <button
                type="button"
                class="nav-btn"
                aria-label="Later"
                :disabled="!canGoForward"
                @click="goForward"
              >
                ›
              </button>
              <button
                type="button"
                class="btn ghost small"
                :disabled="!canGoForward"
                @click="goNow"
              >
                Nu
              </button>
            </div>

            <div class="seg-head precision">
              <h4>Precisie</h4>
              <div class="segmented" role="tablist" aria-label="Precisie">
                <button
                  v-for="p in zoomCfg.precisions"
                  :key="p"
                  type="button"
                  class="seg"
                  :class="{ active: precision === p }"
                  @click="setPrecision(p)"
                >
                  {{ PRECISION_LABELS[p] }}
                </button>
              </div>
            </div>

            <HistoryChart :points="windowPoints" :mode="chartMode" :x-label="xLabel" />
            <p v-if="counter.resetPeriod !== 'none'" class="chart-note">
              Balkjes tonen de waarde per periode; bij een grovere precisie (bijv. week bij
              dag-reset) het totaal van die periode.
            </p>
          </div>
        </section>

        <p v-else class="panel no-history">
          Nog geen gebeurtenissen. Tik op + of − om te tellen — elke wijziging wordt automatisch
          bijgehouden voor statistieken en de grafiek.
        </p>

        <section v-if="recentEvents.length > 0" class="panel" aria-labelledby="history-title">
          <h3 id="history-title">Geschiedenis</h3>
          <p class="history-note">Laatste {{ recentEvents.length }} wijzigingen</p>
          <ul class="history">
            <li v-for="(event, i) in recentEvents" :key="i">
              <span class="h-time">{{ eventLabel(event.at) }}</span>
              <span class="h-delta" :class="event.delta > 0 ? 'plus' : 'minus'">
                {{ event.delta > 0 ? "+" : "" }}{{ event.delta }}
              </span>
            </li>
          </ul>
          <button type="button" class="btn danger" @click="emit('clearHistory')">
            Geschiedenis wissen
          </button>
        </section>

      </section>

      <section
        id="panel-settings"
        v-show="activeTab === 'settings'"
        class="tab-panel"
        role="tabpanel"
        aria-labelledby="tab-settings"
      >
        <section class="panel" aria-labelledby="settings-title">
          <h3 id="settings-title">Instellingen</h3>
          <form class="form" @submit.prevent="saveSettings">
            <label class="field">
              <span>Naam</span>
              <input v-model="form.name" type="text" maxlength="60" placeholder="Bijv. Bier, Push-ups" />
            </label>

            <div class="field">
              <span>Icoon</span>
              <div class="emoticon-grid">
                <button
                  v-for="emoticon in EMOTICONS"
                  :key="emoticon"
                  class="emoticon"
                  :class="{ active: form.icon === emoticon }"
                  type="button"
                  :aria-label="`Icoon ${emoticon}`"
                  @click="pickEmoticon(emoticon)"
                >
                  {{ emoticon }}
                </button>
              </div>
              <input v-model="form.icon" type="text" maxlength="16" placeholder="Of typ zelf een icoon" />
            </div>

            <label class="field">
              <span>{{ valueLabel }}</span>
              <input v-model="valueText" type="text" inputmode="numeric" />
            </label>

            <label class="field">
              <span>Categorie</span>
              <select v-model="form.categoryId">
                <option :value="null">Zonder categorie</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </label>

            <div class="field">
              <span>Start opnieuw op 0</span>
              <div class="segmented" role="radiogroup" aria-label="Reset cyclus">
                <button
                  v-for="(label, mode) in RESET_PERIOD_LABELS"
                  :key="mode"
                  type="button"
                  class="seg"
                  :class="{ active: form.resetPeriod === mode }"
                  @click="setResetPeriod(mode)"
                >
                  {{ label }}
                </button>
              </div>
              <template v-if="form.resetPeriod !== 'none'">
                <label class="field-inline">
                  <span class="sub-label">Periode start (vandaag = begin cyclus)</span>
                  <input v-model="periodStartText" type="date" />
                  <button type="button" class="btn ghost small" @click="setPeriodStartNow">
                    Vandaag
                  </button>
                  <button
                    v-if="periodStartText"
                    type="button"
                    class="btn ghost small"
                    @click="periodStartText = ''"
                  >
                    Automatisch
                  </button>
                </label>
                <p class="field-hint">
                  Zonder datum starten periodes op kalender-grenzen (middernacht / maandag / 1e van de
                  maand). Een datum verplaatst de grenzen, niets gaat verloren.
                </p>
              </template>
            </div>

            <p v-if="settingsError" class="error" role="alert">{{ settingsError }}</p>
            <p v-if="savedHint" class="saved" aria-live="polite">{{ savedHint }}</p>

            <div class="actions">
              <button class="btn primary" type="submit">Opslaan</button>
            </div>
          </form>
        </section>

        <section class="panel danger-zone">
          <button type="button" class="btn danger" @click="emit('delete', counter.id)">
            Teller verwijderen
          </button>
        </section>
      </section>
    </div>

    <nav class="tabbar" role="tablist" aria-label="Onderdelen van deze teller">
      <button
        id="tab-counter"
        type="button"
        class="tab"
        role="tab"
        aria-controls="panel-counter"
        :aria-selected="activeTab === 'counter'"
        :tabindex="activeTab === 'counter' ? 0 : -1"
        @click="activeTab = 'counter'"
        @keydown="onTabKeydown($event, 'counter')"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 8v8M8 12h8"
          />
        </svg>
        Teller
      </button>
      <button
        id="tab-stats"
        type="button"
        class="tab"
        role="tab"
        aria-controls="panel-stats"
        :aria-selected="activeTab === 'stats'"
        :tabindex="activeTab === 'stats' ? 0 : -1"
        @click="activeTab = 'stats'"
        @keydown="onTabKeydown($event, 'stats')"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 20V11M10 20V4M16 20v-6M2 20h20"
          />
        </svg>
        Statistieken
      </button>
      <button
        id="tab-settings"
        type="button"
        class="tab"
        role="tab"
        aria-controls="panel-settings"
        :aria-selected="activeTab === 'settings'"
        :tabindex="activeTab === 'settings' ? 0 : -1"
        @click="activeTab = 'settings'"
        @keydown="onTabKeydown($event, 'settings')"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4 8h16M4 16h16M9 5v6M15 13v6"
          />
        </svg>
        Instellingen
      </button>
    </nav>
  </div>
</template>

<style scoped>
.detail {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: linear-gradient(180deg, #0f172a 0%, #020617 100%);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: calc(0.75rem + env(safe-area-inset-top, 0px))
    calc(1rem + env(safe-area-inset-right, 0px)) 0.6rem
    calc(1rem + env(safe-area-inset-left, 0px));
}

/* Alleen dit vlak scrollt; kop en tabbalk blijven staan. */
.tab-panels {
  overflow-y: auto;
  padding: 0.9rem calc(1rem + env(safe-area-inset-right, 0px)) 1.25rem
    calc(1rem + env(safe-area-inset-left, 0px));
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.tab-panel {
  flex: 0 0 auto;
  display: grid;
  gap: 0.9rem;
  align-content: start;
  /* Without this a flex item cannot shrink below its min-content, pushing the
     whole tab outwards on narrow screens. */
  min-width: 0;
}

/* The counting surface fills the area: value centred, buttons within thumb
   reach. `flex: 1 0 auto` lets it grow but never shrink, so long tabs scroll. */
.tab-panel.counter {
  flex: 1 0 auto;
  grid-template-rows: minmax(0, 1fr) auto auto;
  align-items: center;
}

.tabbar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.25rem;
  padding: 0.3rem calc(0.5rem + env(safe-area-inset-right, 0px))
    calc(0.3rem + env(safe-area-inset-bottom, 0px))
    calc(0.5rem + env(safe-area-inset-left, 0px));
  border-top: 1px solid var(--border-subtle);
  background: rgba(2, 6, 23, 0.94);
}

.tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: #94a3b8;
  font: inherit;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 0.2rem;
  min-height: 2.75rem;
  padding: 0.35rem 0.2rem;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.tab svg {
  width: 1.2rem;
  height: 1.2rem;
}

.tab:hover {
  color: #e2e8f0;
}

.tab[aria-selected="true"] {
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.12);
}

.back {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  border-radius: 50%;
  width: 2.75rem;
  height: 2.75rem;
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: none;
}

.back:hover {
  background: rgba(30, 41, 59, 0.9);
  color: #f8fafc;
}

.head-icon {
  font-size: 1.6rem;
  line-height: 1;
}

.head-text {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.1rem;
}

.head-text h2 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.15rem;
  font-weight: 800;
  color: #f8fafc;
}

.cycle {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.head-value {
  margin: 0;
  text-align: center;
  font-size: clamp(2.75rem, 14vw, 3.6rem);
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  color: #f8fafc;
  overflow-wrap: anywhere;
}

.stepper {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}

.lifetime-note {
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: #94a3b8;
}

.lifetime-note strong {
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.muted {
  opacity: 0.8;
}

.panel {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  padding: 1rem;
  display: grid;
  gap: 0.7rem;
}

h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

h4 {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
}

.sub {
  display: grid;
  gap: 0.5rem;
}

.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin: 0;
}

.tile {
  display: grid;
  gap: 0.15rem;
  padding: 0.5rem 0.6rem;
  background: rgba(2, 6, 23, 0.4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.tile dt {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.tile dd {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 800;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.tile dd.plus {
  color: #7dd3fc;
}

.tile dd.minus {
  color: #fca5a5;
}

.tile dd.wrap {
  font-size: 0.78rem;
  line-height: 1.35;
  font-weight: 700;
}

.heatmap {
  display: grid;
  gap: 2px;
}

.hm-row {
  display: grid;
  grid-template-columns: 1.5rem 2rem repeat(24, 1fr);
  gap: 2px;
  align-items: center;
}

/* Phones: 24 columns across ~250px gives 9px cells. Let the map scroll with
   bigger cells and keep the day and total columns pinned. */
@media (max-width: 30rem) {
  .heatmap {
    overflow-x: auto;
  }

  .hm-row,
  .hm-bottom {
    grid-template-columns: 1.5rem 2rem repeat(24, 0.85rem);
  }

  .hm-day,
  .hm-row-total {
    position: sticky;
    z-index: 1;
    background: #0d1526;
  }

  .hm-day {
    left: 0;
  }

  .hm-row-total {
    left: 1.5rem;
  }
}

.hm-day {
  font-size: 0.6rem;
  font-weight: 700;
  color: #94a3b8;
  text-align: left;
}

.hm-row-total {
  font-size: 0.6rem;
  font-weight: 800;
  color: #7dd3fc;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.hm-cell {
  appearance: none;
  aspect-ratio: 1;
  border-radius: 2px;
  background: rgba(56, 189, 248, var(--heat, 0));
  border: 1px solid rgba(148, 163, 184, 0.08);
  padding: 0;
  cursor: pointer;
  touch-action: manipulation;
}

.hm-cell.selected {
  outline: 2px solid #f8fafc;
  outline-offset: 1px;
}

.hm-cell:focus-visible {
  outline: 2px solid #7dd3fc;
  outline-offset: 1px;
}

.hm-bottom {
  margin-top: 2px;
}

.hm-hour {
  font-size: 0.55rem;
  color: #94a3b8;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.hm-info {
  display: grid;
  gap: 0.15rem;
  padding: 0.55rem 0.7rem;
  background: rgba(2, 6, 23, 0.5);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  color: #cbd5e1;
}

.hm-info strong {
  font-size: 0.9rem;
  color: #f8fafc;
}

.hm-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  font-size: 0.65rem;
  color: #94a3b8;
}

.legend-bar {
  width: 4.5rem;
  height: 0.45rem;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.05), rgba(56, 189, 248, 0.95));
}

.seg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.nav-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.nav-btn {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: rgba(15, 23, 42, 0.6);
  color: #e2e8f0;
  font: inherit;
  font-size: 1rem;
  font-weight: 700;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: none;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(30, 41, 59, 0.9);
  color: #f8fafc;
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.nav-range {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 700;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.precision {
  margin-top: 0.2rem;
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  gap: 0.25rem;
  padding: 0.2rem;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
}

.seg {
  appearance: none;
  border: none;
  background: transparent;
  color: #94a3b8;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  min-height: 2rem;
  padding: 0.45rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
}

.seg.active {
  background: rgba(56, 189, 248, 0.2);
  color: #e0f2fe;
}

.periods {
  display: grid;
  gap: 0.35rem;
}

.period-row {
  display: grid;
  grid-template-columns: 6.5rem 1fr 2rem 2.6rem;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
}

.period-label {
  color: #cbd5e1;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.period-bar-wrap {
  height: 0.5rem;
  background: rgba(148, 163, 184, 0.1);
  border-radius: 999px;
  overflow: hidden;
}

.period-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.55), #38bdf8);
  min-width: 2px;
}

.period-count {
  text-align: right;
  font-weight: 800;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.period-net {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.period-net.plus {
  color: #7dd3fc;
}

.period-net.minus {
  color: #fca5a5;
}

.chart-note {
  margin: 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.no-history {
  font-size: 0.9rem;
  line-height: 1.55;
  color: #94a3b8;
}

/* ---- settings ---- */
.form {
  display: grid;
  gap: 0.85rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field > span,
.sub-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

input,
select {
  width: 100%;
  font: inherit;
  font-size: 0.95rem;
  color: #f8fafc;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  padding: 0.6rem 0.7rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: #38bdf8;
}

select {
  appearance: none;
}

select option {
  background: #0f172a;
  color: #f8fafc;
}

.field-inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.4rem;
  align-items: end;
}

.field-inline input {
  min-width: 0;
}

.field-inline .sub-label {
  grid-column: 1 / -1;
}

/* A date input plus two buttons does not fit on one phone row: give the date
   its own line and let the buttons share the next one. */
@media (max-width: 30rem) {
  .field-inline {
    grid-template-columns: 1fr 1fr;
  }

  .field-inline input {
    grid-column: 1 / -1;
  }
}

.field-hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #94a3b8;
}

.emoticon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.35rem;
}

.emoticon {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: rgba(15, 23, 42, 0.6);
  border-radius: var(--radius-md);
  font-size: 1.15rem;
  line-height: 1;
  min-height: 2.5rem;
  padding: 0.45rem 0;
  cursor: pointer;
}

.emoticon:hover {
  border-color: var(--border-strong);
}

.emoticon.active {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.16);
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: rgba(2, 6, 23, 0.35);
}

.toggle-text {
  display: grid;
  gap: 0.15rem;
}

.toggle-text strong {
  font-size: 0.9rem;
  font-weight: 700;
  color: #e2e8f0;
}

.toggle-text small {
  font-size: 0.78rem;
  line-height: 1.4;
  color: #94a3b8;
}

.toggle input[type="checkbox"] {
  width: 1.15rem;
  height: 1.15rem;
  accent-color: #38bdf8;
  flex: none;
}

.error {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #f87171;
}

.saved {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: #4ade80;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  min-height: 2.5rem;
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

.btn.small {
  min-height: 2.25rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.78rem;
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

.primary {
  background: #38bdf8;
  color: #062033;
}

.primary:hover {
  background: #7dd3fc;
}

.danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.danger:hover {
  background: rgba(239, 68, 68, 0.28);
}

/* ---- history list ---- */
.history-note {
  margin: 0;
  font-size: 0.78rem;
  color: #94a3b8;
}

.history {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
  max-height: 14rem;
  overflow-y: auto;
}

.history li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  background: rgba(2, 6, 23, 0.35);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
}

.h-time {
  color: #94a3b8;
  font-weight: 600;
}

.h-delta {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.h-delta.plus {
  color: #7dd3fc;
}

.h-delta.minus {
  color: #fca5a5;
}

.danger-zone {
  display: grid;
  justify-items: center;
}

.danger-zone .btn {
  width: 100%;
}
</style>
