import { bytesToBigInt, bytesToHex, hexToBytes } from '../crypto/bytes';
import type { Die } from './dice';
import { rollDice } from './dice';
import type { History, Roll, RollStatus } from './history';
import { addRoll } from './history';
import { commitKey, deriveKey, KEY_BYTES, keyToHex, SALT_BYTES } from './keygen';

export type GamePhase = 'playing' | 'revealed';

export interface Game {
  readonly phase: GamePhase;
  /** 80-bit KATAN key as 20 hex chars (stored in localStorage by design: option B) */
  readonly keyHex: string;
  readonly saltHex: string;
  readonly words: readonly string[];
  readonly commitment: string;
  readonly createdAt: number;
  readonly revealedAt: number | null;
  readonly history: History;
}

export const gameKey = (g: Pick<Game, 'keyHex'>): bigint => bytesToBigInt(hexToBytes(g.keyHex));

export const createGame = async (salt: Uint8Array, words: readonly string[], now: number): Promise<Game> => {
  const key = await deriveKey(salt, words);
  return {
    phase: 'playing',
    keyHex: keyToHex(key),
    saltHex: bytesToHex(salt),
    words: [...words],
    commitment: await commitKey(key),
    createdAt: now,
    revealedAt: null,
    history: { log: [], nextCounter: 0 },
  };
};

/** Rolls the dice for the next counter and appends it. */
export const rollNext = (g: Game, now: number): Game => {
  if (g.phase !== 'playing') throw new Error('鍵を公開済みのゲームでは振れません');
  const { d1, d2 } = rollDice(gameKey(g), g.history.nextCounter);
  return { ...g, history: addRoll(g.history, { d1, d2, at: now }) };
};

export const reveal = (g: Game, now: number): Game => ({ ...g, phase: 'revealed', revealedAt: now });

// ---------------------------------------------------------------------------
// verification (commit & reveal)

export interface VerifyResult {
  readonly keyDerivationOk: boolean;
  readonly commitmentOk: boolean;
  /** counters whose recomputed dice differ from the log */
  readonly mismatches: readonly number[];
  readonly checked: number;
}

export const verifyGame = async (g: Game): Promise<VerifyResult> => {
  const key = gameKey(g);
  const derived = await deriveKey(hexToBytes(g.saltHex), g.words);
  const commitment = await commitKey(key);
  const mismatches = g.history.log
    .filter((r) => {
      const re = rollDice(key, r.counter);
      return re.d1 !== r.d1 || re.d2 !== r.d2;
    })
    .map((r) => r.counter);
  return {
    keyDerivationOk: derived === key,
    commitmentOk: commitment === g.commitment,
    mismatches,
    checked: g.history.log.length,
  };
};

// ---------------------------------------------------------------------------
// (de)serialisation with validation

export class GameParseError extends Error {
  constructor(message: string) {
    super(`保存データを読み込めません: ${message}`);
    this.name = 'GameParseError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const field = <T>(o: Record<string, unknown>, name: string, check: (v: unknown) => v is T, what: string): T => {
  const v = o[name];
  if (!check(v)) throw new GameParseError(`${name} が${what}ではありません`);
  return v;
};

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isDie = (v: unknown): v is Die => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 6;
const isStatus = (v: unknown): v is RollStatus => v === 'active' || v === 'undone' || v === 'voided';
const isPhase = (v: unknown): v is GamePhase => v === 'playing' || v === 'revealed';
const hexOf = (bytes: number) => (v: unknown): v is string => typeof v === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(v);

const parseRoll = (v: unknown): Roll => {
  if (!isRecord(v)) throw new GameParseError('ロールの形式が不正です');
  return {
    counter: field(v, 'counter', isNonNegInt, '非負整数'),
    d1: field(v, 'd1', isDie, '1〜6'),
    d2: field(v, 'd2', isDie, '1〜6'),
    at: field(v, 'at', isNumber, '数値'),
    status: field(v, 'status', isStatus, '有効な状態'),
  };
};

export const parseGame = (raw: unknown): Game => {
  if (!isRecord(raw)) throw new GameParseError('オブジェクトではありません');
  const history = raw['history'];
  if (!isRecord(history)) throw new GameParseError('history がありません');
  const logRaw = history['log'];
  if (!Array.isArray(logRaw)) throw new GameParseError('history.log が配列ではありません');
  const words = raw['words'];
  if (!Array.isArray(words) || !words.every(isString)) throw new GameParseError('words が文字列配列ではありません');
  const revealedAt = raw['revealedAt'];
  if (revealedAt !== null && !isNumber(revealedAt)) throw new GameParseError('revealedAt が不正です');
  const log = logRaw.map(parseRoll);
  const nextCounter = field(history, 'nextCounter', isNonNegInt, '非負整数');
  if (log.some((r, i) => r.counter >= nextCounter || (i > 0 && r.counter <= (log[i - 1]?.counter ?? -1)))) {
    throw new GameParseError('ロールのカウンタが整合しません');
  }
  return {
    phase: field(raw, 'phase', isPhase, '有効なフェーズ'),
    keyHex: field(raw, 'keyHex', hexOf(KEY_BYTES), `${KEY_BYTES}バイトの16進`),
    saltHex: field(raw, 'saltHex', hexOf(SALT_BYTES), `${SALT_BYTES}バイトの16進`),
    words,
    commitment: field(raw, 'commitment', hexOf(32), '32バイトの16進'),
    createdAt: field(raw, 'createdAt', isNumber, '数値'),
    revealedAt,
    history: { log, nextCounter },
  };
};

/** Export format for independent verification. */
export const exportGame = (g: Game): string =>
  JSON.stringify(
    {
      format: 'katan-dice/v1',
      spec: {
        cipher: 'KATAN64 (254 rounds), bit conventions of the reference katan.c',
        key: 'K = first 10 bytes of SHA256("katan-dice/v1/r:"||salt) XOR SHA256("katan-dice/v1/w1:"||utf8(w1)) XOR ...; key bit i = (K >> i) & 1 with K read big-endian',
        commitment: 'SHA256("katan-dice/v1/commit:"||K as 10 bytes big-endian)',
        roll: 'plaintext = counter<<8 | j (j = 0,1,...); ciphertext split into 3-bit chunks LSB first; 0..5 -> 1..6, 6,7 rejected; first two accepted = (d1, d2)',
      },
      ...g,
    },
    null,
    2,
  );
