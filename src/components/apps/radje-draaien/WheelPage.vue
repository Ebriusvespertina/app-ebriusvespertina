<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Icon } from "@iconify/vue";
import ChoiceForm from "./ChoiceForm.vue";
import ChoiceList from "./ChoiceList.vue";
import HistoryList from "./HistoryList.vue";
import WheelCanvas from "./WheelCanvas.vue";
import PresetsPanel from "./PresetsPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import type { AppTab, Choice, SpinRecord, WheelPreset, WheelSettings } from "./types";
import {
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
  MIN_WEIGHT,
  PALETTE,
  SPIN_DURATION_BY_SPEED,
  clampWeight,
  formatTimeWithMs,
  makeId,
  normalizeSettings,
  pickWinner,
  presetToChoices,
  totalWeight,
} from "./wheelEngine";

const STORAGE_KEY = "radje-draaien:v1";
const HISTORY_LIMIT = 10;

const TABS: { id: AppTab; label: string; icon: string }[] = [
  { id: "wheel", label: "Rad", icon: "lucide:loader-pinwheel" },
  { id: "choices", label: "Keuzes", icon: "lucide:list-plus" },
  { id: "presets", label: "Presets", icon: "lucide:bookmark" },
  { id: "settings", label: "Instellingen", icon: "lucide:settings" },
];

interface StoredState {
  choices: Choice[];
  history: SpinRecord[];
  settings: WheelSettings;
}

function defaultState(): StoredState {
  return {
    choices: presetToChoices(BUILT_IN_PRESETS[0]),
    history: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

function parseStored(raw: unknown): StoredState {
  const value = (raw ?? {}) as Record<string, unknown>;
  const choices = Array.isArray(value.choices)
    ? value.choices
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          id: String(item.id ?? ""),
          label: typeof item.label === "string" ? item.label.trim() : "",
          weight: clampWeight(
            typeof item.weight === "number" ? item.weight : 0,
            0,
          ),
        }))
        .filter((item) => item.label.length > 0)
    : [];
  const history = Array.isArray(value.history)
    ? value.history
        .filter(
          (item): item is SpinRecord =>
            !!item &&
            typeof item === "object" &&
            typeof (item as SpinRecord).label === "string",
        )
        .slice(0, HISTORY_LIMIT)
    : [];
  return {
    choices: choices.length ? choices : presetToChoices(BUILT_IN_PRESETS[0]),
    history,
    settings: normalizeSettings(value.settings),
  };
}

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return parseStored(JSON.parse(raw));
    }
  } catch {
    // storage may be unavailable or corrupted — fall back to defaults
  }
  return defaultState();
}

const initial = loadState();
const choices = ref<Choice[]>(initial.choices);
const spinHistory = ref<SpinRecord[]>(initial.history);
const settings = ref<WheelSettings>(initial.settings);
const activeTab = ref<AppTab>("wheel");
const currentRotation = ref(0);
const isSpinning = ref(false);
const pendingWinner = ref<string | null>(null);
const lastWinner = ref<string | null>(null);
const resultText = ref("");
let lastActiveLabel = "";
let spinFallbackTimer: number | null = null;

const spinDurationMs = computed(() =>
  prefersReducedMotion()
    ? 10
    : SPIN_DURATION_BY_SPEED[settings.value.spinSpeed],
);

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        choices: choices.value,
        history: spinHistory.value,
        settings: settings.value,
      }),
    );
  } catch {
    // storage may be unavailable (private mode, quota) — ignore
  }
}

watch([choices, spinHistory, settings], saveState, { deep: true });

watch(activeTab, () => {
  window.scrollTo(0, 0);
});

// ---- audio (WebAudio, created on the first user gesture) ----

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function ensureAudio(): void {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        audioCtx = new Ctor();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = settings.value.sound ? 1 : 0;
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
    masterGain = null;
  }
}

function beep(
  freq: number,
  dur = 0.06,
  volume = 0.4,
  type: OscillatorType = "square",
  delay = 0,
): void {
  if (!audioCtx || !masterGain) return;
  try {
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + dur);
  } catch {
    /* audio is best-effort */
  }
}

/** Ratchet tick each time a segment boundary passes. */
function soundTick(): void {
  beep(620, 0.035, 0.07, "square");
}

function soundSpinStart(): void {
  beep(240, 0.14, 0.13, "sawtooth");
  beep(520, 0.1, 0.09, "sine", 0.06);
}

