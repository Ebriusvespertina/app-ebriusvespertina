<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Icon } from "@iconify/vue";
import type { Choice, SavedPreset, WheelPreset } from "./types";
import {
  BUILT_IN_PRESETS,
  makeId,
  parsePresetJson,
  serializePreset,
  slugifyName,
} from "./wheelEngine";

const props = defineProps<{
  currentChoices: Choice[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  applyPreset: [preset: WheelPreset];
}>();

const PRESETS_STORAGE_KEY = "radje-draaien:presets:v1";
const MAX_PRESETS = 50;

const savedPresets = ref<SavedPreset[]>(loadSavedPresets());
const newPresetName = ref("");
const status = ref<{ kind: "ok" | "error"; text: string } | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
let statusTimer: number | null = null;

function showStatus(kind: "ok" | "error", text: string) {
  status.value = { kind, text };
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
  }
  statusTimer = window.setTimeout(() => {
    status.value = null;
  }, 4000);
}

function loadSavedPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is SavedPreset =>
          !!item &&
          typeof item === "object" &&
          typeof (item as SavedPreset).name === "string" &&
          Array.isArray((item as SavedPreset).choices),
      )
      .slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(savedPresets.value));
  } catch {
    // storage may be unavailable — ignore
  }
}

function apply(preset: WheelPreset) {
  if (props.disabled) {
    return;
  }
  emit("applyPreset", preset);
  showStatus("ok", `"${preset.name}" geladen op het rad.`);
}

