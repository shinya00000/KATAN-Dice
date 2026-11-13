import { describe, expect, it } from 'vitest';
import { extractChunks, rollDice, rollDiceDetailed, rollPlaintext } from '../src/core/dice';
import { createGame, exportGame, parseGame, rollNext, verifyGame, type Game } from '../src/core/game';
import {
  activeRolls,
  addRoll,
  canRedo,
  canUndo,
  currentRoll,
  emptyHistory,
  redo,
  undo,
  type History,
} from '../src/core/history';
import { commitKey, deriveKey } from '../src/core/keygen';
import { sumDistribution, theoreticalProbability } from '../src/core/stats';

const KEY = 0x0123456789abcdef0123n;
const SALT = new Uint8Array(16).map((_, i) => i * 7 + 1);

describe('dice extraction', () => {
  it('maps 0..5 to 1..6 and rejects 6,7 (LSB-first chunks)', () => {
    // chunks LSB first: 7, 6, 2, 5, ...
    const c = 0b101_010_110_111n;
    const { dice, chunks } = extractChunks(c, 2);
    expect(dice).toEqual([3, 6]);
    expect(chunks.slice(0, 5).map((x) => x.status)).toEqual(['rejected', 'rejected', 'used', 'used', 'unused']);
  });

  it('is deterministic per (key, counter)', () => {
    expect(rollDice(KEY, 5)).toEqual(rollDice(KEY, 5));
    expect(rollDice(KEY, 5)).toEqual({ d1: expect.any(Number), d2: expect.any(Number) });
  });

  it('plaintext encodes counter and sub-block', () => {
    expect(rollPlaintext(1, 0)).toBe(256n);
    expect(rollPlaintext(1, 3)).toBe(259n);
    expect(() => rollPlaintext(-1, 0)).toThrow(RangeError);
    expect(() => rollPlaintext(0, 256)).toThrow(RangeError);
  });

  it('detailed roll is consistent with its blocks', () => {
    const d = rollDiceDetailed(KEY, 0);
    const used = d.blocks.flatMap((b) => b.chunks.filter((c) => c.status === 'used').map((c) => c.value + 1));
    expect(used).toEqual([d.d1, d.d2]);
  });

  it('faces and sums are statistically uniform / triangular (chi-square, 6000 rolls)', () => {
    const n = 6000;
    const faces = new Array<number>(6).fill(0);
    const sums = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const { d1, d2 } = rollDice(KEY, i);
      faces[d1 - 1]!++;
      faces[d2 - 1]!++;
      sums.set(d1 + d2, (sums.get(d1 + d2) ?? 0) + 1);
    }
    const chiFaces = faces.reduce((acc, o) => acc + (o - (2 * n) / 6) ** 2 / ((2 * n) / 6), 0);
    expect(chiFaces).toBeLessThan(20.52); // df=5, p=0.001
    let chiSums = 0;
    for (let s = 2; s <= 12; s++) {
      const e = n * theoreticalProbability(s);
      chiSums += ((sums.get(s) ?? 0) - e) ** 2 / e;
    }
    expect(chiSums).toBeLessThan(29.59); // df=10, p=0.001
  });
});

describe('history (undo / redo / void)', () => {
  const roll = (h: History, d1: 1 | 2 | 3 | 4 | 5 | 6, at: number): History => addRoll(h, { d1, d2: 1, at });

  it('undo hides the latest roll, redo restores it with its original timestamp', () => {
    let h = roll(roll(emptyHistory, 3, 100), 4, 200);
    h = undo(h);
    expect(currentRoll(h)?.at).toBe(100);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(currentRoll(h)?.at).toBe(200);
    expect(canRedo(h)).toBe(false);
  });

  it('rolling after undo voids the undone rolls and never reuses a counter', () => {
    let h = roll(roll(emptyHistory, 3, 100), 4, 200);
    h = undo(h);
    h = roll(h, 5, 300);
    expect(h.log.map((r) => [r.counter, r.status])).toEqual([
      [0, 'active'],
      [1, 'voided'],
      [2, 'active'],
    ]);
    expect(canRedo(h)).toBe(false);
    expect(activeRolls(h).map((r) => r.d1)).toEqual([3, 5]);
  });

  it('multiple undo then redo restores in chronological order, skipping voided rolls', () => {
    let h = roll(emptyHistory, 1, 1);
    h = roll(undo(roll(h, 2, 2)), 3, 3); // [1 active, 2 voided, 3 active]
    h = undo(undo(h));
    expect(canUndo(h)).toBe(false);
    expect(currentRoll(h)).toBeUndefined();
    h = redo(h);
    expect(currentRoll(h)?.d1).toBe(1);
    h = redo(h);
    expect(currentRoll(h)?.d1).toBe(3);
    expect(undo(emptyHistory)).toBe(emptyHistory);
    expect(redo(emptyHistory)).toBe(emptyHistory);
  });
});