function soundWin(): void {
  beep(523.25, 0.13, 0.18, "sine");
  beep(659.25, 0.13, 0.18, "sine", 0.1);
  beep(783.99, 0.22, 0.2, "sine", 0.2);
}

watch(
  () => settings.value.sound,
  (sound) => {
    if (masterGain) {
      masterGain.gain.value = sound ? 1 : 0;
    }
  },
);

function toggleSound() {
  settings.value = { ...settings.value, sound: !settings.value.sound };
}

onBeforeUnmount(() => {
  if (spinFallbackTimer !== null) {
    window.clearTimeout(spinFallbackTimer);
  }
});

// ---- choices ----

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

function moveChoice(id: string, direction: -1 | 1) {
  if (isSpinning.value) {
    return;
  }
  const index = choices.value.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= choices.value.length) {
    return;
  }
  const copy = [...choices.value];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved);
  choices.value = copy;
}

function applyPreset(preset: WheelPreset) {
  if (isSpinning.value) {
    return;
  }
  choices.value = presetToChoices(preset);
  resultText.value = "";
  lastActiveLabel = "";
  lastWinner.value = null;
  pendingWinner.value = null;
  activeTab.value = "wheel";
}

function patchSettings(patch: Partial<WheelSettings>) {
  settings.value = { ...settings.value, ...patch };
}

function resetAll() {
  if (isSpinning.value) {
    return;
  }
  choices.value = presetToChoices(BUILT_IN_PRESETS[0]);
  spinHistory.value = [];
  resultText.value = "";
  lastActiveLabel = "";
  lastWinner.value = null;
  pendingWinner.value = null;
}

function clearHistory() {
  if (isSpinning.value) {
    return;
  }
  spinHistory.value = [];
}

// ---- spinning ----

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
  lastWinner.value = null;

  if (settings.value.sound) {
    ensureAudio();
    soundSpinStart();
  }

  if (spinFallbackTimer !== null) {
    window.clearTimeout(spinFallbackTimer);
  }
  spinFallbackTimer = window.setTimeout(() => {
    spinFallbackTimer = null;
    onSpinEnd();
  }, spinDurationMs.value + 300);
}

