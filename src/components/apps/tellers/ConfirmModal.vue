<script setup lang="ts">
import ModalShell from "./ModalShell.vue";

withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel: string;
    /** Renders the confirm button in the destructive style. */
    danger?: boolean;
  }>(),
  { danger: false },
);

const emit = defineEmits<{ confirm: []; close: [] }>();
</script>

<template>
  <ModalShell :title="title" @close="emit('close')">
    <p class="message">{{ message }}</p>
    <template #footer>
      <button class="btn ghost" type="button" @click="emit('close')">
        Annuleren
      </button>
      <button
        class="btn confirm"
        :class="{ danger }"
        type="button"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.message {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.55;
  color: #cbd5e1;
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

.confirm {
  background: #38bdf8;
  color: #062033;
}

.confirm:hover {
  background: #7dd3fc;
}

.confirm.danger {
  background: #ef4444;
  color: #450a0a;
}

.confirm.danger:hover {
  background: #f87171;
}
</style>
