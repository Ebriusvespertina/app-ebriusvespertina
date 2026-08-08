<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import ModalShell from "./ModalShell.vue";
import type { Category, Counter } from "./types";
import { MAX_VALUE, MIN_VALUE } from "./countersEngine";

const EMOTICONS = [
  "🍺", "🍷", "🥃", "🍾", "🍸", "🍻",
  "💧", "🥤", "☕", "🏃", "💪", "🚴",
  "🏊", "📖", "💵", "🎯", "📅", "⭐",
];

const props = defineProps<{
  /** When given, the form edits this counter; otherwise it creates a new one. */
  counter?: Counter | null;
  categories: Category[];
}>();

const emit = defineEmits<{
  save: [payload: { name: string; icon: string; value: number; categoryId: string | null }];
  delete: [id: string];
  close: [];
}>();

const form = reactive({
  name: props.counter?.name ?? "",
  icon: props.counter?.icon ?? "",
  value: props.counter?.value ?? 0,
  categoryId: props.counter?.categoryId ?? null,
});

const valueText = ref(String(props.counter?.value ?? 0));
const error = ref("");

const isEditing = computed(() => props.counter !== null && props.counter !== undefined);
const title = computed(() => (isEditing.value ? "Teller bewerken" : "Nieuwe teller"));

function pickEmoticon(emoticon: string) {
  form.icon = form.icon === emoticon ? "" : emoticon;
}

function parseValue() {
  const parsed = Number(valueText.value.trim());
  if (!Number.isFinite(parsed)) {
    error.value = "Voer een geldig getal in.";
    return null;
  }
  return Math.min(MAX_VALUE, Math.max(MIN_VALUE, Math.round(parsed)));
}

function submit() {
  const name = form.name.trim();
  if (!name) {
    error.value = "Geef de teller een naam.";
    return;
  }
  const value = parseValue();
  if (value === null) {
    return;
  }
  error.value = "";
  emit("save", {
    name,
    icon: form.icon,
    value,
    categoryId: form.categoryId,
  });
}
</script>

<template>
  <ModalShell :title="title" @close="emit('close')">
    <form class="form" @submit.prevent="submit">
      <label class="field">
        <span>Naam</span>
        <input
          v-model="form.name"
          type="text"
          maxlength="60"
          placeholder="Bijv. Bier, Push-ups"
          autofocus
          required
        />
      </label>

      <div class="field">
        <span>Icoon</span>
        <div class="emoticon-grid">
          <button
            v-for="emoticon in EMOTICONS"
            :key="emoticon"
            class="emoticon"
            :class="{ active: form.icon === emoticon }"
            type="button"
            :aria-label="`Icoon ${emoticon}`"
            @click="pickEmoticon(emoticon)"
          >
            {{ emoticon }}
          </button>
        </div>
        <input
          v-model="form.icon"
          type="text"
          maxlength="16"
          placeholder="Of typ zelf een icoon/emoji"
        />
      </div>

      <label class="field">
        <span>Waarde</span>
        <input v-model="valueText" type="text" inputmode="numeric" />
      </label>

      <label class="field">
        <span>Categorie</span>
        <select v-model="form.categoryId">
          <option :value="null">Zonder categorie</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button
          v-if="isEditing"
          class="btn danger"
          type="button"
          @click="emit('delete', props.counter!.id)"
        >
          Verwijderen
        </button>
        <span class="spacer" />
        <button class="btn ghost" type="button" @click="emit('close')">
          Annuleren
        </button>
        <button class="btn primary" type="submit">
          {{ isEditing ? "Opslaan" : "Toevoegen" }}
        </button>
      </div>
    </form>
  </ModalShell>
</template>

<style scoped>
.form {
  display: grid;
  gap: 0.85rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field > span {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

input,
select {
  width: 100%;
  font: inherit;
  font-size: 0.95rem;
  color: #f8fafc;
  background: rgba(2, 6, 23, 0.55);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  padding: 0.6rem 0.7rem;
  outline: none;
}

input:focus,
select:focus {
  border-color: #38bdf8;
}

select {
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, #94a3b8 50%),
    linear-gradient(135deg, #94a3b8 50%, transparent 50%);
  background-position:
    calc(100% - 1.1rem) 50%,
    calc(100% - 0.85rem) 50%;
  background-size:
    0.25rem 0.25rem,
    0.25rem 0.25rem;
  background-repeat: no-repeat;
}

select option {
  background: #0f172a;
  color: #f8fafc;
}

.emoticon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.35rem;
}

.emoticon {
  appearance: none;
  border: 1px solid var(--border-subtle);
  background: rgba(15, 23, 42, 0.6);
  border-radius: var(--radius-md);
  font-size: 1.15rem;
  line-height: 1;
  padding: 0.45rem 0;
  cursor: pointer;
}

.emoticon:hover {
  border-color: var(--border-strong);
}

.emoticon.active {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.16);
}

.error {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: #f87171;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.2rem;
}

.spacer {
  flex: 1;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  padding: 0.55rem 1rem;
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

.ghost:hover {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.4);
  background: rgba(30, 41, 59, 0.9);
}

.primary {
  background: #38bdf8;
  color: #062033;
}

.primary:hover {
  background: #7dd3fc;
}

.danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.45);
  color: #fca5a5;
}

.danger:hover {
  background: rgba(239, 68, 68, 0.28);
}
</style>