function onActiveOption(label: string) {
  if (!isSpinning.value || label === lastActiveLabel) {
    return;
  }
  lastActiveLabel = label;
  resultText.value = label;
  if (settings.value.sound) {
    ensureAudio();
    soundTick();
  }
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
  lastWinner.value = pendingWinner.value;
  resultText.value = `Winnaar: ${pendingWinner.value}`;
  const now = new Date();
  spinHistory.value.unshift({
    label: pendingWinner.value,
    time: formatTimeWithMs(now),
    iso: now.toISOString(),
  });
  spinHistory.value = spinHistory.value.slice(0, HISTORY_LIMIT);
  pendingWinner.value = null;

  if (settings.value.sound) {
    ensureAudio();
    soundWin();
  }
  if (settings.value.vibrate && "vibrate" in navigator) {
    navigator.vibrate(30);
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand-row">
        <div class="brand">
          <span class="brand-icon" aria-hidden="true">
            <Icon icon="lucide:loader-pinwheel" width="20" height="20" />
          </span>
          <span class="brand-title">Radje draaien</span>
        </div>
        <button
          class="mute-btn"
          type="button"
          :aria-pressed="settings.sound"
          :aria-label="settings.sound ? 'Geluid uitzetten' : 'Geluid aanzetten'"
          title="Geluid"
          @click="toggleSound"
        >
          <Icon
            :icon="settings.sound ? 'lucide:volume-2' : 'lucide:volume-x'"
            width="18"
            height="18"
            aria-hidden="true"
          />
        </button>
      </div>
      <nav class="tabs" aria-label="Secties">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          class="tab"
          type="button"
          :class="{ active: activeTab === tab.id }"
          :aria-current="activeTab === tab.id ? 'page' : undefined"
          @click="activeTab = tab.id"
        >
          <Icon :icon="tab.icon" width="16" height="16" aria-hidden="true" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </header>

    <main class="app-main">
      <template v-if="activeTab === 'wheel'">
        <section class="hero" aria-labelledby="page-title">
          <h1 id="page-title">Radje draaien</h1>
          <p>
            Voeg keuzes toe met gewichten en laat het rad voor je kiezen.
            Tik op het rad of op de knop om te draaien.
          </p>
        </section>

        <section class="panel wheel-wrap" aria-label="Rad">
          <WheelCanvas
            :choices="choices"
            :palette="PALETTE"
            :rotation="currentRotation"
            :spinning="isSpinning"
            :spin-duration-ms="spinDurationMs"
            @spin="spin"
            @active-option="onActiveOption"
            @spin-end="onSpinEnd"
          />
          <div
            class="result"
            :class="{ 'result-winner': lastWinner !== null }"
            aria-live="polite"
          >
            {{ resultText }}
          </div>
        </section>

        <section class="panel history-panel" aria-label="Geschiedenis">
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
      </template>

      <template v-else-if="activeTab === 'choices'">
        <section class="panel controls" aria-label="Keuzes">
          <div class="panel-header">
            <h2>Keuzes</h2>
          </div>
          <ChoiceForm
            :min-weight="MIN_WEIGHT"
            :disabled="isSpinning"
            @add-choice="addChoice"
          />
          <ChoiceList
            :choices="choices"
            :palette="PALETTE"
            :disabled="isSpinning"
            @update-label="updateLabel"
            @update-weight="updateWeight"
            @remove-choice="removeChoice"
            @move-choice="moveChoice"
          />
          <p class="hint">
            Gebruik de pijltjes om de volgorde te veranderen. Die bepaalt de
            volgorde van de vakjes op het rad.
          </p>
        </section>
      </template>

      <template v-else-if="activeTab === 'presets'">
        <PresetsPanel
          :current-choices="choices"
          :disabled="isSpinning"
          @apply-preset="applyPreset"
        />
      </template>

      <template v-else>
        <SettingsPanel
          :settings="settings"
          :history-count="spinHistory.length"
          @change="patchSettings"
          @reset-all="resetAll"
          @clear-history="clearHistory"
        />
      </template>
    </main>
  </div>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(2, 6, 23, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 42rem;
  margin-inline: auto;
  padding: 0.6rem 1rem 0.35rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.brand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.65rem;
  color: #fff;
  background: linear-gradient(135deg, #fb7185, #e11d48);
  box-shadow: 0 4px 12px rgba(244, 63, 94, 0.35);
  flex-shrink: 0;
}

.brand-title {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mute-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--border-muted);
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
  border-radius: 0.6rem;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.mute-btn:hover {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
}

.tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  max-width: 42rem;
  margin-inline: auto;
  padding: 0.25rem 0.6rem 0.55rem;
  gap: 0.3rem;
}

.tab {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.65rem;
  padding: 0.5rem 0.35rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    color 0.15s ease,
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.tab:hover {
  color: #e2e8f0;
}

.tab.active {
  color: #f8fafc;
  background: linear-gradient(135deg, rgba(251, 113, 133, 0.22), rgba(225, 29, 72, 0.18));
  border-color: rgba(251, 113, 133, 0.35);
}

.tab:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: -2px;
}

.app-main {
  width: min(100%, 42rem);
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
}

.hero {
  display: grid;
  gap: 0.5rem;
  padding: 0.5rem 0.1rem 0.25rem;
}

h1 {
  margin: 0;
  font-size: clamp(2rem, 6vw, 2.8rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
  color: #f8fafc;
}

.hero p {
  margin: 0;
  max-width: 40rem;
  font-size: 0.95rem;
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
  padding: 2rem 1rem 1.2rem;
  display: grid;
  place-items: center;
  min-width: 0;
}

.result {
  margin-top: 1rem;
  width: 100%;
  max-width: 24rem;
  min-height: 2.6rem;
  padding: 0.65rem 1rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: rgba(15, 23, 42, 0.55);
  color: #cbd5e1;
  font-size: 0.95rem;
  font-weight: 700;
  text-align: center;
  display: grid;
  place-items: center;
  transition: color 0.2s ease;
}

.result-winner {
  color: #f8fafc;
  border-color: rgba(251, 113, 133, 0.5);
  background: linear-gradient(135deg, rgba(244, 63, 94, 0.24), rgba(15, 23, 42, 0.7));
  animation: winner-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
}

@keyframes winner-pop {
  0% {
    transform: scale(0.9);
    opacity: 0.4;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.hint {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.5;
  color: #94a3b8;
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
  touch-action: manipulation;
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
</style>
