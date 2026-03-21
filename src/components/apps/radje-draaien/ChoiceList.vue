<script setup lang="ts">
import { computed } from "vue";
import type { Choice } from "./types";
import { percentages, clampWeight, totalWeight } from "./wheelEngine";

const props = defineProps<{
  choices: Choice[];
  palette: string[];
  minWeight: number;
}>();

const emit = defineEmits<{
  updateLabel: [id: string, label: string];
  updateWeight: [id: string, weight: number];
  removeChoice: [id: string];
}>();

const shares = computed(() => percentages(props.choices));
const total = computed(() => totalWeight(props.choices));

function onLabelInput(id: string, value: string) {
  const normalized = value.trim();
  if (!normalized) {
    emit("removeChoice", id);
    return;
  }

  emit("updateLabel", id, normalized);
}

function onWeightInput(id: string, value: string) {
  const parsed = value.trim() === "" ? 1 : Number(value);
  emit("updateWeight", id, clampWeight(parsed));
}
</script>

<template>
  <div class="summary">
    Totaal gewicht: {{ total.toFixed(1) }} · Altijd genormaliseerd naar 100% /
    360°.
  </div>
  <hr />
  <ul class="list">
    <li v-for="(choice, index) in choices" :key="choice.id" class="item">
      <span
        class="color-dot"
        :style="{ backgroundColor: palette[index % palette.length] }"
        aria-hidden="true"
      ></span>
      <input
        class="item-input label-input"
        :value="choice.label"
        title="Maak leeg om te verwijderen"
        @input="
          onLabelInput(choice.id, ($event.target as HTMLInputElement).value)
        "
        placeholder="Win optie"
      />
      <input
        class="item-input weight-input"
        type="number"
        :min="String(minWeight)"
        step="0.1"
        :value="String(choice.weight)"
        @input="
          onWeightInput(choice.id, ($event.target as HTMLInputElement).value)
        "
        placeholder="Gewicht"
      />
      <span class="percent">{{ shares[index].toFixed(1) }}%</span>
    </li>
  </ul>
</template>

<style scoped>
.summary {
  font-size: 0.84rem;
  color: #94a3b8;
  padding: 0.25rem 0.1rem;
}

.list {
  list-style: none;
  padding: 0.2rem 0;
  margin: 0;
  display: grid;
  grid-template-columns: 0.85rem minmax(0, 1fr) minmax(4.8rem, 5.4rem);
  gap: 0;
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.32);
}

hr {
  border: none;
  border-top: 2px solid rgba(148, 163, 184, 0.2);
  margin: 0 -1rem;
}

.item {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 0.85rem minmax(0, 1fr) minmax(4.8rem, 5.4rem);
  grid-template-areas:
    "dot label label"
    ". weight percent";
  gap: 0.35rem;
  align-items: stretch;
  padding: 0.4rem;
  min-width: 0;
}

.item + .item {
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.color-dot {
  grid-area: dot;
  width: 0.72rem;
  height: 0.72rem;
  align-self: center;
  justify-self: center;
  border-radius: 999px;
  border: 1px solid rgba(248, 250, 252, 0.5);
  box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.6);
}

.item-input {
  height: 2.25rem;
  min-width: 0;
  margin-left: 0.2rem;
  padding: 0.45rem 0.55rem;
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid transparent;
  font-size: 0.92rem;
  color: #e2e8f0;
}

.label-input {
  grid-area: label;
}

.weight-input {
  grid-area: weight;
}

.weight-input,
.percent {
  min-width: 0;
}

.item-input:focus-visible {
  border-color: rgba(148, 163, 184, 0.35);
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.14);
  outline: none;
}

.percent {
  grid-area: percent;
  font-size: 0.78rem;
  text-align: right;
  color: #cbd5e1;
  white-space: nowrap;
  align-self: center;
  justify-self: end;
}

@supports (grid-template-columns: subgrid) {
  .item {
    grid-template-columns: subgrid;
  }
}

@media (min-width: 36rem) {
  .list {
    grid-template-columns: 0.85rem minmax(0, 1fr) 5.2rem 4.1rem;
  }

  .item {
    grid-template-columns: 0.85rem minmax(0, 1fr) 5.2rem 4.1rem;
    grid-template-areas: "dot label weight percent";
    gap: 0.45rem;
    align-items: center;
    padding: 0.42rem 0.45rem;
  }

  .item-input {
    font-size: 0.92rem;
  }

  .percent {
    font-size: 0.82rem;
  }
}

@media (max-width: 22rem) {
  .list {
    grid-template-columns: 0.78rem minmax(0, 1fr);
  }

  .item {
    grid-template-columns: 0.78rem minmax(0, 1fr);
    grid-template-areas:
      "dot label"
      ". weight"
      ". percent";
  }

  .percent {
    justify-self: start;
  }
}
</style>
