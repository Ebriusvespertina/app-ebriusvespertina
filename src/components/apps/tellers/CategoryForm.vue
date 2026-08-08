<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import ModalShell from "./ModalShell.vue";

const props = defineProps<{
  /** When given, the form renames this category; otherwise it creates a new one. */
  category?: { id: string; name: string } | null;
}>();

const emit = defineEmits<{
  save: [name: string];
  delete: [id: string];
  close: [];
}>();

const form = reactive({ name: props.category?.name ?? "" });
const error = ref("");

const isEditing = computed(() => props.category !== null && props.category !== undefined);
const title = computed(() => (isEditing.value ? "Categorie bewerken" : "Nieuwe categorie"));

function submit() {
  const name = form.name.trim();
  if (!name) {
    error.value = "Geef de categorie een naam.";
    return;
  }
  emit("save", name);
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
          placeholder="Bijv. Drank, Sport"
          autofocus
          required
        />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button
          v-if="isEditing"
          class="btn danger"
          type="button"
          @click="emit('delete', props.category!.id)"
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

input {
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

input:focus {
  border-color: #38bdf8;
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
