import type { Die } from './dice';

/**
 * active  : counts toward the game
 * undone  : temporarily removed by "1つ戻る" (can be restored by "1つ進む")
 * voided  : an undone roll that was discarded by rolling again (never restorable)
 */
export type RollStatus = 'active' | 'undone' | 'voided';

export interface Roll {
  readonly counter: number;
  readonly d1: Die;
  readonly d2: Die;
  /** epoch ms when the roll was made */
  readonly at: number;
  readonly status: RollStatus;
}

export interface History {
  /** every roll ever made, ordered by counter */
  readonly log: readonly Roll[];
  /** counter for the next roll (always increases, never reused) */
  readonly nextCounter: number;
}

export const emptyHistory: History = { log: [], nextCounter: 0 };

const withStatus = (log: readonly Roll[], index: number, status: RollStatus): Roll[] =>
  log.map((r, i) => (i === index ? { ...r, status } : r));

const lastIndexWhere = (log: readonly Roll[], pred: (r: Roll) => boolean): number => {
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    if (r !== undefined && pred(r)) return i;
  }
  return -1;
};

/** Adds a new roll. Pending undone rolls become voided (the "redo" branch is discarded). */
export const addRoll = (h: History, roll: Omit<Roll, 'status' | 'counter'>): History => ({
  log: [
    ...h.log.map((r): Roll => (r.status === 'undone' ? { ...r, status: 'voided' } : r)),
    { ...roll, counter: h.nextCounter, status: 'active' },
  ],
  nextCounter: h.nextCounter + 1,
});

export const canUndo = (h: History): boolean => h.log.some((r) => r.status === 'active');
export const canRedo = (h: History): boolean => h.log.some((r) => r.status === 'undone');

/** Marks the latest active roll as undone. */
export const undo = (h: History): History => {
  const i = lastIndexWhere(h.log, (r) => r.status === 'active');
  return i < 0 ? h : { ...h, log: withStatus(h.log, i, 'undone') };
};

/** Restores the earliest undone roll. */
export const redo = (h: History): History => {
  const i = h.log.findIndex((r) => r.status === 'undone');
  return i < 0 ? h : { ...h, log: withStatus(h.log, i, 'active') };
};

export const activeRolls = (h: History): Roll[] => h.log.filter((r) => r.status === 'active');

/** The roll currently shown on screen (latest active one). */
export const currentRoll = (h: History): Roll | undefined => {
  const i = lastIndexWhere(h.log, (r) => r.status === 'active');
  return i < 0 ? undefined : h.log[i];
};

export const sumOf = (r: Pick<Roll, 'd1' | 'd2'>): number => r.d1 + r.d2;
