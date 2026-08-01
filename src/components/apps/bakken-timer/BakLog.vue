<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import type { BakEntry } from "./types";
import { averageTime, bestTime, formatDuration, formatTime } from "./bakTimerEngine";

const props = defineProps<{
  entries: BakEntry[];
}>();

const emit = defineEmits<{
  removeEntry: [id: string];
}>();

const best = computed(() => bestTime(props.entries));
const average = computed(() => averageTime(props.entries));
</script>

<template>
  <div v-if="entries.length" class="stats">
    <span class="stat"><b>{{ entries.length }}</b> bakken</span>
    <span class="stat"
      >Snelste
      <b>{{ best !== null ? formatDuration(best) : "–" }}</b></span
    >
    <span class="stat"
      >Gemiddeld
      <b>{{ average !== null ? formatDuration(average) : "–" }}</b></span
    >
  </div>

  <ul class="list">
    <li v-if="!entries.length" class="empty">Nog geen bakken getrokken.</li>
    <li
      v-for="(entry, index) in entries"
      :key="entry.id"
      class="entry"
      :class="{ 'is-best': best !== null && entry.timeMs === best }"
    >
      <span class="rank">{{ index + 1 }}</span>
      <span class="duration">{{ formatDuration(entry.timeMs) }}</span>
      <span class="meta">
        <time :datetime="entry.at">{{ formatTime(new Date(entry.at)) }}</time>
        <span v-if="best !== null && entry.timeMs === best" class="badge"
          >Beste</span
        >
      </span>
      <button
        class="remove"
        type="button"
        :aria-label="`Verwijder ${formatDuration(entry.timeMs)}`"
        @click="emit('removeEntry', entry.id)"
      >
        <Icon icon="lucide:x" width="16" height="16" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  font-size: 0.84rem;
  color: #94a3b8;
  padding: 0.25rem 0.1rem 0.55rem;
}

.stat b {
  color: #f8fafc;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.list {
  list-style: none;
  padding: 0.2rem 0;
  margin: 0;
  display: grid;
  grid-template-columns: 1.7rem minmax(0, 1fr) 2.75rem;
  gap: 0;
  border-radius: 0.8rem;
  background: rgba(15, 23, 42, 0.32);
}

.entry {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 1.7rem minmax(0, 1fr) 2.75rem;
  grid-template-areas:
    "rank duration remove"
    ". meta .";
  gap: 0.35rem;
  align-items: center;
  padding: 0.5rem 0.4rem;
  min-width: 0;
}

.entry + .entry {
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.entry.is-best {
  background: rgba(52, 211, 153, 0.07);
}

.rank {
  grid-area: rank;
  font-size: 0.78rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
  text-align: center;
}

.duration {
  grid-area: duration;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry.is-best .duration {
  color: #34d399;
}

.meta {
  grid-area: meta;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.meta time {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: #94a3b8;
  white-space: nowrap;
}

.badge {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.4);
  border-radius: 999px;
  padding: 0.12rem 0.4rem;
  white-space: nowrap;
}

.remove {
  grid-area: remove;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: #94a3b8;
  border-radius: 0.5rem;
  min-width: 2.75rem;
  min-height: 2.75rem;
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

.remove :deep(svg) {
  display: block;
}

.remove:hover,
.remove:focus-visible {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.12);
  border-color: rgba(251, 113, 133, 0.28);
}

.remove:active {
  background: rgba(251, 113, 133, 0.22);
}

.empty {
  display: block;
  padding: 0.75rem 0.2rem;
  color: #94a3b8;
  font-size: 0.9rem;
}

@media (min-width: 36rem) {
  .list {
    grid-template-columns: 1.7rem minmax(0, 1fr) auto 2.25rem;
  }

  .entry {
    grid-template-columns: 1.7rem minmax(0, 1fr) auto 2.25rem;
    grid-template-areas: "rank duration meta remove";
    gap: 0.6rem;
    padding: 0.45rem 0.5rem;
  }

  .remove {
    min-width: 2.25rem;
    min-height: 2.25rem;
  }
}

@media (max-width: 22rem) {
  .list {
    grid-template-columns: 1.4rem minmax(0, 1fr) 2.5rem;
  }

  .entry {
    grid-template-columns: 1.4rem minmax(0, 1fr) 2.5rem;
  }
}
</style>
