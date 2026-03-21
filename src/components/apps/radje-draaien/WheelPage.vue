<script setup lang="ts">
import { ref } from "vue";
import ChoiceForm from "./ChoiceForm.vue";
import ChoiceList from "./ChoiceList.vue";
import HistoryList from "./HistoryList.vue";
import WheelCanvas from "./WheelCanvas.vue";
import type { Choice, SpinRecord } from "./types";
import {
  MIN_WEIGHT,
  PALETTE,
  clampWeight,
  formatTimeWithMs,
  pickWinner,
  totalWeight,
} from "./wheelEngine";

const choices = ref<Choice[]>([
  { id: crypto.randomUUID(), label: "Niets", weight: 0.5 },
  { id: crypto.randomUUID(), label: "2 slokken", weight: 1 },
  { id: crypto.randomUUID(), label: "1 Bak", weight: 1 },
  { id: crypto.randomUUID(), label: "1 slok", weight: 0.5 },
  { id: crypto.randomUUID(), label: "4 slokken", weight: 1 },
]);

const spinHistory = ref<SpinRecord[]>([]);
const currentRotation = ref(0);
const isSpinning = ref(false);
const pendingWinner = ref<string | null>(null);
const resultText = ref("");

function addChoice(payload: { label: string; weight: number }) {
  choices.value.push({
    id: crypto.randomUUID(),
    label: payload.label,
    weight: clampWeight(payload.weight),
  });
}

function updateLabel(id: string, label: string) {
  const found = choices.value.find((item) => item.id === id);
  if (found) {
    found.label = label;
  }
}

function updateWeight(id: string, weight: number) {
  const found = choices.value.find((item) => item.id === id);
  if (found) {
    found.weight = clampWeight(weight);
  }
}

function removeChoice(id: string) {
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
}

function onActiveOption(label: string) {
  if (isSpinning.value) {
    resultText.value = label;
  }
}

function onSpinEnd() {
  if (!isSpinning.value || !pendingWinner.value) {
    return;
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
    <section class="panel hero">
      <h1>Radje draaien</h1>
      <p>
        Voeg keuzes toe, geef eventueel een gewicht mee, en draai het rad.
        Gewichten worden automatisch omgerekend naar 100% (360°).
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
      <ChoiceForm :min-weight="MIN_WEIGHT" @add-choice="addChoice" />
      <ChoiceList
        :choices="choices"
        :palette="PALETTE"
        :min-weight="MIN_WEIGHT"
        @update-label="updateLabel"
        @update-weight="updateWeight"
        @remove-choice="removeChoice"
      />
    </section>

    <section class="panel" aria-label="Geschiedenis">
      <h2>Geschiedenis</h2>
      <HistoryList :history="spinHistory" />
    </section>
  </main>
</template>

<style scoped>
main {
  width: min(100%, 58rem);
  max-width: 58rem;
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

.panel {
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 1rem;
  padding: 1rem;
  min-width: 0;
}

h1 {
  margin: 0;
  font-size: clamp(1.5rem, 7vw, 2rem);
}

p {
  margin: 0.55rem 0 0;
  color: #cbd5e1;
  font-size: 0.95rem;
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

.controls {
  display: grid;
  gap: 0.7rem;
}

h2 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
}

@media (min-width: 56rem) {
  main {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    align-items: start;
  }

  .hero {
    grid-column: 1 / -1;
  }
}
</style>
