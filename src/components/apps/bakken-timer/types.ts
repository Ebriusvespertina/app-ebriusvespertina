export type TimerPhase = "idle" | "arming" | "running" | "result";

export interface BakEntry {
  id: string;
  timeMs: number;
  at: string;
}
