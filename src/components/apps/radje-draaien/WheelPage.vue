<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import ChoiceForm from "./ChoiceForm.vue";
import ChoiceList from "./ChoiceList.vue";
import HistoryList from "./HistoryList.vue";
import WheelCanvas from "./WheelCanvas.vue";
import type { Choice, SpinRecord } from "./types";
import {
  MIN_WEIGHT,
  PALETTE,
  SPIN_DURATION_MS,
  clampWeight,
  formatTimeWithMs,
  makeId,
  pickWinner,
  totalWeight,
} from "./wheelEngine";

const STORAGE_KEY = "radje-draaien:v1";
const SPIN_FALLBACK_MS = SPIN_DURATION_MS + 300;

function makeDefaultChoices(): Choice[] {
  return [
    { id: makeId(), label: "Niets", weight: 0.5 },
    { id: makeId(), label: "2 slokken", weight: 1 },
    { id: makeId(), label: "1 Bak", weight: 1 },
    { id: makeId(), label: "1 slok", weight: 0.5 },
    { id: makeId(), label: "4 slokken", weight: 1 },
  ];
}

function loadChoices(): Choice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return makeDefaultChoices();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.choices) || !parsed.choices.length) {
      return makeDefaultChoices();
    }
    return parsed.choices
      .filter(
        (item: unknown) =>
          typeof (item as Choice).label === "string" &&
          Number.isFinite((item as Choice).weight),
      )
      .map((item: Choice) => ({
        id: String(item.id),
        label: String(item.label),
        weight: clampWeight(item.weight, 0),
      }));
  } catch {
    return makeDefaultChoices();
  }
}

function loadHistory(): SpinRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.history)) {
      return [];
    }
    return parsed.history.slice(0, 10);
  } catch {
    return [];
  }
}

const choices = ref<Choice[]>(loadChoices());
const spinHistory = ref<SpinRecord[]>(loadHistory());
const currentRotation = ref(0);
const isSpinning = ref(false);
const pendingWinner = ref<string | null>(null);
const resultText = ref("");
let lastActiveLabel = "";
let spinFallbackTimer: number | null = null;

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ choices: choices.value, history: spinHistory.value }),
    );
  } catch {
    // storage may be unavailable (private mode, quota) — ignore
  }
}

watch([choices, spinHistory], saveState, { deep: true });

function resetGame() {
  if (isSpinning.value) {
    return;
  }
  choices.value = makeDefaultChoices();
  spinHistory.value = [];
  resultText.value = "";
  lastActiveLabel = "";
}

function clearHistory() {
  if (isSpinning.value) {
    return;
  }
  spinHistory.value = [];
}

onBeforeUnmount(() => {
  if (spinFallbackTimer !== null) {
    window.clearTimeout(spinFallbackTimer);
  }
});

function addChoice(payload: { label: string; weight: number }) {
  if (isSpinning.value) {
    return;
  }
  choices.value.push({
    id: makeId(),
    label: payload.label,
    weight: clampWeight(payload.weight),
  });
}

function updateLabel(id: string, label: string) {
  if (isSpinning.value) {
    return;
  }
  const found = choices.value.find((item) => item.id === id);
  if (found) {
    found.label = label;
  }
}

function updateWeight(id: string, weight: number) {
  if (isSpinning.value) {
    return;
  }
  const found = choices.value.find((item) => item.id === id);
  if (found) {
    found.weight = clampWeight(weight, 0);
  }
}

function removeChoice(id: string) {
  if (isSpinning.value) {
    return;
  }
  choices.value = choices.value.filter((item) => item.id !== id);
}

