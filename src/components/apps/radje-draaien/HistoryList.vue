<script setup lang="ts">
import type { SpinRecord } from "./types";

defineProps<{
  history: SpinRecord[];
}>();
</script>

<template>
  <ul class="history">
    <li v-if="history.length === 0" class="empty">Geen spins.</li>
    <li v-for="item in history" :key="item.iso + item.label">
      <time :datetime="item.iso">{{ item.time }}</time>
      <span class="winner">{{ item.label }}</span>
    </li>
  </ul>
</template>

<style scoped>
.history {
  list-style: none;
  padding: 0.2rem 0;
  margin: 0;
  display: grid;
  gap: 0;
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.38);
}

.history li {
  display: grid;
  grid-template-columns: 7.2rem 1fr;
  align-items: baseline;
  column-gap: 0.85rem;
  padding: 0.62rem 0.7rem;
  font-size: 0.9rem;
}

.history li + li {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.winner {
  font-weight: 600;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

time {
  display: block;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
  text-align: left;
}

.empty {
  display: block;
  color: #94a3b8;
}
</style>
