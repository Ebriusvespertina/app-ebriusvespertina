export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface Die {
  id: number;
  value: DieValue;
  locked: boolean;
  lockGroup: number | null;
}

export interface RollLogEntry {
  roll: number;
  dice: Array<{ value: DieValue; locked: boolean }>;
}
