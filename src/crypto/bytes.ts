const HEX_RE = /^(?:[0-9a-f]{2})*$/;

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.toLowerCase();
  if (!HEX_RE.test(h)) throw new Error(`invalid hex string: "${hex}"`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};

/** big-endian bytes → bigint */
export const bytesToBigInt = (bytes: Uint8Array): bigint =>
  bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);

/** bigint → big-endian bytes of fixed length */
export const bigIntToBytes = (value: bigint, length: number): Uint8Array => {
  if (value < 0n || value >> BigInt(8 * length) !== 0n) {
    throw new RangeError(`value does not fit in ${length} bytes`);
  }
  const out = new Uint8Array(length);
  for (let i = length - 1, v = value; i >= 0; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
};

export const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => {
    out.set(p, offset);
    return offset + p.length;
  }, 0);
  return out;
};

export const xorBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length !== b.length) throw new Error(`xor length mismatch: ${a.length} vs ${b.length}`);
  return a.map((x, i) => x ^ (b[i] ?? 0));
};

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Web Crypto API (crypto.subtle) が使えません。https / localhost / file から開いてください。');
  }
  return new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(data)));
};
