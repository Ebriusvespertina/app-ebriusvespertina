import type { BakEntry } from "./types";

export const HOLD_MS = 500;
export const MIN_RUN_MS = 300;
export const RESULT_LOCK_MS = 200;
export const BAK_TARGET_MS = 5000;

export function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatSeconds(ms: number) {
  return (ms / 1000).toFixed(3);
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  if (minutes === 0) {
    return `${seconds.toFixed(3)} s`;
  }
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")} s`;
}

export function formatTime(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function bestTime(entries: BakEntry[]) {
  if (!entries.length) {
    return null;
  }
  return Math.min(...entries.map((entry) => entry.timeMs));
}

export function averageTime(entries: BakEntry[]) {
  if (!entries.length) {
    return null;
  }
  return entries.reduce((sum, entry) => sum + entry.timeMs, 0) / entries.length;
}
