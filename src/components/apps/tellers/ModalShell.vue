<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

const props = withDefaults(
  defineProps<{
    title: string;
    /** Close when the backdrop or Escape is used. Defaults to true. */
    dismissible?: boolean;
  }>(),
  { dismissible: true },
);

const emit = defineEmits<{ close: [] }>();

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.dismissible) {
    emit("close");
  }
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  document.body.style.overflow = "hidden";
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @click.self="dismissible && $emit('close')">
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="header">
          <h2>{{ title }}</h2>
          <button
            v-if="dismissible"
            class="close"
            type="button"
            aria-label="Sluiten"
            @click="$emit('close')"
          >
            ✕
          </button>
        </header>
        <div class="body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(2, 6, 23, 0.7);
  backdrop-filter: blur(4px);
}

.panel {
  width: min(100%, 26rem);
  max-height: min(85dvh, 40rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(180deg, #16213a, #0f172a);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-soft);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem 1rem 0.6rem;
}

.header h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.close {
  appearance: none;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1rem;
  line-height: 1;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.close:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.12);
}

.body {
  padding: 0.6rem 1rem 1rem;
  overflow-y: auto;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0.8rem 1rem 1rem;
  border-top: 1px solid var(--border-subtle);
}
</style>
