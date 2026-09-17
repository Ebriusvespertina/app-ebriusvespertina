<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Icon } from "@iconify/vue";
import type { SpinSpeed, WheelSettings } from "./types";
import { SPIN_SPEED_LABELS } from "./wheelEngine";

const props = defineProps<{
  settings: WheelSettings;
  historyCount: number;
}>();

const emit = defineEmits<{
  change: [patch: Partial<WheelSettings>];
  resetAll: [];
  clearHistory: [];
}>();

const SPIN_SPEEDS: SpinSpeed[] = ["fast", "normal", "slow"];

const confirmReset = ref(false);
let confirmTimer: number | null = null;

function requestReset() {
  if (!confirmReset.value) {
    confirmReset.value = true;
    if (confirmTimer !== null) {
      window.clearTimeout(confirmTimer);
    }
    confirmTimer = window.setTimeout(() => {
      confirmReset.value = false;
    }, 4000);
    return;
  }
  if (confirmTimer !== null) {
    window.clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  confirmReset.value = false;
  emit("resetAll");
}

onBeforeUnmount(() => {
  if (confirmTimer !== null) {
    window.clearTimeout(confirmTimer);
  }
});
</script>

<template>
  <div class="panel-stack">
    <section class="panel" aria-label="Geluid en trillen">
      <h2 class="panel-title">Geluid &amp; feedback</h2>
      <label class="setting">
        <span class="setting-text">
          <span class="setting-name">Geluid</span>
          <span class="setting-desc">
            Tikgeluid tijdens het draaien en een jingle bij de winnaar.
          </span>
        </span>
        <button
          class="switch"
          type="button"
          role="switch"
          :class="{ on: settings.sound }"
          :aria-checked="settings.sound"
          :aria-label="`Geluid ${settings.sound ? 'uit' : 'aan'}`"
          @click="emit('change', { sound: !settings.sound })"
        >
          <span class="switch-knob"></span>
        </button>
      </label>
      <label class="setting">
        <span class="setting-text">
          <span class="setting-name">Trillen bij winnaar</span>
          <span class="setting-desc">
            Korte trilling op je telefoon zodra het rad stopt.
          </span>
        </span>
        <button
          class="switch"
          type="button"
          role="switch"
          :class="{ on: settings.vibrate }"
          :aria-checked="settings.vibrate"
          :aria-label="`Trillen ${settings.vibrate ? 'uit' : 'aan'}`"
          @click="emit('change', { vibrate: !settings.vibrate })"
        >
          <span class="switch-knob"></span>
        </button>
      </label>
    </section>

    <section class="panel" aria-label="Spinduur">
      <h2 class="panel-title">Spinduur</h2>
      <p class="panel-desc">Hoe lang het rad draait voordat de winnaar valt.</p>
      <div class="segmented" role="radiogroup" aria-label="Spinduur">
        <button
          v-for="speed in SPIN_SPEEDS"
          :key="speed"
          class="segment"
          type="button"
          role="radio"
          :aria-checked="settings.spinSpeed === speed"
          :class="{ active: settings.spinSpeed === speed }"
          @click="emit('change', { spinSpeed: speed })"
        >
          {{ SPIN_SPEED_LABELS[speed] }}
        </button>
      </div>
    </section>

    <section class="panel" aria-label="Gegevens">
      <h2 class="panel-title">Gegevens</h2>
      <button
        class="btn-ghost danger"
        type="button"
        :disabled="historyCount === 0"
        @click="emit('clearHistory')"
      >
        <Icon icon="lucide:eraser" width="15" height="15" aria-hidden="true" />
        <span>Geschiedenis wissen ({{ historyCount }})</span>
      </button>
      <button
        class="btn-ghost danger"
        type="button"
        :class="{ armed: confirmReset }"
        @click="requestReset"
      >
        <Icon
          :icon="confirmReset ? 'lucide:alert-triangle' : 'lucide:rotate-ccw'"
          width="15"
          height="15"
          aria-hidden="true"
        />
        <span>
          {{
            confirmReset
              ? "Tik nogmaals om te bevestigen"
              : "Keuzes en geschiedenis resetten"
          }}
        </span>
      </button>
      <p class="panel-desc">
        Alles wordt alleen op dit toestel opgeslagen. De reset zet de keuzes
        terug naar de standaardpreset en wist de geschiedenis.
      </p>
    </section>
  </div>
</template>

<style scoped>
.panel-stack {
  display: grid;
  gap: 1rem;
  align-content: start;
}

.panel {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  padding: 1rem;
  display: grid;
  gap: 0.7rem;
  min-width: 0;
}

.panel-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.panel-desc {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: #94a3b8;
}

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  cursor: pointer;
}

.setting + .setting {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.setting-text {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.setting-name {
  font-weight: 600;
  font-size: 0.92rem;
  color: #e2e8f0;
}

.setting-desc {
  font-size: 0.8rem;
  line-height: 1.45;
  color: #94a3b8;
}

.switch {
  appearance: none;
  position: relative;
  flex-shrink: 0;
  width: 3rem;
  height: 1.75rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(15, 23, 42, 0.7);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.switch-knob {
  position: absolute;
  top: 0.2rem;
  left: 0.2rem;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 999px;
  background: #94a3b8;
  transition:
    transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1.2),
    background-color 0.18s ease;
}

.switch.on {
  background: linear-gradient(135deg, #fb7185, #e11d48);
  border-color: rgba(251, 113, 133, 0.6);
}

.switch.on .switch-knob {
  transform: translateX(1.25rem);
  background: #fff;
}

.switch:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 2px;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  padding: 0.3rem;
  border-radius: var(--radius-lg);
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-subtle);
}

.segment {
  appearance: none;
  border: none;
  border-radius: var(--radius-md);
  padding: 0.55rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.segment.active {
  color: #f8fafc;
  background: linear-gradient(135deg, rgba(251, 113, 133, 0.85), rgba(225, 29, 72, 0.9));
  box-shadow: 0 4px 12px rgba(244, 63, 94, 0.3);
}

.segment:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 2px;
}

.btn-ghost {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
  border-radius: 0.6rem;
  padding: 0.6rem 0.75rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease,
    transform 0.1s ease;
}

.btn-ghost:hover:not(:disabled) {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.9);
}

.btn-ghost:active:not(:disabled) {
  transform: scale(0.99);
}

.btn-ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn-ghost.danger {
  color: #fda4af;
  border-color: rgba(251, 113, 133, 0.3);
}

.btn-ghost.danger:hover:not(:disabled) {
  color: #fecaca;
  border-color: rgba(251, 113, 133, 0.55);
  background: rgba(244, 63, 94, 0.14);
}

.btn-ghost.armed {
  color: #fff;
  background: linear-gradient(135deg, #e11d48, #be123c);
  border-color: rgba(244, 63, 94, 0.7);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(244, 63, 94, 0);
  }
}
</style>
