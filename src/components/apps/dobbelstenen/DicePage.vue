<script setup lang="ts">
import { computed, ref } from "vue";
import Die from "./Die.vue";
import MiniDie from "./MiniDie.vue";
import { lockedCount, lockedTotal, rollDieValue } from "./diceEngine";
import type { Die as DieModel, DieValue, RollLogEntry } from "./types";

const ROLL_DURATION_MS = 380;
const ROLL_LOG_LIMIT = 50;
const DICE_COUNT = 6;

const lockByValue = ref(true);

let nextLockGroup = 1;

const dice = ref<DieModel[]>(
  Array.from({ length: DICE_COUNT }, (_, id) => ({
    id,
    value: rollDieValue(),
    locked: false,
    lockGroup: null,
  })),
);

const rollingIds = ref<Set<number>>(new Set());
const isRolling = ref(false);

const hasLocked = computed(() => dice.value.some((die) => die.locked));
const allTotal = computed(() => dice.value.reduce((sum, die) => sum + die.value, 0));
const totalValue = computed(() => lockedTotal(dice.value));

const rollLog = ref<RollLogEntry[]>([]);
const rollCounter = ref(0);

const hintText = computed(() => {
  if (lockedCount(dice.value) === DICE_COUNT) {
    return "Alle stenen zijn vergrendeld — reset voor een nieuwe ronde.";
  }
  return lockByValue.value
    ? "Tik om alle gelijke ogen samen te vergrendelen"
    : "Tik om één dobbelsteen te vergrendelen";
});

function snapshotLog(): RollLogEntry["dice"] {
  return dice.value.map((die) => ({ value: die.value, locked: die.locked }));
}

function entrySum(entry: RollLogEntry): number {
  return entry.dice.reduce((sum, die) => sum + die.value, 0);
}

function entryLockedSum(entry: RollLogEntry): number {
  return entry.dice
    .filter((die) => die.locked)
    .reduce((sum, die) => sum + die.value, 0);
}

function toggleLock(id: number) {
  if (isRolling.value) {
    return;
  }

  const die = dice.value[id];
  if (!die) {
    return;
  }

  if (die.locked) {
    const group = die.lockGroup;
    for (const other of dice.value) {
      if (other.lockGroup === group) {
        other.locked = false;
        other.lockGroup = null;
      }
    }
    return;
  }

  const group = nextLockGroup;
  nextLockGroup += 1;

  const targets = lockByValue.value
    ? dice.value.filter((other) => !other.locked && other.value === die.value)
    : [die];

  for (const target of targets) {
    target.locked = true;
    target.lockGroup = group;
  }
}

function rollDice() {
  if (isRolling.value) {
    return;
  }

  const unlocked = dice.value.filter((die) => !die.locked);
  if (!unlocked.length) {
    return;
  }

  isRolling.value = true;
  const nextValues = new Map<number, DieModel["value"]>();

  for (const die of unlocked) {
    nextValues.set(die.id, rollDieValue());
    rollingIds.value.add(die.id);
  }

  window.setTimeout(() => {
    for (const die of dice.value) {
      if (nextValues.has(die.id)) {
        die.value = nextValues.get(die.id) as DieModel["value"];
      }
    }

    rollCounter.value += 1;
    rollLog.value.push({
      roll: rollCounter.value,
      dice: snapshotLog(),
    });
    if (rollLog.value.length > ROLL_LOG_LIMIT) {
      rollLog.value = rollLog.value.slice(-ROLL_LOG_LIMIT);
    }

    rollingIds.value = new Set();
    isRolling.value = false;
  }, ROLL_DURATION_MS);
}

function clearLocks() {
  for (const die of dice.value) {
    die.locked = false;
    die.lockGroup = null;
  }

  rollLog.value = [];
  rollCounter.value = 0;
}
</script>

<template>
  <main class="page">
    <section class="hero" aria-labelledby="page-title">
      <div class="eyebrow">Dispuut Ebrius Vespertina</div>
      <h1 id="page-title">Dobbelstenen</h1>
      <p>Gooi de stenen, vergrendel wat je wilt houden en gooi de rest opnieuw. Doel: boven de 30.</p>
    </section>

    <section class="game-layout" aria-label="Dobbelspel">
      <div class="score-card">
        <div class="stat">
          <div class="stat-label">Alle stenen</div>
          <div class="stat-value">{{ allTotal }}</div>
        </div>

        <div class="stat">
          <div class="stat-label">Vergrendeld</div>
          <div class="stat-value" :class="{ 'has-value': hasLocked }">
            {{ hasLocked ? totalValue : "–" }}
          </div>
        </div>
      </div>

      <div class="dice-panel">
        <div class="dice-panel-header">
          <div class="dice-panel-hint">{{ hintText }}</div>
          <label class="group-toggle">
            <input v-model="lockByValue" type="checkbox" />
            <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
            <span class="toggle-label">Gelijke ogen samen</span>
          </label>
        </div>

        <div class="dice-grid" :class="{ inert: isRolling }">
          <Die
            v-for="die in dice"
            :key="die.id"
            :id="die.id"
            :value="die.value"
            :locked="die.locked"
            :rolling="rollingIds.has(die.id)"
            @toggle-lock="toggleLock"
            @roll-end="rollingIds.delete(die.id)"
          />
        </div>

        <div class="btn-row">
          <button
            class="btn-primary"
            id="rollBtn"
            type="button"
            :disabled="isRolling"
            @click="rollDice"
          >
            {{ isRolling ? "Gooien…" : "Gooien" }}
          </button>
          <button class="btn-secondary" type="button" @click="clearLocks">
            Reset
          </button>
        </div>
      </div>
    </section>

    <section class="log-card" aria-labelledby="log-title">
      <div class="log-header">
        <h2 id="log-title">Worpen</h2>
      </div>

      <ol v-if="rollLog.length" class="log-list">
        <li v-for="entry in rollLog" :key="entry.roll" class="log-entry">
          <span class="log-roll">Worp {{ entry.roll }}</span>
          <span class="log-dice">
            <MiniDie
              v-for="(die, index) in entry.dice"
              :key="index"
              :value="die.value"
              :locked="die.locked"
            />
          </span>
          <span class="log-scores">
            <span class="log-total">{{ entrySum(entry) }}</span>
            <span class="log-locked" :class="{ 'has-value': entryLockedSum(entry) > 0 }">
              {{ entryLockedSum(entry) > 0 ? entryLockedSum(entry) : "–" }}
            </span>
          </span>
        </li>
      </ol>
      <p v-else class="log-empty">Nog geen worpen geregistreerd.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  max-width: 72rem;
  margin: 0 auto;
  padding: 1rem;
  display: grid;
  gap: 1rem;
  align-content: start;
  min-height: 100dvh;
}

