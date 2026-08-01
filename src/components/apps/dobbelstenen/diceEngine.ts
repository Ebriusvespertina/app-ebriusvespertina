import type { Die, DieValue } from "./types";

export const PIPS: Record<DieValue, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function rollDieValue(): DieValue {
  return Math.ceil(Math.random() * 6) as DieValue;
}

export function lockedTotal(dice: Die[]): number {
  return dice
    .filter((die) => die.locked)
    .reduce((sum, die) => sum + die.value, 0);
}

export function lockedCount(dice: Die[]): number {
  return dice.filter((die) => die.locked).length;
}
