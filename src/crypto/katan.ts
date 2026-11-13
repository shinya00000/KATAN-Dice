/**
 * KATAN block cipher family (De Cannière, Dunkelman, Knežević, CHES 2009).
 *
 * Ported from the designers' reference implementation (katan.c).
 * Bit conventions follow the reference code:
 *   - key bit i      = (key >> i) & 1        (80-bit key, i = 0..79)
 *   - plaintext bit i = (plain >> i) & 1
 *   - L2[i] = plain bit i (i < |L2|),  L1[i] = plain bit (i + |L2|)
 *   - ciphertext is read back the same way.
 */

export type KatanVariant = 32 | 48 | 64;

interface VariantParams {
  readonly blockBits: number;
  readonly l1Len: number;
  readonly l2Len: number;
  /** x1..x5 tap positions of L1 */
  readonly x: readonly [number, number, number, number, number];
  /** y1..y6 tap positions of L2 */
  readonly y: readonly [number, number, number, number, number, number];
  /** how many times the round function is applied per round */
  readonly steps: number;
}

const PARAMS: Readonly<Record<KatanVariant, VariantParams>> = {
  32: { blockBits: 32, l1Len: 13, l2Len: 19, x: [12, 7, 8, 5, 3], y: [18, 7, 12, 10, 8, 3], steps: 1 },
  48: { blockBits: 48, l1Len: 19, l2Len: 29, x: [18, 12, 15, 7, 6], y: [28, 19, 21, 13, 15, 6], steps: 2 },
  64: { blockBits: 64, l1Len: 25, l2Len: 39, x: [24, 15, 20, 11, 9], y: [38, 25, 33, 21, 14, 9], steps: 3 },
};

export const KATAN_ROUNDS = 254;
export const KEY_BITS = 80;
const KEY_MASK = (1n << 80n) - 1n;

export const katanParams = (variant: KatanVariant): VariantParams => PARAMS[variant];

/**
 * Irregular-update sequence IR. It is the output of an 8-bit LFSR
 * (state all-ones, feedback T7^T6^T4^T2) — identical to the table in katan.c.
 */
export const IR: readonly number[] = (() => {
  const t = [1, 1, 1, 1, 1, 1, 1, 1];
  const out: number[] = [];
  for (let i = 0; i < KATAN_ROUNDS; i++) {
    out.push(t[6] ?? 0);
    const fb = (t[7] ?? 0) ^ (t[6] ?? 0) ^ (t[4] ?? 0) ^ (t[2] ?? 0);
    t.pop();
    t.unshift(fb);
  }
  return Object.freeze(out);
})();

const bitAt = (arr: Uint8Array, i: number): number => {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`bit index ${i} out of range (length ${arr.length})`);
  return v;
};

const assertRange = (value: bigint, bits: number, label: string): void => {
  if (value < 0n || value >> BigInt(bits) !== 0n) {
    throw new RangeError(`${label} must be a non-negative integer below 2^${bits}`);
  }
};

const toBits = (value: bigint, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Number((value >> BigInt(i)) & 1n);
  return out;
};

const fromBits = (bits: ArrayLike<number>): bigint => {
  let v = 0n;
  for (let i = bits.length - 1; i >= 0; i--) v = (v << 1n) | BigInt(bits[i] ?? 0);
  return v;
};

/** Expands the 80-bit key with the LFSR x^80 + x^61 + x^50 + x^13 + 1 into 2*rounds subkey bits. */
export const expandKey = (key: bigint, rounds: number = KATAN_ROUNDS): Uint8Array => {
  assertRange(key, KEY_BITS, 'key');
  const k = new Uint8Array(Math.max(2 * rounds, KEY_BITS));
  k.set(toBits(key & KEY_MASK, KEY_BITS));
  for (let i = KEY_BITS; i < 2 * rounds; i++) {
    k[i] = bitAt(k, i - 80) ^ bitAt(k, i - 61) ^ bitAt(k, i - 50) ^ bitAt(k, i - 13);
  }
  return k;
};

/** Register snapshot packed as integers: bit i of l1/l2 = L1[i]/L2[i]. */
export interface RegisterSnapshot {
  readonly l1: number;
  readonly l2: number;
}

export interface KatanTrace {
  readonly ciphertext: bigint;
  /** snapshots[0] = after loading plaintext, snapshots[r] = after round r */
  readonly snapshots: readonly RegisterSnapshot[];
}

const packRegister = (reg: Uint8Array): number => {
  let v = 0;
  for (let i = reg.length - 1; i >= 0; i--) v = v * 2 + bitAt(reg, i);
  return v;
};

