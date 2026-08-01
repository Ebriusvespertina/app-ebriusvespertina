<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import type { TimerPhase } from "./types";
import { formatSeconds } from "./bakTimerEngine";

const props = defineProps<{
  phase: TimerPhase;
  elapsedMs: number;
  holdProgress: number;
  runPercent: number;
  hasRecord: boolean;
}>();

const emit = defineEmits<{
  touchDown: [];
  touchUp: [];
}>();

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const dashOffset = computed(() => {
  const progress = props.phase === "result" ? 1 : props.holdProgress;
  return CIRCUMFERENCE * (1 - progress);
});

const bigTime = computed(() => formatSeconds(props.elapsedMs));

const overTarget = computed(() => props.runPercent >= 100);

const runSub = computed(() => {
  if (!props.hasRecord) {
    return `${props.runPercent}% · tik om te stoppen`;
  }
  if (overTarget.value) {
    return "Over record · tik om te stoppen";
  }
  return `${props.runPercent}% van record · tik om te stoppen`;
});

const ariaLabel = computed(() => {
  switch (props.phase) {
    case "arming":
      return "Houd vast om de timer te starten";
    case "running":
      return `Timer loopt: ${bigTime.value} seconden. Tik om te stoppen`;
    case "result":
      return `Bak getrokken in ${bigTime.value} seconden. Houd vast voor een nieuwe poging`;
    default:
      return "Houd vast om de timer te starten";
  }
});

function onKeyDown(event: KeyboardEvent) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    emit("touchDown");
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    emit("touchUp");
  }
}
</script>

<template>
  <button
    class="bak-btn"
    :class="`phase-${phase}`"
    type="button"
    :aria-label="ariaLabel"
    @contextmenu.prevent
    @keydown="onKeyDown"
    @keyup="onKeyUp"
  >
    <svg class="ring" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="ring-track" cx="100" cy="100" :r="RADIUS" />
      <circle
        class="ring-fill"
        cx="100"
        cy="100"
        :r="RADIUS"
        :style="{ strokeDashoffset: dashOffset }"
      />
    </svg>

    <div class="face">
      <template v-if="phase === 'idle'">
        <Icon
          class="beer-icon"
          icon="lucide:beer"
          width="64"
          height="64"
          aria-hidden="true"
        />
        <span class="lead">Houd vast om te starten</span>
        <span class="sub">Laat los na een halve seconde</span>
      </template>

      <template v-else-if="phase === 'arming'">
        <span class="lead">Houd vast…</span>
        <span class="pct">{{ Math.round(holdProgress * 100) }}%</span>
        <span class="sub" :class="{ ready: holdProgress >= 1 }">
          {{ holdProgress >= 1 ? "Laat los om te starten!" : "Laat niet los" }}
        </span>
      </template>

      <template v-else-if="phase === 'running'">
        <span class="big-time">
          {{ bigTime }}<span class="unit">s</span>
        </span>
        <span class="lead run">Bakken!</span>
        <span class="sub" :class="{ over: overTarget }">
          {{ runSub }}
        </span>
      </template>

      <template v-else>
        <span class="big-time result">
          {{ bigTime }}<span class="unit">s</span>
        </span>
        <span class="lead done">Bak!</span>
        <span class="sub">Houd vast voor de volgende ronde</span>
      </template>
    </div>
  </button>
</template>

<style scoped>
.bak-btn {
  position: relative;
  display: block;
  box-sizing: border-box;
  width: min(100%, clamp(14rem, 70vw, 26rem));
  aspect-ratio: 1;
  margin-inline: auto;
  border-radius: 999px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}

.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: rgba(148, 163, 184, 0.18);
  stroke-width: 6;
}

.ring-fill {
  fill: none;
  stroke: #f59e0b;
  stroke-width: 6;
  stroke-linecap: round;
  transition:
    stroke-dashoffset 70ms linear,
    stroke 0.2s ease;
}

.face {
  position: absolute;
  inset: 1.6rem;
  border-radius: 999px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  text-align: center;
  background:
    radial-gradient(circle at 30% 20%, rgba(245, 158, 11, 0.12), transparent 55%),
    linear-gradient(180deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.22);
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.5);
  transition:
    border-color 0.2s ease,
    transform 0.08s ease;
}

.bak-btn:active .face {
  transform: scale(0.99);
}

.big-time {
  font-size: clamp(3rem, 18vw, 5rem);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1;
  color: #f8fafc;
  font-variant-numeric: tabular-nums;
}

.big-time .unit {
  font-size: 0.4em;
  letter-spacing: 0;
  color: #94a3b8;
  font-weight: 700;
  margin-left: 0.1em;
}

.lead {
  font-size: 1.05rem;
  font-weight: 700;
  color: #f8fafc;
}

.lead.run {
  color: #fbbf24;
}

.lead.done {
  color: #34d399;
}

.sub {
  font-size: 0.8rem;
  color: #94a3b8;
}

.sub.ready {
  color: #34d399;
  font-weight: 600;
}

.sub.over {
  color: #f87171;
  font-weight: 600;
}

.pct {
  font-size: 1.4rem;
  font-weight: 700;
  color: #f59e0b;
  font-variant-numeric: tabular-nums;
}

.beer-icon {
  color: #fbbf24;
  margin-bottom: 0.4rem;
}

.phase-arming .face {
  border-color: rgba(245, 158, 11, 0.35);
}

.phase-running .face {
  border-color: rgba(245, 158, 11, 0.4);
  animation: pulse 1.4s ease-in-out infinite;
}

.phase-running .ring-fill {
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.6));
}

.phase-result .face {
  border-color: rgba(52, 211, 153, 0.4);
}

.phase-result .ring-fill {
  stroke: #34d399;
  filter: drop-shadow(0 0 6px rgba(52, 211, 153, 0.5));
}

@keyframes pulse {
  0%,
  100% {
    box-shadow:
      0 18px 40px rgba(2, 6, 23, 0.5),
      0 0 0 0 rgba(245, 158, 11, 0.25);
  }

  50% {
    box-shadow:
      0 18px 40px rgba(2, 6, 23, 0.5),
      0 0 0 12px rgba(245, 158, 11, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .phase-running .face {
    animation: none;
  }
}
</style>
