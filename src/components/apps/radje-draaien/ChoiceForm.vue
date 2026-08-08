<script setup lang="ts">
import { ref } from "vue";
import { clampWeight } from "./wheelEngine";
import { Icon } from "@iconify/vue";

const props = defineProps<{
  minWeight: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  addChoice: [payload: { label: string; weight: number }];
}>();

const newLabel = ref("");
const newWeight = ref("");

function submit() {
  const label = newLabel.value.trim();
  if (!label) return;

  const parsed = newWeight.value.trim() === "" ? 1 : Number(newWeight.value);
  const weight = clampWeight(parsed);

  emit("addChoice", { label, weight });
  newLabel.value = "";
  newWeight.value = "";
}
</script>

<template>
  <form class="form-row" @submit.prevent="submit">
    <input
      v-model="newLabel"
      class="new-label"
      :disabled="disabled"
      placeholder="Nieuwe keuze"
      autocomplete="off"
      enterkeyhint="done"
      required
      minlength="1"
    />
    <input
      v-model="newWeight"
      class="new-weight"
      type="number"
      :disabled="disabled"
      :min="String(minWeight)"
      step="0.1"
      inputmode="decimal"
      placeholder="Gewicht"
    />
    <button
      class="add"
      type="submit"
      :disabled="disabled"
      aria-label="Keuze toevoegen"
      title="Keuze toevoegen"
    >
      <Icon icon="lucide:plus" width="18" height="18" aria-hidden="true" />
    </button>
  </form>
</template>

<style scoped>
.form-row {
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2.9rem;
  grid-template-areas:
    "label label"
    "weight add";
  gap: 0.4rem;
  align-items: stretch;
}

.form-row > * {
  min-width: 0;
  box-sizing: border-box;
}

.new-label {
  grid-area: label;
  min-width: 0;
}

.new-weight {
  grid-area: weight;
  min-width: 0;
  text-align: left;
}

.add {
  grid-area: add;
  min-width: 0;
}

input,
button {
  font: inherit;
}

input {
  width: 100%;
  min-height: 3.1rem;
  padding: 0.55rem 0.58rem;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.9);
  color: inherit;
  border-radius: 0.65rem;
  outline: none;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}

input::placeholder {
  color: #94a3b8;
}

input:focus-visible {
  border-color: rgba(56, 189, 248, 0.9);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.22);
  background: rgba(15, 23, 42, 0.98);
}

button.add {
  width: 100%;
  min-height: 3.1rem;
  border: 1px solid rgba(148, 163, 184, 0.4);
  padding: 0.5rem;
  border-radius: 0.65rem;
  background: rgba(30, 41, 59, 0.9);
  color: #e2e8f0;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

button.add :deep(svg) {
  display: block;
}

button.add:hover,
button.add:focus-visible {
  border-color: rgba(148, 163, 184, 0.65);
  background: rgba(51, 65, 85, 0.95);
}

button.add:active {
  background: rgba(30, 41, 59, 1);
}

@media (min-width: 42rem) {
  .form-row {
    grid-template-columns: minmax(0, 1fr) minmax(0, 5.8rem) 2.9rem;
    grid-template-areas: "label weight add";
  }
}

@media (max-width: 31rem) {
  .form-row {
    grid-template-columns: minmax(0, 1fr) 2.7rem;
    gap: 0.35rem;
  }

  input,
  button.add {
    min-height: 2.85rem;
  }
}
</style>