describe('stats', () => {
  it('theoretical distribution is the 2d6 triangle and sums to 1', () => {
    expect(theoreticalProbability(7)).toBeCloseTo(6 / 36);
    expect(theoreticalProbability(2)).toBeCloseTo(1 / 36);
    expect(theoreticalProbability(13)).toBe(0);
    const total = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reduce((a, s) => a + theoreticalProbability(s), 0);
    expect(total).toBeCloseTo(1);
  });

  it('counts only the given rolls', () => {
    const h = addRoll(addRoll(emptyHistory, { d1: 3, d2: 4, at: 0 }), { d1: 6, d2: 6, at: 1 });
    const dist = sumDistribution(activeRolls(undo(h)));
    expect(dist.find((d) => d.sum === 7)).toMatchObject({ count: 1, observed: 1 });
    expect(dist.find((d) => d.sum === 12)).toMatchObject({ count: 0 });
  });
});

describe('key generation & commitment', () => {
  it('is deterministic and depends on every word and on the salt', async () => {
    const k = await deriveKey(SALT, ['wheat', 'ore']);
    expect(k).toBe(await deriveKey(SALT, ['wheat', 'ore']));
    expect(k).not.toBe(await deriveKey(SALT, ['wheat', 'ore!']));
    expect(k).not.toBe(await deriveKey(SALT, ['ore', 'wheat'])); // index is bound
    expect(k).not.toBe(await deriveKey(SALT.map((b) => b ^ 1), ['wheat', 'ore']));
    expect(k >> 80n).toBe(0n);
  });

  it('identical words do not cancel out', async () => {
    expect(await deriveKey(SALT, ['same', 'same'])).not.toBe(await deriveKey(SALT, []));
  });

  it('commitment is 32-byte hex and binds the key', async () => {
    const c = await commitKey(KEY);
    expect(c).toMatch(/^[0-9a-f]{64}$/);
    expect(c).not.toBe(await commitKey(KEY ^ 1n));
  });
});

describe('game: verify & persistence', () => {
  const play = async (): Promise<Game> => {
    let g = await createGame(SALT, ['brick', 'wool'], 0);
    for (let i = 0; i < 10; i++) g = rollNext(g, 1000 + i);
    return { ...g, history: undo(g.history) };
  };

  it('honest log verifies', async () => {
    const r = await verifyGame(await play());
    expect(r).toEqual({ keyDerivationOk: true, commitmentOk: true, mismatches: [], checked: 10 });
  });

  it('detects a tampered roll, key or commitment', async () => {
    const g = await play();
    const log = g.history.log.map((r) => (r.counter === 3 ? { ...r, d1: r.d1 === 6 ? (1 as const) : (6 as const) } : r));
    expect((await verifyGame({ ...g, history: { ...g.history, log } })).mismatches).toEqual([3]);
    expect((await verifyGame({ ...g, words: ['brick', 'sheep'] })).keyDerivationOk).toBe(false);
    expect((await verifyGame({ ...g, commitment: '0'.repeat(64) })).commitmentOk).toBe(false);
  });

  it('round-trips through JSON and rejects malformed data', async () => {
    const g = await play();
    expect(parseGame(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(parseGame(JSON.parse(exportGame(g)))).toEqual(g);
    expect(() => parseGame({ ...g, keyHex: 'zz' })).toThrow(/keyHex/);
    expect(() => parseGame({ ...g, history: { ...g.history, nextCounter: 1 } })).toThrow(/カウンタ/);
    expect(() => parseGame(null)).toThrow();
  });

  it('cannot roll after reveal', async () => {
    const g = await play();
    expect(() => rollNext({ ...g, phase: 'revealed' }, 0)).toThrow();
  });
});
