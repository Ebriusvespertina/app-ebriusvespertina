<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { BOTTOM_COLOR, TOP_COLOR } from "./timingRender";
import type { SkillResult } from "./timingRender";
import type { PlayerIndex } from "./timingEngine";

const props = defineProps<{ result: SkillResult }>();

const curveRef = ref<HTMLCanvasElement | null>(null);

/** Cheeky statistical verdict for the bell-curve screen. */
function verdict(mean: number, sigma: number, hits: number): string {
  if (!Number.isFinite(mean) || hits === 0) {
    return "Geen data — de curve weigert te verschijnen.";
  }
  if (mean <= 30) return "Machine. Nauwelijks menselijk.";
  if (mean <= 60) return "Scherp. Statistisch significant beter dan de rest.";
  if (mean <= 100) return "Solide. Precies waar de curve je verwacht.";
  if (mean <= 160) return "Gemiddeld. De gauss is mild voor jou.";
  return "De curve is niet jouw vriend. Oefenen!";
}

function verdictText(p: PlayerIndex): string {
  return verdict(props.result.stats[p].mean, props.result.stats[p].sigma, props.result.stats[p].hits);
}

/** Main stats line, e.g. "Gemiddeld 43 ms · Spreiding 21 ms · Beste 5 ms". */
function playerStats(p: PlayerIndex): string {
  const s = props.result.stats[p];
  const avg = Math.round(s.avg);
  if (s.hits === 0) return `Gemiddeld ${avg} ms · 0 raak · ${s.misses} miss`;
  return `Gemiddeld ${avg} ms · Spreiding ${Math.round(s.sigma)} ms · Beste ${Math.round(s.best)} ms`;
}

/** Attempt breakdown, e.g. "12 pogingen · 8 raak (5× great, 3× good) · 4 miss". */
function attemptText(p: PlayerIndex): string {
  const s = props.result.stats[p];
  return `${s.hits + s.misses} pogingen · ${s.hits} raak (${s.greats}× great, ${s.goods}× good) · ${s.misses} miss`;
}

/** Histogram + fitted bell curve per player, stacked: BOVEN on top, ONDER
    below. The x-axis is scaled to each player's own data (mean ± 3σ) so the
    curve fills its panel instead of hugging the left edge. */
function drawCurves(): void {
  const canvas = curveRef.value;
  if (!canvas) return;
  const c = canvas.getContext("2d");
  if (!c) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 360;
  const H = 292;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);

  const panelH = (H - 12) / 2;
  const left = 8;
  const pw = W - 16;
  const bins = 8;

  for (let p = 0 as PlayerIndex; p < 2; p = (p + 1) as PlayerIndex) {
    const color = p === 0 ? TOP_COLOR : BOTTOM_COLOR;
    const y0 = 6 + p * panelH;
    const s = props.result.stats[p];

    c.textAlign = "left";
    c.textBaseline = "top";
    c.fillStyle = color;
    c.font = "bold 12px system-ui, sans-serif";
    c.fillText(p === 0 ? "BOVEN" : "ONDER", left, y0);

    if (s.hits === 0) {
      c.fillStyle = "#64748b";
      c.font = "12px system-ui, sans-serif";
      c.textAlign = "center";
      c.fillText("GEEN DATA", W / 2, y0 + panelH / 2);
      c.textAlign = "left";
      continue;
    }

    // Adaptive x-axis: scale to mean + 3σ so the curve is centred and the
    // bars don't pile up against the left edge.
    const sigma = Math.max(s.sigma, 20);
    const xMax = Math.min(450, Math.max(120, Math.ceil((s.mean + 3 * sigma) / 50) * 50));
    const binW = xMax / bins;
    const areaTop = y0 + 18;
    const areaH = panelH - 34;

    const hist = new Array<number>(bins).fill(0);
    for (const d of s.deviations) {
      hist[Math.min(bins - 1, Math.floor(d / binW))] += 1;
    }
    const maxCount = Math.max(...hist);

    // Bars.
    c.globalAlpha = 0.45;
    c.fillStyle = color;
    for (let b = 0; b < bins; b += 1) {
      const h = (hist[b] / maxCount) * areaH;
      c.fillRect(left + (b * pw) / bins + 1.5, areaTop + areaH - h, pw / bins - 3, h);
    }
    c.globalAlpha = 1;

    // Fitted normal curve, peak at ~95% of the bar height.
    if (Number.isFinite(s.mean) && sigma > 0) {
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i <= 60; i += 1) {
        const x = (i / 60) * xMax;
        const g = Math.exp(-((x - s.mean) ** 2) / (2 * sigma * sigma));
        const px = left + (x / xMax) * pw;
        const py = areaTop + areaH - g * areaH * 0.95;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
      // Mean ± spread band.
      const band = (x: number): number => left + (x / xMax) * pw;
      const bandLo = Math.max(0, s.mean - sigma);
      const bandHi = Math.min(xMax, s.mean + sigma);
      c.globalAlpha = 0.18;
      c.fillStyle = color;
      c.fillRect(band(bandLo), areaTop, band(bandHi) - band(bandLo), areaH);
      c.globalAlpha = 1;
      c.strokeStyle = color;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.moveTo(band(s.mean), areaTop);
      c.lineTo(band(s.mean), areaTop + areaH);
      c.stroke();
      c.setLineDash([]);
    }

    // Axis labels.
    c.fillStyle = "#94a3b8";
    c.font = "10px system-ui, sans-serif";
    c.textBaseline = "top";
    c.fillText("0", left, areaTop + areaH + 2);
    c.textAlign = "right";
    c.fillText(`${Math.round(xMax)} ms`, left + pw, areaTop + areaH + 2);
    c.textAlign = "left";
  }
}

onMounted(() => {
  drawCurves();
});

watch(
  () => props.result,
  () => void nextTick(drawCurves),
);
</script>

<template>
  <div class="skill-stats">
    <p class="final-score" aria-hidden="true">
      Gemiddeld {{ result.avg[0] }} ms tegen {{ result.avg[1] }} ms
    </p>
    <canvas ref="curveRef" class="curve-canvas" aria-hidden="true"></canvas>
    <div class="verdicts">
      <div class="verdict-block top">
        <p class="verdict-label top">BOVEN</p>
        <p class="verdict-line">{{ playerStats(0) }}</p>
        <p class="verdict-sub">{{ attemptText(0) }}</p>
        <p class="verdict top">{{ verdictText(0) }}</p>
      </div>
      <div class="verdict-block bottom">
        <p class="verdict-label bottom">ONDER</p>
        <p class="verdict-line">{{ playerStats(1) }}</p>
        <p class="verdict-sub">{{ attemptText(1) }}</p>
        <p class="verdict bottom">{{ verdictText(1) }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.final-score {
  margin: 0.6rem 0 0.4rem;
  font-size: clamp(1.4rem, 5.5vh, 2.2rem);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #e2e8f0;
}

.curve-canvas {
  width: min(360px, 92vw);
  height: auto;
  aspect-ratio: 360 / 292;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 0.9rem;
}

.verdicts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 22rem;
  margin: 0.5rem 0 0.7rem;
}

.verdict-block {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.55rem 0.8rem;
  border-radius: 0.7rem;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

.verdict-label {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.verdict-label.top {
  color: #34d399;
}

.verdict-label.bottom {
  color: #a78bfa;
}

.verdict-line {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}

.verdict-sub {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: #94a3b8;
}

.verdict {
  margin: 0.1rem 0 0;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.35;
}

.verdict.top {
  color: #6ee7b7;
}

.verdict.bottom {
  color: #c4b5fd;
}
</style>
