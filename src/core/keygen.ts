import { bigIntToBytes, bytesToBigInt, bytesToHex, concatBytes, sha256, utf8, xorBytes } from '../crypto/bytes';

export const KEY_BYTES = 10; // 80-bit KATAN key
export const SALT_BYTES = 16;

const DOMAIN = 'katan-dice/v1';

/** Normalises player words; empty entries are dropped (index is assigned after filtering). */
export const normalizeWords = (words: readonly string[]): string[] =>
  words.map((w) => w.normalize('NFC').trim()).filter((w) => w.length > 0);

/**
 * K = trunc80( H(D‖"r"‖r) ⊕ H(D‖"w1"‖w1) ⊕ H(D‖"w2"‖w2) ⊕ … )
 * The index is part of each hash input so that identical words do not cancel out.
 */
export const deriveKey = async (salt: Uint8Array, words: readonly string[]): Promise<bigint> => {
  if (salt.length !== SALT_BYTES) throw new Error(`salt must be ${SALT_BYTES} bytes, got ${salt.length}`);
  const parts = [
    sha256(concatBytes(utf8(`${DOMAIN}/r:`), salt)),
    ...words.map((w, i) => sha256(concatBytes(utf8(`${DOMAIN}/w${i + 1}:`), utf8(w)))),
  ];
  const digests = await Promise.all(parts);
  const [first, ...rest] = digests;
  if (first === undefined) throw new Error('no digest computed');
  const acc = rest.reduce(xorBytes, first);
  return bytesToBigInt(acc.slice(0, KEY_BYTES));
};

/** commitment Com = SHA-256(D‖"commit:"‖K) as hex */
export const commitKey = async (key: bigint): Promise<string> =>
  bytesToHex(await sha256(concatBytes(utf8(`${DOMAIN}/commit:`), bigIntToBytes(key, KEY_BYTES))));

export const keyToHex = (key: bigint): string => bytesToHex(bigIntToBytes(key, KEY_BYTES));

export const randomSalt = (): Uint8Array => {
  const c = globalThis.crypto;
  if (c === undefined || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues が使えないため乱数を生成できません。');
  }
  return c.getRandomValues(new Uint8Array(SALT_BYTES));
};
