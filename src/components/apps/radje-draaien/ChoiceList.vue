<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import type { Choice } from "./types";
import { percentages, clampWeight, parseWeightInput, totalWeight } from "./wheelEngine";

const props = defineProps<{
  choices: Choice[];
  palette: string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  updateLabel: [id: string, label: string];
  updateWeight: [id: string, weight: number];
  removeChoice: [id: string];
  moveChoice: [id: string, direction: -1 | 1];
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
  emit("updateWeight", id, clampWeight(parseWeightInput(value), 0));
}
</script>

<template>
  <div class="summary">
    Totaal gewicht: {{ total.toFixed(1) }} · Gewicht 0 slaat de keuze over.
  </div>
  <ul class="list">
    <li v-if="choices.length === 0" class="empty">
      Nog geen keuzes. Voeg er hierboven één toe.
    </li>
    <li
      v-for="(choice, index) in choices"
      :key="choice.id"
      class="item"
      :style="{ borderLeftColor: palette[index % palette.length] }"
    >
      <input
        class="item-input label-input"
        :value="choice.label"
        :disabled="disabled"
        title="Maak leeg om te verwijderen"
        @input="
          onLabelInput(choice.id, ($event.target as HTMLInputElement).value)
        "
        placeholder="Naam van de keuze"
      />
      <input
        class="item-input weight-input"
        type="number"
        min="0"
        :disabled="disabled"
        step="0.1"
        inputmode="decimal"
        :value="String(choice.weight)"
        @input="
          onWeightInput(choice.id, ($event.target as HTMLInputElement).value)
        "
        placeholder="Gewicht"
      />
      <span class="percent">{{ shares[index].toFixed(1) }}%</span>
      <button
        class="reorder-btn move-up"
        type="button"
        :disabled="disabled || index === 0"
        :aria-label="`${choice.label} omhoog verplaatsen`"
        title="Omhoog"
        @click="emit('moveChoice', choice.id, -1)"
      >
        <Icon icon="lucide:chevron-up" width="18" height="18" aria-hidden="true" />
      </button>
      <button
        class="reorder-btn move-down"
        type="button"
        :disabled="disabled || index === choices.length - 1"
        :aria-label="`${choice.label} omlaag verplaatsen`"
        title="Omlaag"
        @click="emit('moveChoice', choice.id, 1)"
      >
        <Icon icon="lucide:chevron-down" width="18" height="18" aria-hidden="true" />
      </button>
      <button
        class="remove"
        type="button"
        :disabled="disabled"
        :aria-label="`Verwijder ${choice.label}`"
        title="Verwijder"
        @click="emit('removeChoice', choice.id)"
      >
        <Icon icon="lucide:x" width="18" height="18" aria-hidden="true" />
      </button>
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
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.55rem;
}

.empty {
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: #94a3b8;
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.32);
  border: 1px dashed rgba(148, 163, 184, 0.22);
}

.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 2.6rem 2.6rem;
  grid-template-areas:
    "label label label remove"
    "weight percent up down";
  gap: 0.45rem;
  align-items: center;
  padding: 0.6rem 0.55rem 0.6rem 0.75rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-left-width: 4px;
  background: rgba(15, 23, 42, 0.45);
}

.item-input {
  height: 2.5rem;
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border-radius: 0.5rem;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid transparent;
  font-size: 1rem;
  color: #e2e8f0;
}

.label-input {
  grid-area: label;
}

.weight-input {
  grid-area: weight;
}

.item-input:focus-visible {
  border-color: rgba(148, 163, 184, 0.35);
  box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.14);
  outline: none;
}

.percent {
  grid-area: percent;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: #cbd5e1;
  white-space: nowrap;
}

.reorder-btn,
.remove {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.6rem;
  min-height: 2.6rem;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.55rem;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.reorder-btn :deep(svg),
.remove :deep(svg) {
  display: block;
}

.move-up {
  grid-area: up;
}

.move-down {
  grid-area: down;
}

.reorder-btn:hover:not(:disabled),
.reorder-btn:focus-visible,
.remove:hover,
.remove:focus-visible {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.28);
}

.reorder-btn:active:not(:disabled) {
  background: rgba(148, 163, 184, 0.24);
}

.reorder-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.remove {
  grid-area: remove;
}

.remove:hover,
.remove:focus-visible {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.12);
  border-color: rgba(251, 113, 133, 0.28);
}

.remove:active {
  background: rgba(251, 113, 133, 0.22);
}

@media (min-width: 36rem) {
  .item {
    grid-template-columns: minmax(0, 1fr) 5.2rem 4.1rem 2.6rem 2.6rem 2.6rem;
    grid-template-areas: "label weight percent up down remove";
    gap: 0.5rem;
    padding: 0.55rem 0.6rem 0.55rem 0.8rem;
  }
}

@media (max-width: 21rem) {
  .item {
    grid-template-columns: minmax(0, 1fr) 2.2rem 2.2rem;
    grid-template-areas:
      "label label remove"
      "weight up down";
  }

  .percent {
    display: none;
  }
}
</style>
