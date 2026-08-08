<script setup lang="ts">
import { computed, ref, watch } from "vue";
import CounterCard from "./CounterCard.vue";
import CounterForm from "./CounterForm.vue";
import CategoryForm from "./CategoryForm.vue";
import ConfirmModal from "./ConfirmModal.vue";
import type { Category, Counter, CountersState } from "./types";
import {
  STORAGE_KEY,
  addCategory,
  addCounter,
  categoryGroups,
  createCategory,
  createCounter,
  emptyState,
  exportFilename,
  incrementCounter,
  parseState,
  removeCategory,
  removeCounter,
  renameCategory,
  serializeState,
  totals,
  uncategorizedCounters,
  updateCounter,
} from "./countersEngine";

function loadState(): CountersState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return emptyState();
    }
    return parseState(raw) ?? emptyState();
  } catch {
    return emptyState();
  }
}

const state = ref<CountersState>(loadState());

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state.value));
  } catch {
    // storage may be unavailable (private mode, quota) — ignore
  }
}

watch(state, save, { deep: true });

const groups = computed(() => categoryGroups(state.value));
const loose = computed(() => uncategorizedCounters(state.value));
const looseTotal = computed(() => loose.value.reduce((sum, counter) => sum + counter.value, 0));
const grandTotal = computed(() => totals(state.value));
const counterCount = computed(() => state.value.counters.length);

const importInput = ref<HTMLInputElement | null>(null);
const hint = ref("");
let hintTimer: number | null = null;

function showHint(text: string) {
  hint.value = text;
  if (hintTimer !== null) {
    window.clearTimeout(hintTimer);
  }
  if (text) {
    hintTimer = window.setTimeout(() => {
      hint.value = "";
      hintTimer = null;
    }, 3000);
  }
}

/** null = closed, "new" = create, Counter = edit. */
const counterForm = ref<Counter | "new" | null>(null);
const categoryForm = ref<Category | "new" | null>(null);

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

const confirmRequest = ref<ConfirmRequest | null>(null);

function openConfirm(request: Omit<ConfirmRequest, "confirmLabel" | "danger"> & {
  confirmLabel?: string;
  danger?: boolean;
}) {
  confirmRequest.value = {
    confirmLabel: "Doorgaan",
    danger: false,
    ...request,
  };
}

function onSaveCounter(payload: { name: string; icon: string; value: number; categoryId: string | null }) {
  if (counterForm.value === "new") {
    state.value = addCounter(state.value, createCounter(payload.name, payload));
    showHint("Teller toegevoegd.");
  } else if (counterForm.value) {
    state.value = updateCounter(state.value, counterForm.value.id, payload);
    showHint("Teller opgeslagen.");
  }
  counterForm.value = null;
}

function onDeleteCounter(id: string) {
  const counter = state.value.counters.find((c) => c.id === id);
  counterForm.value = null;
  openConfirm({
    title: "Teller verwijderen",
    message: `Weet je zeker dat je "${counter?.name ?? "deze teller"}" wilt verwijderen? De stand is niet meer terug te halen.`,
    confirmLabel: "Verwijderen",
    danger: true,
    onConfirm: () => {
      state.value = removeCounter(state.value, id);
      showHint("Teller verwijderd.");
    },
  });
}

function onSaveCategory(name: string) {
  if (categoryForm.value === "new") {
    state.value = addCategory(state.value, createCategory(name));
    showHint("Categorie toegevoegd.");
  } else if (categoryForm.value) {
    state.value = renameCategory(state.value, categoryForm.value.id, name);
    showHint("Categorie opgeslagen.");
  }
  categoryForm.value = null;
}

function onDeleteCategory(id: string) {
  const category = state.value.categories.find((c) => c.id === id);
  categoryForm.value = null;
  openConfirm({
    title: "Categorie verwijderen",
    message: `Weet je zeker dat je "${category?.name ?? "deze categorie"}" wilt verwijderen? De tellers blijven bewaard en komen onder "Zonder categorie" te staan.`,
    confirmLabel: "Verwijderen",
    danger: true,
    onConfirm: () => {
      state.value = removeCategory(state.value, id);
      showHint("Categorie verwijderd.");
    },
  });
}

function onCount(id: string, delta: number) {
  state.value = incrementCounter(state.value, id, delta);
}

