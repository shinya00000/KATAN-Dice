import { katan64Encrypt, katan64EncryptTrace, type KatanTrace } from '../crypto/katan';

export type Die = 1 | 2 | 3 | 4 | 5 | 6;

/** 3-bit chunks taken from one 64-bit block (21 chunks, top bit unused) */
export const CHUNK_BITS = 3;
export const CHUNKS_PER_BLOCK = 21;
const SUB_BLOCKS = 256;

export type ChunkStatus = 'used' | 'rejected' | 'unused';

export interface ChunkInfo {
  readonly value: number; // 0..7
  readonly status: ChunkStatus;
}

export interface BlockInfo {
  readonly plaintext: bigint;
  readonly ciphertext: bigint;
  readonly chunks: readonly ChunkInfo[];
}

export interface DiceRoll {
  readonly d1: Die;
  readonly d2: Die;
}

export interface DiceRollDetail extends DiceRoll {
  readonly blocks: readonly BlockInfo[];
}

const MAX_COUNTER = 2 ** 53 - 1;

/** plaintext for roll `counter`, sub-block `j`: counter‖j (j occupies the low 8 bits) */
export const rollPlaintext = (counter: number, j: number): bigint => {
  if (!Number.isSafeInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw new RangeError(`counter must be a non-negative safe integer: ${counter}`);
  }
  if (!Number.isInteger(j) || j < 0 || j >= SUB_BLOCKS) throw new RangeError(`sub-block index out of range: ${j}`);
  return (BigInt(counter) << 8n) | BigInt(j);
};

const toDie = (v: number): Die => {
  if (v >= 0 && v < 6) return (v + 1) as Die;
  throw new RangeError(`not a die value: ${v}`);
};

/**
 * Splits a ciphertext into 3-bit chunks (LSB first) and applies rejection sampling:
 * values 0..5 become die faces 1..6, values 6 and 7 are rejected (no modulo bias).
 */
export const extractChunks = (ciphertext: bigint, needed: number): { chunks: ChunkInfo[]; dice: Die[] } => {
  const chunks: ChunkInfo[] = [];
  const dice: Die[] = [];
  for (let c = 0; c < CHUNKS_PER_BLOCK; c++) {
    const value = Number((ciphertext >> BigInt(c * CHUNK_BITS)) & 0b111n);
    if (dice.length >= needed) {
      chunks.push({ value, status: 'unused' });
    } else if (value < 6) {
      dice.push(toDie(value));
      chunks.push({ value, status: 'used' });
    } else {
      chunks.push({ value, status: 'rejected' });
    }
  }
  return { chunks, dice };
};

/** Deterministic 2d6 for (key, counter): KATAN64 in counter mode + rejection sampling. */
export const rollDiceDetailed = (key: bigint, counter: number): DiceRollDetail => {
  const blocks: BlockInfo[] = [];
  const dice: Die[] = [];
  for (let j = 0; dice.length < 2; j++) {
    if (j >= SUB_BLOCKS) throw new Error('rejection sampling did not terminate (practically impossible)');
    const plaintext = rollPlaintext(counter, j);
    const ciphertext = katan64Encrypt(key, plaintext);
    const { chunks, dice: got } = extractChunks(ciphertext, 2 - dice.length);
    dice.push(...got);
    blocks.push({ plaintext, ciphertext, chunks });
  }
  const [d1, d2] = dice;
  if (d1 === undefined || d2 === undefined) throw new Error('failed to extract two dice');
  return { d1, d2, blocks };
};

export const rollDice = (key: bigint, counter: number): DiceRoll => {
  const { d1, d2 } = rollDiceDetailed(key, counter);
  return { d1, d2 };
};

/** Register trace of the first block of a roll, for visualisation. */
export const rollTrace = (key: bigint, counter: number): KatanTrace => katan64EncryptTrace(key, rollPlaintext(counter, 0));
