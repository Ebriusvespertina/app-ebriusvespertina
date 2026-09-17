import type {
  Choice,
  PresetChoice,
  SpinSpeed,
  WheelPreset,
  WheelSettings,
} from "./types";

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

/**
 * Normalizes a raw weight input. Empty/missing input means "default weight 1";
 * number inputs from `<input type="number">` v-model arrive as numbers.
 */
export function parseWeightInput(raw: unknown): number {
  if (raw === "" || raw === null || raw === undefined) {
    return 1;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
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

// ---- settings ----

export const DEFAULT_SETTINGS: WheelSettings = {
  sound: true,
  vibrate: true,
  spinSpeed: "normal",
};

export const SPIN_DURATION_BY_SPEED: Record<SpinSpeed, number> = {
  fast: 2600,
  normal: 4600,
  slow: 6800,
};

export const SPIN_SPEED_LABELS: Record<SpinSpeed, string> = {
  fast: "Snel",
  normal: "Normaal",
  slow: "Langzaam",
};

export function normalizeSettings(raw: unknown): WheelSettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const spinSpeed =
    value.spinSpeed === "fast" || value.spinSpeed === "slow"
      ? value.spinSpeed
      : "normal";
  return {
    sound: value.sound !== false,
    vibrate: value.vibrate !== false,
    spinSpeed,
  };
}

// ---- presets & import/export ----

export const PRESET_FORMAT = "radje-draaien/preset";
export const PRESET_VERSION = 1;

export const BUILT_IN_PRESETS: readonly WheelPreset[] = [
  {
    name: "Drankjes",
    choices: [
      { label: "Niets", weight: 0.5 },
      { label: "2 slokken", weight: 1 },
      { label: "1 Bak", weight: 1 },
      { label: "1 slok", weight: 0.5 },
      { label: "4 slokken", weight: 1 },
    ],
  },
  {
    name: "Wie begint?",
    choices: [
      { label: "Jij", weight: 1 },
      { label: "Ik", weight: 1 },
      { label: "Hij/zij", weight: 1 },
    ],
  },
  {
    name: "Avondeten",
    choices: [
      { label: "Pizza", weight: 1 },
      { label: "Patat", weight: 1 },
      { label: "Chinees", weight: 1 },
      { label: "Sushi", weight: 1 },
      { label: "Wraps", weight: 1 },
    ],
  },
  {
    name: "Spelletjes",
    choices: [
      { label: "Catan", weight: 1 },
      { label: "Uno", weight: 1 },
      { label: "Poker", weight: 1 },
      { label: "Darts", weight: 1 },
      { label: "Weerwolf", weight: 1 },
    ],
  },
  {
    name: "Klusjes",
    choices: [
      { label: "Afwassen", weight: 1 },
      { label: "Stofzuigen", weight: 1 },
      { label: "Koken", weight: 1 },
      { label: "Boodschappen", weight: 1 },
      { label: "Badkamer", weight: 1 },
    ],
  },
];

export function presetToChoices(preset: WheelPreset): Choice[] {
  return preset.choices.map((entry) => ({
    id: makeId(),
    label: entry.label,
    weight: entry.weight,
  }));
}

export function normalizePresetInput(
  raw: unknown,
): { preset: WheelPreset } | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "Ongeldig bestand: geen preset-object." };
  }
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    return { error: "Ongeldig bestand: naam ontbreekt." };
  }
  if (name.length > 60) {
    return { error: "Naam is te lang (max 60 tekens)." };
  }
  if (!Array.isArray(value.choices)) {
    return { error: "Ongeldig bestand: geen keuzes gevonden." };
  }

  const choices: PresetChoice[] = [];
  for (const entry of value.choices) {
    if (!entry || typeof entry !== "object") {
      return { error: "Ongeldige keuze in bestand." };
    }
    const choice = entry as Record<string, unknown>;
    const label = typeof choice.label === "string" ? choice.label.trim() : "";
    if (!label) {
      return { error: "Ongeldige keuze: label ontbreekt." };
    }
    if (label.length > 40) {
      return {
        error: `Keuze "${label.slice(0, 20)}…" is te lang (max 40 tekens).`,
      };
    }
    const weight =
      typeof choice.weight === "number" ? choice.weight : Number(choice.weight);
    if (!Number.isFinite(weight)) {
      return { error: `Keuze "${label}" heeft een ongeldig gewicht.` };
    }
    choices.push({ label, weight: clampWeight(weight, 0) });
  }
  if (!choices.length) {
    return { error: "Geen keuzes om te importeren." };
  }
  return { preset: { name, choices } };
}

export function parsePresetJson(
  json: string,
): { preset: WheelPreset } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Ongeldige JSON." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { error: "Ongeldig bestand: geen preset-object." };
  }
  const value = parsed as Record<string, unknown>;
  if (value.format !== undefined && value.format !== PRESET_FORMAT) {
    return { error: "Ongeldig bestandsformaat." };
  }
  return normalizePresetInput(parsed);
}

export function serializePreset(preset: WheelPreset): string {
  return JSON.stringify(
    {
      format: PRESET_FORMAT,
      version: PRESET_VERSION,
      name: preset.name,
      choices: preset.choices,
    },
    null,
    2,
  );
}

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "preset";
}
