export interface Choice {
  id: string;
  label: string;
  weight: number;
}

/** Portable preset entry: no id, survives export/import. */
export interface PresetChoice {
  label: string;
  weight: number;
}

export interface WheelPreset {
  name: string;
  choices: PresetChoice[];
}

export interface SavedPreset extends WheelPreset {
  id: string;
  createdAt: string;
}

export type SpinSpeed = "fast" | "normal" | "slow";

export interface WheelSettings {
  sound: boolean;
  vibrate: boolean;
  spinSpeed: SpinSpeed;
}

export interface SpinRecord {
  label: string;
  time: string;
  iso: string;
}

export type AppTab = "wheel" | "choices" | "presets" | "settings";
