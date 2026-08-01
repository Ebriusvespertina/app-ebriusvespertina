<script setup lang="ts">
import { computed } from "vue";
import { PIPS } from "./diceEngine";
import type { DieValue } from "./types";

const props = defineProps<{
  id: number;
  value: DieValue;
  locked: boolean;
  rolling: boolean;
}>();

const emit = defineEmits<{
  toggleLock: [id: number];
  rollEnd: [];
}>();

const onPips = computed(() => PIPS[props.value]);

function toggleLock() {
  emit("toggleLock", props.id);
}
</script>

<template>
  <button
    class="die-wrapper"
    type="button"
    :aria-label="`Dobbelsteen ${id + 1}`"
    @click="toggleLock"
  >
    <span
      class="die"
      :class="{ locked, rolling }"
      @animationend="emit('rollEnd')"
    >
      <span class="die-logo" aria-hidden="true">
        <img src="/dobbel-logo.png" alt="" />
      </span>

      <span
        v-for="(_, index) in 9"
        :key="index"
        class="pip"
        :class="{ on: onPips.includes(index) }"
      ></span>
    </span>

    <span class="die-status" :class="{ 'is-locked': locked }">
      {{ locked ? "Vergrendeld" : "Vergrendel" }}
    </span>
  </button>
</template>

<style scoped>
.die-wrapper {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  user-select: none;
  padding: 0;
  background: transparent;
  border: 0;
  color: inherit;
  width: 100%;
  justify-self: stretch;
}

.die {
  box-sizing: border-box;
  width: 100%;
  aspect-ratio: 1;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 0.24rem;
  padding: 0.65rem;
  border-radius: 1rem;
  background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.18);
  overflow: hidden;
  transition:
    transform 0.12s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}

.die:hover {
  border-color: rgba(52, 211, 153, 0.3);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.1), 0 14px 30px rgba(2, 6, 23, 0.34);
}

.die:active {
  transform: scale(0.96);
}

.die.locked {
  border-color: rgba(52, 211, 153, 0.65);
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.3), 0 18px 36px rgba(16, 185, 129, 0.12);
  background: linear-gradient(180deg, rgba(10, 31, 24, 0.98), rgba(15, 23, 42, 0.96));
}

.pip {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.1s ease, transform 0.1s ease;
  position: relative;
  z-index: 1;
}

.pip.on {
  background: #e2e8f0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.die.locked .pip.on {
  background: #34d399;
}

.die.rolling {
  animation: die-shake 0.35s ease;
}

@keyframes die-shake {
  0% {
    transform: rotate(0) scale(1);
  }

  20% {
    transform: rotate(-7deg) scale(1.04);
  }

  40% {
    transform: rotate(6deg) scale(1.04);
  }

  60% {
    transform: rotate(-4deg) scale(1.02);
  }

  80% {
    transform: rotate(3deg) scale(1.01);
  }

  100% {
    transform: rotate(0) scale(1);
  }
}

.die-logo {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 0;
}

.die-logo img {
  width: 46%;
  height: 46%;
  object-fit: contain;
  opacity: 0.06;
  filter: grayscale(1) brightness(4);
  display: block;
}

.die.locked .die-logo img {
  opacity: 0.12;
  filter: grayscale(0) brightness(1);
}

.die-status {
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
  color: #94a3b8;
  line-height: 1.25;
  min-height: 0.75rem;
  transition: color 0.15s;
}

.die-status.is-locked {
  color: #34d399;
}
</style>