function saveCurrent() {
  const name = newPresetName.value.trim();
  if (!name) {
    showStatus("error", "Geef eerst een naam voor de preset.");
    return;
  }
  if (name.length > 60) {
    showStatus("error", "Naam is te lang (max 60 tekens).");
    return;
  }
  if (!props.currentChoices.length) {
    showStatus("error", "Er zijn geen keuzes om op te slaan.");
    return;
  }

  const existing = savedPresets.value.find((preset) => preset.name === name);
  const preset: SavedPreset = {
    id: existing?.id ?? makeId(),
    name,
    choices: props.currentChoices.map(({ label, weight }) => ({ label, weight })),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  if (existing) {
    savedPresets.value = savedPresets.value.map((item) =>
      item.id === existing.id ? preset : item,
    );
    showStatus("ok", `"${name}" bijgewerkt.`);
  } else {
    savedPresets.value = [preset, ...savedPresets.value].slice(0, MAX_PRESETS);
    showStatus("ok", `"${name}" opgeslagen.`);
  }
  persist();
  newPresetName.value = "";
}

function removePreset(id: string) {
  const found = savedPresets.value.find((preset) => preset.id === id);
  savedPresets.value = savedPresets.value.filter((preset) => preset.id !== id);
  persist();
  if (found) {
    showStatus("ok", `"${found.name}" verwijderd.`);
  }
}

function downloadPreset(preset: WheelPreset) {
  const blob = new Blob([serializePreset(preset)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `radje-${slugifyName(preset.name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showStatus("ok", `"${preset.name}" gedownload.`);
}

async function copyPreset(preset: WheelPreset) {
  try {
    await navigator.clipboard.writeText(serializePreset(preset));
    showStatus("ok", `"${preset.name}" gekopieerd naar het klembord.`);
  } catch {
    showStatus("error", "Kopiëren mislukt — gebruik downloaden.");
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const json = typeof reader.result === "string" ? reader.result : "";
    importJson(json);
  };
  reader.onerror = () => {
    showStatus("error", "Bestand kon niet worden gelezen.");
  };
  reader.readAsText(file);
}

function importJson(json: string) {
  const result = parsePresetJson(json);
  if ("error" in result) {
    showStatus("error", result.error);
    return;
  }
  const existing = savedPresets.value.find(
    (preset) => preset.name === result.preset.name,
  );
  const preset: SavedPreset = {
    id: existing?.id ?? makeId(),
    name: result.preset.name,
    choices: result.preset.choices,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  if (existing) {
    savedPresets.value = savedPresets.value.map((item) =>
      item.id === existing.id ? preset : item,
    );
  } else {
    savedPresets.value = [preset, ...savedPresets.value].slice(0, MAX_PRESETS);
  }
  persist();
  showStatus(
    "ok",
    `Geïmporteerd: "${result.preset.name}". Tik op Gebruik om te laden.`,
  );
}

onBeforeUnmount(() => {
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
  }
});
</script>

<template>
  <div class="panel-stack">
    <section class="panel" aria-label="Preset opslaan">
      <h2 class="panel-title">Opslaan</h2>
      <p class="panel-desc">
        Sla de huidige keuzes op als preset, zodat je ze later in één tik
        terugzet op het rad.
      </p>
      <form class="save-row" @submit.prevent="saveCurrent">
        <input
          v-model="newPresetName"
          class="preset-name-input"
          type="text"
          placeholder="Naam, bijvoorbeeld: Drankjes"
          :disabled="disabled || !currentChoices.length"
          autocomplete="off"
          maxlength="60"
        />
        <button
          class="btn-primary"
          type="submit"
          :disabled="disabled || !currentChoices.length"
        >
          <Icon icon="lucide:bookmark-plus" width="16" height="16" aria-hidden="true" />
          <span>Opslaan</span>
        </button>
      </form>
      <div class="export-row">
        <span class="export-hint">Huidige keuzes delen:</span>
        <button
          class="btn-ghost"
          type="button"
          :disabled="disabled || !currentChoices.length"
          @click="
            downloadPreset({
              name: 'Huidige keuzes',
              choices: currentChoices.map(({ label, weight }) => ({ label, weight })),
            })
          "
        >
          <Icon icon="lucide:download" width="15" height="15" aria-hidden="true" />
          <span>Download</span>
        </button>
        <button
          class="btn-ghost"
          type="button"
          :disabled="disabled || !currentChoices.length"
          @click="
            copyPreset({
              name: 'Huidige keuzes',
              choices: currentChoices.map(({ label, weight }) => ({ label, weight })),
            })
          "
        >
          <Icon icon="lucide:copy" width="15" height="15" aria-hidden="true" />
          <span>Kopieer</span>
        </button>
      </div>
    </section>

    <section class="panel" aria-label="Importeren">
      <h2 class="panel-title">Importeren</h2>
      <p class="panel-desc">
        Importeer een preset-JSON van een ander toestel (of van iemand anders).
        De preset verschijnt in de lijst hieronder; tik daarna op
        <em>Gebruik</em>.
      </p>
      <button
        class="btn-ghost"
        type="button"
        @click="fileInputRef?.click()"
      >
        <Icon icon="lucide:upload" width="15" height="15" aria-hidden="true" />
        <span>Kies bestand…</span>
      </button>
      <input
        ref="fileInputRef"
        class="visually-hidden"
        type="file"
        accept=".json,application/json"
        @change="onFileChange"
      />
    </section>

    <section v-if="savedPresets.length" class="panel" aria-label="Opgeslagen presets">
      <h2 class="panel-title">Opgeslagen presets</h2>
      <ul class="preset-list">
        <li v-for="preset in savedPresets" :key="preset.id" class="preset-item">
          <div class="preset-info">
            <span class="preset-name">{{ preset.name }}</span>
            <span class="preset-meta">{{ preset.choices.length }} keuzes</span>
          </div>
          <div class="preset-actions">
            <button
              class="btn-ghost btn-small"
              type="button"
              :disabled="disabled"
              @click="apply(preset)"
            >
              Gebruik
            </button>
            <button
              class="icon-btn"
              type="button"
              :aria-label="`${preset.name} downloaden`"
              title="Download"
              @click="downloadPreset(preset)"
            >
              <Icon icon="lucide:download" width="15" height="15" aria-hidden="true" />
            </button>
            <button
              class="icon-btn"
              type="button"
              :aria-label="`${preset.name} kopiëren`"
              title="Kopieer"
              @click="copyPreset(preset)"
            >
              <Icon icon="lucide:copy" width="15" height="15" aria-hidden="true" />
            </button>
            <button
              class="icon-btn danger"
              type="button"
              :aria-label="`${preset.name} verwijderen`"
              title="Verwijder"
              @click="removePreset(preset.id)"
            >
              <Icon icon="lucide:trash-2" width="15" height="15" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>
    </section>

    <section class="panel" aria-label="Voorbeeldpresets">
      <h2 class="panel-title">Voorbeeldpresets</h2>
      <ul class="preset-list">
        <li v-for="preset in BUILT_IN_PRESETS" :key="preset.name" class="preset-item">
          <div class="preset-info">
            <span class="preset-name">{{ preset.name }}</span>
            <span class="preset-meta">{{ preset.choices.length }} keuzes</span>
          </div>
          <div class="preset-actions">
            <button
              class="btn-ghost btn-small"
              type="button"
              :disabled="disabled"
              @click="apply(preset)"
            >
              Gebruik
            </button>
            <button
              class="icon-btn"
              type="button"
              :aria-label="`${preset.name} downloaden`"
              title="Download"
              @click="downloadPreset(preset)"
            >
              <Icon icon="lucide:download" width="15" height="15" aria-hidden="true" />
            </button>
            <button
              class="icon-btn"
              type="button"
              :aria-label="`${preset.name} kopiëren`"
              title="Kopieer"
              @click="copyPreset(preset)"
            >
              <Icon icon="lucide:copy" width="15" height="15" aria-hidden="true" />
            </button>
          </div>
        </li>
      </ul>
    </section>

    <p
      v-if="status"
      class="status"
      :class="status.kind"
      role="status"
      aria-live="polite"
    >
      {{ status.text }}
    </p>
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

.save-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.55rem;
}

.preset-name-input {
  height: 2.5rem;
  min-width: 0;
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-md);
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid var(--border-muted);
  font: inherit;
  font-size: 1rem;
  color: #e2e8f0;
}

.preset-name-input:focus-visible {
  border-color: rgba(148, 163, 184, 0.45);
  outline: none;
}

.preset-name-input:disabled {
  opacity: 0.55;
}

.btn-primary {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: none;
  border-radius: var(--radius-md);
  padding: 0 0.9rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #fb7185, #e11d48);
  box-shadow: 0 6px 16px rgba(244, 63, 94, 0.32);
  cursor: pointer;
  touch-action: manipulation;
  transition:
    filter 0.15s ease,
    opacity 0.15s ease;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}

.export-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.export-hint {
  font-size: 0.82rem;
  color: #94a3b8;
}

.btn-ghost {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
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

.btn-small {
  padding: 0.4rem 0.65rem;
  font-size: 0.76rem;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.preset-list {
  list-style: none;
  padding: 0.2rem 0;
  margin: 0;
  display: grid;
  gap: 0;
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.38);
}

.preset-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.6rem 0.7rem;
  min-width: 0;
}

.preset-item + .preset-item {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.preset-info {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.preset-name {
  font-weight: 600;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preset-meta {
  font-size: 0.76rem;
  color: #94a3b8;
}

.preset-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}

.icon-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.5rem;
  min-width: 2.25rem;
  min-height: 2.25rem;
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

.icon-btn :deep(svg) {
  display: block;
}

.icon-btn:hover,
.icon-btn:focus-visible {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
  border-color: rgba(148, 163, 184, 0.28);
}

.icon-btn.danger:hover,
.icon-btn.danger:focus-visible {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.12);
  border-color: rgba(251, 113, 133, 0.28);
}

.status {
  margin: 0;
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-md);
  font-size: 0.85rem;
  font-weight: 600;
  border: 1px solid;
}

.status.ok {
  color: #bbf7d0;
  border-color: rgba(52, 211, 153, 0.35);
  background: rgba(52, 211, 153, 0.1);
}

.status.error {
  color: #fecaca;
  border-color: rgba(251, 113, 133, 0.4);
  background: rgba(244, 63, 94, 0.12);
}
</style>