const runEncrypt = (
  variant: KatanVariant,
  key: bigint,
  plain: bigint,
  rounds: number,
  collect: boolean,
): KatanTrace => {
  const p = PARAMS[variant];
  assertRange(plain, p.blockBits, 'plaintext');
  const k = expandKey(key, rounds);
  const pb = toBits(plain, p.blockBits);
  const l2 = pb.slice(0, p.l2Len);
  const l1 = pb.slice(p.l2Len, p.l2Len + p.l1Len);
  const [x1, x2, x3, x4, x5] = p.x;
  const [y1, y2, y3, y4, y5, y6] = p.y;
  const snapshots: RegisterSnapshot[] = collect ? [{ l1: packRegister(l1), l2: packRegister(l2) }] : [];

  const fa = new Uint8Array(p.steps);
  const fb = new Uint8Array(p.steps);
  for (let i = 0; i < rounds; i++) {
    const ir = IR[i] ?? 0;
    const ka = bitAt(k, 2 * i);
    const kb = bitAt(k, 2 * i + 1);
    for (let d = 0; d < p.steps; d++) {
      fa[d] =
        bitAt(l1, x1 - d) ^ bitAt(l1, x2 - d) ^ (bitAt(l1, x3 - d) & bitAt(l1, x4 - d)) ^ (bitAt(l1, x5 - d) & ir) ^ ka;
      fb[d] =
        bitAt(l2, y1 - d) ^ bitAt(l2, y2 - d) ^ (bitAt(l2, y3 - d) & bitAt(l2, y4 - d)) ^
        (bitAt(l2, y5 - d) & bitAt(l2, y6 - d)) ^ kb;
    }
    l1.copyWithin(p.steps, 0, p.l1Len - p.steps);
    l2.copyWithin(p.steps, 0, p.l2Len - p.steps);
    // tap offset d is written to position (steps-1-d), e.g. KATAN64: L2[2]=fa(offset 0), L2[0]=fa(offset 2)
    for (let d = 0; d < p.steps; d++) {
      l1[p.steps - 1 - d] = bitAt(fb, d);
      l2[p.steps - 1 - d] = bitAt(fa, d);
    }
    if (collect) snapshots.push({ l1: packRegister(l1), l2: packRegister(l2) });
  }

  const out = new Uint8Array(p.blockBits);
  out.set(l2, 0);
  out.set(l1, p.l2Len);
  return { ciphertext: fromBits(out), snapshots };
};

export const katanEncrypt = (variant: KatanVariant, key: bigint, plain: bigint, rounds: number = KATAN_ROUNDS): bigint =>
  runEncrypt(variant, key, plain, rounds, false).ciphertext;

export const katanEncryptTrace = (
  variant: KatanVariant,
  key: bigint,
  plain: bigint,
  rounds: number = KATAN_ROUNDS,
): KatanTrace => runEncrypt(variant, key, plain, rounds, true);

export const katanDecrypt = (variant: KatanVariant, key: bigint, cipher: bigint, rounds: number = KATAN_ROUNDS): bigint => {
  const p = PARAMS[variant];
  assertRange(cipher, p.blockBits, 'ciphertext');
  const k = expandKey(key, rounds);
  const cb = toBits(cipher, p.blockBits);
  const l2 = cb.slice(0, p.l2Len);
  const l1 = cb.slice(p.l2Len, p.l2Len + p.l1Len);
  const [x1, x2, x3, x4, x5] = p.x;
  const [y1, y2, y3, y4, y5, y6] = p.y;

  for (let i = rounds - 1; i >= 0; i--) {
    const ir = IR[i] ?? 0;
    const ka = bitAt(k, 2 * i);
    const kb = bitAt(k, 2 * i + 1);
    const fb = l1.slice(0, p.steps);
    const fa = l2.slice(0, p.steps);
    l1.copyWithin(0, p.steps);
    l2.copyWithin(0, p.steps);
    for (let d = 0; d < p.steps; d++) {
      const pos = p.steps - 1 - d;
      l1[x1 - d] =
        bitAt(fa, pos) ^ bitAt(l1, x2 - d) ^ (bitAt(l1, x3 - d) & bitAt(l1, x4 - d)) ^ (bitAt(l1, x5 - d) & ir) ^ ka;
      l2[y1 - d] =
        bitAt(fb, pos) ^ bitAt(l2, y2 - d) ^ (bitAt(l2, y3 - d) & bitAt(l2, y4 - d)) ^
        (bitAt(l2, y5 - d) & bitAt(l2, y6 - d)) ^ kb;
    }
  }

  const out = new Uint8Array(p.blockBits);
  out.set(l2, 0);
  out.set(l1, p.l2Len);
  return fromBits(out);
};

export const katan64Encrypt = (key: bigint, plain: bigint): bigint => katanEncrypt(64, key, plain);
export const katan64EncryptTrace = (key: bigint, plain: bigint): KatanTrace => katanEncryptTrace(64, key, plain);
export const katan64Decrypt = (key: bigint, cipher: bigint): bigint => katanDecrypt(64, key, cipher);