function exportBackup() {
  const blob = new Blob([serializeState(state.value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showHint("Backup gedownload.");
}

const pendingImport = ref<CountersState | null>(null);

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }
  const text = await file.text();
  const parsed = parseState(text);
  if (!parsed) {
    showHint("Geen geldige backup.");
    return;
  }
  pendingImport.value = parsed;
}

function applyImport() {
  if (pendingImport.value) {
    state.value = pendingImport.value;
    showHint("Backup geïmporteerd.");
  }
  pendingImport.value = null;
}

const formatNumber = (value: number) => value.toLocaleString("nl-NL");
</script>

<template>
  <main @contextmenu.prevent>
    <section class="hero" aria-labelledby="page-title">
      <div class="eyebrow">Dispuut Ebrius Vespertina</div>
      <h1 id="page-title">Tellers</h1>
      <p>
        Houd alles bij: biertjes, shotjes, push-ups of kilometers. Tik of houd
        vast om te tellen, groepeer tellers in categorieën en maak een backup.
      </p>
    </section>

    <section class="toolbar" aria-label="Acties">
      <button class="btn primary" type="button" @click="counterForm = 'new'">
        + Teller
      </button>
      <button class="btn ghost" type="button" @click="categoryForm = 'new'">
        + Categorie
      </button>
      <span class="spacer" />
      <button
        class="btn ghost"
        type="button"
        :disabled="counterCount === 0"
        @click="exportBackup"
      >
        Export
      </button>
      <button class="btn ghost" type="button" @click="importInput?.click()">
        Import
      </button>
      <input
        ref="importInput"
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        @change="onImportFile"
      />
    </section>

    <p class="summary" aria-live="polite">
      {{ counterCount }} {{ counterCount === 1 ? "teller" : "tellers" }} ·
      totaal {{ formatNumber(grandTotal) }}
      <span v-if="hint" class="hint">— {{ hint }}</span>
    </p>

    <template v-if="counterCount > 0">
      <section
        v-for="group in groups"
        :key="group.category.id"
        class="panel category"
        :aria-labelledby="`cat-${group.category.id}`"
      >
        <header class="category-header">
          <h2 :id="`cat-${group.category.id}`">{{ group.category.name }}</h2>
          <span class="total">{{ formatNumber(group.total) }}</span>
          <button
            class="icon-btn"
            type="button"
            :aria-label="`Categorie ${group.category.name} bewerken`"
            @click="categoryForm = group.category"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
              />
            </svg>
          </button>
          <button
            class="icon-btn danger"
            type="button"
            :aria-label="`Categorie ${group.category.name} verwijderen`"
            @click="onDeleteCategory(group.category.id)"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
              />
            </svg>
          </button>
        </header>
        <div class="grid">
          <CounterCard
            v-for="counter in group.counters"
            :key="counter.id"
            :counter="counter"
            @count="onCount(counter.id, $event)"
            @edit="counterForm = counter"
          />
        </div>
      </section>

      <section v-if="loose.length > 0" class="panel category" aria-labelledby="cat-loose">
        <header class="category-header">
          <h2 id="cat-loose">Zonder categorie</h2>
          <span class="total">{{ formatNumber(looseTotal) }}</span>
        </header>
        <div class="grid">
          <CounterCard
            v-for="counter in loose"
            :key="counter.id"
            :counter="counter"
            @count="onCount(counter.id, $event)"
            @edit="counterForm = counter"
          />
        </div>
      </section>
    </template>

    <section v-else class="panel empty" aria-labelledby="empty-title">
      <h2 id="empty-title">Nog geen tellers</h2>
      <p>
        Voeg je eerste teller toe met de knop hierboven — bijvoorbeeld
        <span class="example">🍺 Bier</span> of <span class="example">💪 Push-ups</span>.
      </p>
    </section>

    <CounterForm
      v-if="counterForm !== null"
      :counter="counterForm === 'new' ? null : counterForm"
      :categories="state.categories"
      @save="onSaveCounter"
      @delete="onDeleteCounter"
      @close="counterForm = null"
    />

    <CategoryForm
      v-if="categoryForm !== null"
      :category="categoryForm === 'new' ? null : categoryForm"
      @save="onSaveCategory"
      @delete="onDeleteCategory"
      @close="categoryForm = null"
    />

    <ConfirmModal
      v-if="confirmRequest"
      :title="confirmRequest.title"
      :message="confirmRequest.message"
      :confirm-label="confirmRequest.confirmLabel"
      :danger="confirmRequest.danger"
      @confirm="confirmRequest.onConfirm(); confirmRequest = null"
      @close="confirmRequest = null"
    />

    <ConfirmModal
      v-if="pendingImport"
      title="Backup importeren"
      message="De backup vervangt al je huidige tellers en categorieën. Weet je zeker dat je wilt doorgaan?"
      confirm-label="Importeren"
      @confirm="applyImport"
      @close="pendingImport = null"
    />
  </main>
</template>

<style scoped>
main {
  width: min(100%, 62rem);
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
  min-height: 100dvh;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}

.hero {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0.1rem 0.25rem;
}

.eyebrow {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #38bdf8;
}

h1 {
  margin: 0;
  font-size: clamp(2.1rem, 6vw, 3.2rem);
  line-height: 0.98;
  letter-spacing: -0.05em;
  color: #f8fafc;
}

.hero p {
  margin: 0;
  max-width: 42rem;
  font-size: 0.98rem;
  line-height: 1.6;
  color: #94a3b8;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.spacer {
  flex: 1;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.55rem 0.95rem;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.ghost {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
}

.ghost:hover:not(:disabled) {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.9);
}

.ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

.primary {
  background: #38bdf8;
  color: #062033;
}

.primary:hover {
  background: #7dd3fc;
}

.hidden-input {
  display: none;
}

.summary {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #94a3b8;
}

.hint {
  color: #7dd3fc;
}

.panel {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  padding: 1rem;
  min-width: 0;
}

.category {
  display: grid;
  gap: 0.8rem;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.category-header h2 {
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.02rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.total {
  font-size: 0.78rem;
  font-weight: 700;
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: var(--radius-pill);
  padding: 0.22rem 0.6rem;
  font-variant-numeric: tabular-nums;
}

.icon-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: #64748b;
  padding: 0.35rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex: none;
}

.icon-btn:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
}

.icon-btn.danger:hover {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14.5rem, 1fr));
  gap: 0.8rem;
}

.empty {
  display: grid;
  place-items: center;
  gap: 0.4rem;
  text-align: center;
  padding: 2.5rem 1rem;
}

.empty h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 800;
  color: #f8fafc;
}

.empty p {
  margin: 0;
  max-width: 30rem;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #94a3b8;
}

.example {
  color: #e2e8f0;
  font-weight: 600;
}

@media (min-width: 56rem) {
  main {
    padding: 1.5rem;
    gap: 1.25rem;
  }
}
</style>