function spin() {
  if (isSpinning.value || !choices.value.length) {
    return;
  }

  const winnerIndex = pickWinner(choices.value);
  if (winnerIndex === null) {
    resultText.value = "Geef minimaal één keuze met gewicht > 0.";
    return;
  }

  const total = totalWeight(choices.value);
  let start = 0;
  for (let i = 0; i < winnerIndex; i += 1) {
    start += (choices.value[i].weight / total) * 360;
  }
  const span = (choices.value[winnerIndex].weight / total) * 360;

  const edgeMargin = Math.min(8, span * 0.2);
  const canRandomizeInsideSlice = span > edgeMargin * 2;
  const landingAngleInSlice = canRandomizeInsideSlice
    ? start + edgeMargin + Math.random() * (span - edgeMargin * 2)
    : start + span / 2;

  const targetNormalized = (360 - landingAngleInSlice) % 360;
  const currentNormalized = ((currentRotation.value % 360) + 360) % 360;
  let delta = (targetNormalized - currentNormalized + 360) % 360;
  if (delta < 120) {
    delta += 360;
  }

  const fullTurns = 4 + Math.floor(Math.random() * 3);
  currentRotation.value += fullTurns * 360 + delta;
  pendingWinner.value = choices.value[winnerIndex].label;
  isSpinning.value = true;
  resultText.value = "";
  lastActiveLabel = "";

  if (spinFallbackTimer !== null) {
    window.clearTimeout(spinFallbackTimer);
  }
  spinFallbackTimer = window.setTimeout(() => {
    spinFallbackTimer = null;
    onSpinEnd();
  }, SPIN_FALLBACK_MS);
}

function onActiveOption(label: string) {
  if (!isSpinning.value || label === lastActiveLabel) {
    return;
  }
  lastActiveLabel = label;
  resultText.value = label;
}

function onSpinEnd() {
  if (!isSpinning.value || !pendingWinner.value) {
    return;
  }

  if (spinFallbackTimer !== null) {
    window.clearTimeout(spinFallbackTimer);
    spinFallbackTimer = null;
  }

  isSpinning.value = false;
  resultText.value = `Winnaar: ${pendingWinner.value}`;
  const now = new Date();
  spinHistory.value.unshift({
    label: pendingWinner.value,
    time: formatTimeWithMs(now),
    iso: now.toISOString(),
  });
  spinHistory.value = spinHistory.value.slice(0, 10);
  pendingWinner.value = null;
}
</script>

<template>
  <main>
    <section class="hero" aria-labelledby="page-title">
      <div class="eyebrow">Dispuut Ebrius Vespertina</div>
      <h1 id="page-title">Radje draaien</h1>
      <p>
        Voeg keuzes toe, geef eventueel een gewicht mee, en draai het rad.
        Gewichten worden automatisch omgerekend naar 100% (360°). Zet een
        gewicht op 0 om de keuze te bewaren maar over te slaan bij het draaien.
      </p>
    </section>

    <section class="panel wheel-wrap" aria-label="Rad">
      <WheelCanvas
        :choices="choices"
        :palette="PALETTE"
        :rotation="currentRotation"
        :spinning="isSpinning"
        @spin="spin"
        @active-option="onActiveOption"
        @spin-end="onSpinEnd"
      />
      <div class="result" aria-live="polite">{{ resultText }}</div>
    </section>

    <section class="panel controls" aria-label="Instellingen">
      <div class="panel-header">
        <h2 id="controls-title">Keuzes</h2>
        <button
          class="btn-ghost"
          type="button"
          :disabled="isSpinning"
          @click="resetGame"
        >
          Reset naar standaard
        </button>
      </div>
      <ChoiceForm :min-weight="MIN_WEIGHT" :disabled="isSpinning" @add-choice="addChoice" />
      <ChoiceList
        :choices="choices"
        :palette="PALETTE"
        :disabled="isSpinning"
        @update-label="updateLabel"
        @update-weight="updateWeight"
        @remove-choice="removeChoice"
      />
    </section>

    <section class="panel" aria-label="Geschiedenis">
      <div class="panel-header">
        <h2>Geschiedenis</h2>
        <button
          class="btn-ghost"
          type="button"
          :disabled="isSpinning || spinHistory.length === 0"
          @click="clearHistory"
        >
          Wis
        </button>
      </div>
      <HistoryList :history="spinHistory" />
    </section>
  </main>
</template>

<style scoped>
main {
  width: min(100%, 58rem);
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
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
  color: #fb7185;
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

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.panel-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.controls {
  display: grid;
  gap: 0.7rem;
}

.wheel-wrap {
  padding-top: 2rem;
  display: grid;
  place-items: center;
  min-width: 0;
}

.result {
  margin-top: 0.9rem;
  font-size: 0.95rem;
  font-weight: 600;
  text-align: center;
  min-height: 1.4rem;
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
