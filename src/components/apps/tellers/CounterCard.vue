<script setup lang="ts">
import { computed } from "vue";
import HoldButton from "./HoldButton.vue";
import type { Counter } from "./types";
import { RESET_PERIOD_LABELS, effectiveValue } from "./countersEngine";

const props = defineProps<{
  counter: Counter;
  nowMs: number;
}>();

const emit = defineEmits<{
  count: [delta: number];
  open: [];
}>();

const display = computed(() => effectiveValue(props.counter, new Date(props.nowMs)));
const cycleLabel = computed(() =>
  props.counter.resetPeriod === "none"
    ? ""
    : `↻ ${RESET_PERIOD_LABELS[props.counter.resetPeriod].toLowerCase()}`,
);
const displayValue = () => display.value.toLocaleString("nl-NL");
</script>

<template>
  <article class="card" @contextmenu.prevent @click="emit('open')">
    <header class="topline">
      <span class="icon" aria-hidden="true">{{ counter.icon || "🔢" }}</span>
      <h3 class="name">{{ counter.name }}</h3>
      <span v-if="cycleLabel" class="cycle" :title="`Start opnieuw op 0: ${RESET_PERIOD_LABELS[counter.resetPeriod].toLowerCase()}`">
        {{ cycleLabel }}
      </span>
    </header>

    <p class="value" :aria-label="`${counter.name}: ${displayValue()}`">
      {{ displayValue() }}
    </p>

    <div class="buttons">
      <HoldButton :delta="-1" :label="`${counter.name} omlaag`">−</HoldButton>
      <HoldButton :delta="1" :label="`${counter.name} omhoog`">+</HoldButton>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
  padding: 0.85rem;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
  cursor: pointer;
}

.card:active {
  border-color: rgba(56, 189, 248, 0.35);
}

.topline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.icon {
  font-size: 1.15rem;
  line-height: 1;
  filter: saturate(0.9);
}

.name {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #f8fafc;
}

.cycle {
  flex: none;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: var(--radius-pill);
  padding: 0.18rem 0.5rem;
}

.value {
  margin: 0;
  text-align: center;
  font-size: clamp(2.4rem, 10vw, 3.4rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

@media (min-width: 56rem) {
  .buttons :deep(.step.sm) {
    padding: 0.85rem 0;
  }
}
</style>
