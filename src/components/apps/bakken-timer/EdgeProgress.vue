<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { TimerPhase } from "./types";

const props = defineProps<{
  phase: TimerPhase;
  holdProgress: number;
  runProgress: number;
  overTarget: boolean;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const rect = reactive({ x: 1, y: 1, width: 0, height: 0, rx: 24 });
let resizeObserver: ResizeObserver | null = null;
let resizeFallback: (() => void) | null = null;

function updateSize() {
  const el = svgRef.value;
  if (!el) {
    return;
  }
  const w = el.clientWidth;
  const h = el.clientHeight;
  rect.x = 1;
  rect.y = 1;
  rect.width = Math.max(0, w - 2);
  rect.height = Math.max(0, h - 2);
  rect.rx = Math.min(28, rect.width / 2, rect.height / 2);
}

onMounted(() => {
  updateSize();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(updateSize);
    if (svgRef.value) {
      resizeObserver.observe(svgRef.value);
    }
  } else {
    resizeFallback = () => updateSize();
    globalThis.addEventListener("resize", resizeFallback);
    globalThis.addEventListener("orientationchange", resizeFallback);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (resizeFallback) {
    globalThis.removeEventListener("resize", resizeFallback);
    globalThis.removeEventListener("orientationchange", resizeFallback);
    resizeFallback = null;
  }
});

const visible = computed(() => props.phase !== "idle");

const fillProgress = computed(() => {
  if (props.phase === "result") {
    return 1;
  }
  if (props.phase === "running") {
    return props.runProgress;
  }
  return props.holdProgress;
});

const tone = computed(() => {
  if (props.phase === "result") {
    return "done";
  }
  if (props.phase === "arming" && props.holdProgress >= 1) {
    return "ready";
  }
  if (props.phase === "running") {
    return props.overTarget ? "over" : "running";
  }
  return "arming";
});
</script>

<template>
  <svg
    ref="svgRef"
    class="edge"
    :class="[`tone-${tone}`, { visible }]"
    aria-hidden="true"
  >
    <rect
      class="track"
      :x="rect.x"
      :y="rect.y"
      :width="rect.width"
      :height="rect.height"
      :rx="rect.rx"
      pathLength="100"
    />
    <rect
      class="fill"
      :class="{ 'no-fill': fillProgress < 0.02 }"
      :x="rect.x"
      :y="rect.y"
      :width="rect.width"
      :height="rect.height"
      :rx="rect.rx"
      pathLength="100"
      :style="{ strokeDashoffset: 100 - fillProgress * 100 }"
    />
  </svg>
</template>

<style scoped>
.edge {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.25s ease;
}

.edge.visible {
  opacity: 1;
}

.track {
  fill: none;
  stroke: rgba(217, 119, 6, 0.5);
  stroke-width: 8;
}

.fill {
  fill: none;
  stroke: #facc15;
  stroke-width: 8;
  stroke-linecap: round;
  filter: drop-shadow(0 0 8px rgba(250, 204, 21, 0.55));
  transition:
    stroke-dashoffset 70ms linear,
    stroke 0.2s ease;
}

.fill.no-fill {
  visibility: hidden;
}

.edge.tone-ready .fill {
  stroke: #fde047;
  filter: drop-shadow(0 0 10px rgba(253, 224, 71, 0.7));
}

.edge.tone-done .fill {
  stroke: #34d399;
  filter: drop-shadow(0 0 8px rgba(52, 211, 153, 0.6));
}

.edge.tone-running .fill,
.edge.tone-over .fill {
  animation: edge-fade 1.6s ease-in-out infinite;
}

.edge.tone-over .fill {
  stroke: #f87171;
  filter: drop-shadow(0 0 6px rgba(248, 113, 113, 0.6));
}

@keyframes edge-fade {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .edge.tone-running .fill,
  .edge.tone-over .fill {
    animation: none;
  }
}
</style>
