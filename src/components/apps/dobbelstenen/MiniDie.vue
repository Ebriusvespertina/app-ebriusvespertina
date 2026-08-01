<script setup lang="ts">
import { computed } from "vue";
import { PIPS } from "./diceEngine";
import type { DieValue } from "./types";

const props = defineProps<{
  value: DieValue;
  locked: boolean;
}>();

const onPips = computed(() => PIPS[props.value]);
</script>

<template>
  <span class="mini-die" :class="{ locked }" :aria-label="`${value}${locked ? ', vergrendeld' : ''}`">
    <span
      v-for="(_, index) in 9"
      :key="index"
      class="mini-pip"
      :class="{ on: onPips.includes(index) }"
    ></span>
  </span>
</template>

<style scoped>
.mini-die {
  box-sizing: border-box;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 0.08rem;
  padding: 0.16rem;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 0.3rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.25);
  flex: none;
}

.mini-die.locked {
  border-color: rgba(52, 211, 153, 0.6);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.18);
  background: linear-gradient(180deg, rgba(10, 31, 24, 0.98), rgba(15, 23, 42, 0.96));
}

.mini-pip {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: transparent;
}

.mini-pip.on {
  background: #e2e8f0;
}

.mini-die.locked .mini-pip.on {
  background: #34d399;
}
</style>
