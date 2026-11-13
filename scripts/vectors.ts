/**
 * Prints test values in the same format as test_values() in the reference katan.c
 * (binary, most significant bit first) plus hex, so the output can be diffed.
 */
import { katanEncrypt, type KatanVariant } from '../src/crypto/katan';

const ALL_ONES_KEY = (1n << 80n) - 1n;
const variants: readonly KatanVariant[] = [32, 48, 64];

for (const v of variants) {
  const ones = (1n << BigInt(v)) - 1n;
  const cases: readonly [string, bigint, bigint][] = [
    ['key=11..11, plain=00.00', ALL_ONES_KEY, 0n],
    ['key=00..00, plain=11.11', 0n, ones],
  ];
  for (const [label, key, plain] of cases) {
    const c = katanEncrypt(v, key, plain);
    console.log(`katan${v}_encrypt(${label}) = ${c.toString(2).padStart(v, '0')}  (0x${c.toString(16).padStart(v / 4, '0')})`);
  }
}
