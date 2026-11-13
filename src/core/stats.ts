import { sumOf, type Roll } from './history';

export const SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type Sum = (typeof SUMS)[number];

/** theoretical probability of a 2d6 sum: (6 - |s - 7|) / 36 — a triangle, not a normal curve */
export const theoreticalProbability = (s: number): number =>
  Number.isInteger(s) && s >= 2 && s <= 12 ? (6 - Math.abs(s - 7)) / 36 : 0;

export interface SumStat {
  readonly sum: Sum;
  readonly count: number;
  /** observed relative frequency (0 when no rolls) */
  readonly observed: number;
  readonly expected: number;
}

export const sumDistribution = (rolls: readonly Roll[]): SumStat[] => {
  const counts = rolls.reduce((m, r) => m.set(sumOf(r), (m.get(sumOf(r)) ?? 0) + 1), new Map<number, number>());
  const n = rolls.length;
  return SUMS.map((sum) => {
    const count = counts.get(sum) ?? 0;
    return { sum, count, observed: n === 0 ? 0 : count / n, expected: theoreticalProbability(sum) };
  });
};
