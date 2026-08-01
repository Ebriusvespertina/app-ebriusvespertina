import type { Choice } from "./types";

export const MIN_WEIGHT = 0.1;

export const SPIN_DURATION_MS = 4600;

export function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const PALETTE = [
  "#38bdf8",
  "#f59e0b",
  "#34d399",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#f97316",
  "#84cc16",
];

export function clampWeight(value: number, min = MIN_WEIGHT) {
  if (!Number.isFinite(value)) {
    return Math.max(MIN_WEIGHT, min);
  }
  return Math.max(value, min);
}

export function totalWeight(choices: Choice[]) {
  return choices.reduce((sum, item) => sum + item.weight, 0);
}

export function percentages(choices: Choice[]) {
  const total = totalWeight(choices);
  if (total <= 0) {
    return choices.map(() => 0);
  }
  return choices.map((item) => (item.weight / total) * 100);
}

export function pickWinner(choices: Choice[]) {
  const active = choices.filter((choice) => choice.weight > 0);
  if (active.length === 0) {
    return null;
  }

  const total = active.reduce((sum, choice) => sum + choice.weight, 0);
  const roll = Math.random() * total;
  let cursor = 0;

  for (const choice of active) {
    cursor += choice.weight;
    if (roll <= cursor) {
      return choices.indexOf(choice);
    }
  }

  return choices.indexOf(active[active.length - 1]);
}

export function formatTimeWithMs(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function pointOnCircle(angleDeg: number, radius: number) {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: 50 + Math.cos(radians) * radius,
    y: 50 + Math.sin(radians) * radius,
  };
}

export function makeSlicePath(
  startDeg: number,
  endDeg: number,
  radius: number,
) {
  const startPoint = pointOnCircle(startDeg, radius);
  const endPoint = pointOnCircle(endDeg, radius);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M 50 50 L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y} Z`;
}

export function shortenLabel(rawLabel: string, maxChars: number) {
  const clean = rawLabel.trim();
  if (!clean) {
    return "";
  }
  return clean.length > maxChars
    ? `${clean.slice(0, Math.max(maxChars - 1, 1))}…`
    : clean;
}