@media (min-width: 48rem) {
  .page {
    padding: 1.5rem;
    gap: 1.25rem;
  }
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
  color: #34d399;
}

h1 {
  margin: 0;
  font-size: clamp(2.1rem, 6vw, 3.6rem);
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

.game-layout {
  display: grid;
  gap: 1rem;
}

@media (min-width: 48rem) {
  .game-layout {
    grid-template-columns: minmax(16rem, 18rem) minmax(0, 1fr);
    align-items: start;
  }
}

.score-card,
.dice-panel,
.log-card {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.75));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.score-card {
  box-sizing: border-box;
  padding: 1.25rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (min-width: 48rem) {
  .score-card {
    position: sticky;
    top: 1.5rem;
  }
}

.stat {
  display: grid;
  gap: 0.35rem;
}

.stat-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #94a3b8;
}

.stat-value {
  font-size: clamp(2.2rem, 10vw, 3.6rem);
  line-height: 0.92;
  font-weight: 800;
  letter-spacing: -0.08em;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.stat-value.has-value {
  color: #34d399;
}

.dice-panel {
  box-sizing: border-box;
  padding: 1rem;
  display: grid;
  gap: 1rem;
}

@media (min-width: 40rem) {
  .dice-panel {
    padding: 1.15rem;
    gap: 1.1rem;
  }
}

.dice-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.dice-panel-hint {
  font-size: 0.78rem;
  color: #94a3b8;
}

.group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
  font-size: 0.78rem;
  font-weight: 600;
  color: #cbd5e1;
}

.group-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-track {
  position: relative;
  width: 2.5rem;
  height: 1.4rem;
  flex: none;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.32);
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.toggle-thumb {
  position: absolute;
  top: 50%;
  left: 0.18rem;
  transform: translateY(-50%);
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: #94a3b8;
  transition:
    transform 0.16s ease,
    background-color 0.16s ease;
}

.group-toggle input:checked + .toggle-track {
  background: rgba(16, 185, 129, 0.28);
  border-color: rgba(52, 211, 153, 0.55);
}

.group-toggle input:checked + .toggle-track .toggle-thumb {
  transform: translate(1.08rem, -50%);
  background: #34d399;
}

.group-toggle input:focus-visible + .toggle-track {
  box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.25);
}

.dice-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.dice-grid.inert {
  pointer-events: none;
}

@media (min-width: 30rem) {
  .dice-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (min-width: 48rem) {
  .dice-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.btn-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn-primary,
.btn-secondary {
  box-sizing: border-box;
  appearance: none;
  border: 0;
  border-radius: 0.9rem;
  font: inherit;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    transform 0.1s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease;
}

.btn-primary {
  flex: 1 1 10rem;
  padding: 0.9rem 1.15rem;
  background: linear-gradient(180deg, #34d399 0%, #10b981 100%);
  color: #f8fafc;
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.24);
}

.btn-primary:hover {
  box-shadow: 0 12px 30px rgba(16, 185, 129, 0.32);
}

.btn-primary:active,
.btn-secondary:active {
  transform: translateY(1px) scale(0.99);
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: default;
  box-shadow: none;
}

.btn-secondary {
  padding: 0.9rem 1rem;
  background: rgba(15, 23, 42, 0.5);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.btn-secondary:hover {
  color: #f8fafc;
  border-color: rgba(148, 163, 184, 0.35);
}

.log-card {
  box-sizing: border-box;
  padding: 1rem;
}

@media (min-width: 40rem) {
  .log-card {
    padding: 1.15rem;
  }
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
}

.log-header h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}

.log-entry {
  display: grid;
  grid-template-columns: 5rem 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.log-roll {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.log-dice {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.log-total {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.log-scores {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  font-variant-numeric: tabular-nums;
}

.log-scores .log-total {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f8fafc;
}

.log-locked {
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #94a3b8;
}

.log-locked.has-value {
  color: #34d399;
}

.log-empty {
  margin: 0;
  padding: 0.75rem 0;
  font-size: 0.86rem;
  color: #94a3b8;
}
</style>
