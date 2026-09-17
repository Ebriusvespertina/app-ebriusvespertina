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
    Totaal gewicht: {{ total.toFixed(1) }} · Gewicht 0 slaat de keuze over bij
    het draaien.
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
        :disabled="disabled"
        title="Maak leeg om te verwijderen"
        @input="
          onLabelInput(choice.id, ($event.target as HTMLInputElement).value)
        "
        placeholder="Win optie"
      />
      <button
        class="reorder-btn move-up"
        type="button"
        :disabled="disabled || index === 0"
        :aria-label="`${choice.label} omhoog verplaatsen`"
        title="Omhoog"
        @click="emit('moveChoice', choice.id, -1)"
      >
        <Icon icon="lucide:chevron-up" width="16" height="16" aria-hidden="true" />
      </button>
      <button
        class="reorder-btn move-down"
        type="button"
        :disabled="disabled || index === choices.length - 1"
        :aria-label="`${choice.label} omlaag verplaatsen`"
        title="Omlaag"
        @click="emit('moveChoice', choice.id, 1)"
      >
        <Icon icon="lucide:chevron-down" width="16" height="16" aria-hidden="true" />
      </button>
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
        class="remove"
        type="button"
        :disabled="disabled"
        :aria-label="`Verwijder ${choice.label}`"
        title="Verwijder"
        @click="emit('removeChoice', choice.id)"
      >
        <Icon icon="lucide:x" width="16" height="16" aria-hidden="true" />
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
  padding: 0.2rem 0;
  margin: 0;
  display: grid;
  grid-template-columns: 0.85rem minmax(0, 1fr) 1.9rem 1.9rem 2.75rem;
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
  grid-template-columns: 0.85rem minmax(0, 1fr) 1.9rem 1.9rem 2.75rem;
  grid-template-areas:
    "dot label up down remove"
    ". weight percent . .";
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
  font-size: 1rem;
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

.reorder-btn,
.remove {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.reorder-btn {
  min-height: 2.25rem;
}

.move-up {
  grid-area: up;
}

.move-down {
  grid-area: down;
}

.reorder-btn :deep(svg),
.remove :deep(svg) {
  display: block;
}

.reorder-btn:hover:not(:disabled),
.reorder-btn:focus-visible,
.remove:hover,
.remove:focus-visible {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.28);
}

.reorder-btn:active:not(:disabled),
.remove:active {
  background: rgba(148, 163, 184, 0.24);
}

.reorder-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.remove {
  grid-area: remove;
  min-width: 2.75rem;
  min-height: 2.75rem;
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
  .list {
    grid-template-columns: 0.85rem minmax(0, 1fr) 1.9rem 1.9rem 5.2rem 4.1rem 2.25rem;
  }

  .item {
    grid-template-columns: 0.85rem minmax(0, 1fr) 1.9rem 1.9rem 5.2rem 4.1rem 2.25rem;
    grid-template-areas: "dot label up down weight percent remove";
    gap: 0.45rem;
    align-items: center;
    padding: 0.42rem 0.45rem;
  }

  .reorder-btn,
  .remove {
    min-width: 2.25rem;
    min-height: 2.25rem;
  }

  .percent {
    font-size: 0.82rem;
  }
}

@media (max-width: 22rem) {
  .list {
    grid-template-columns: 0.78rem minmax(0, 1fr) 1.7rem 1.7rem 2.5rem;
  }

  .item {
    grid-template-columns: 0.78rem minmax(0, 1fr) 1.7rem 1.7rem 2.5rem;
  }

  .percent {
    justify-self: start;
  }
}
</style>
