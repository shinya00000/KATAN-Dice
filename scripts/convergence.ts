/**
 * Convergence experiment using the app's own KATAN64-based dice.
 *
 *  A. Empirical distribution of 2d6 sums vs. N: distance to the exact triangle and to the
 *     (continuity-corrected, discretised) normal N(7, 35/6).
 *  B. Sum of k dice (k = 1..12) taken from the same stream: distance of the exact and the
 *     empirical distribution to the normal N(3.5k, 35k/12)  — the CLT direction.
 *
 * Distance = total variation  TV(p, q) = ½ Σ |p(s) − q(s)|.
 * Usage: npx vite-node scripts/convergence.ts [rolls]
 */
import { rollDice } from '../src/core/dice';

const ROLLS = Number(process.argv[2] ?? 100_000);
if (!Number.isInteger(ROLLS) || ROLLS < 100) throw new Error(`rolls must be an integer >= 100: ${process.argv[2]}`);

// --- math helpers -----------------------------------------------------------
const erf = (x: number): number => {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const phi = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));

/** P(S = s) under N(mu, var) with continuity correction, for s in [lo, hi] */
const discreteNormal = (mu: number, variance: number, lo: number, hi: number): number[] => {
  const sd = Math.sqrt(variance);
  return Array.from({ length: hi - lo + 1 }, (_, i) => {
    const s = lo + i;
    const a = s === lo ? 0 : phi((s - 0.5 - mu) / sd);
    const b = s === hi ? 1 : phi((s + 0.5 - mu) / sd);
    return b - a;
  });
};

/** exact distribution of the sum of k fair dice (support k..6k) by convolution */
const exactDiceSum = (k: number): number[] => {
  let dist = [1];
  for (let i = 0; i < k; i++) {
    const next = new Array<number>(dist.length + 5).fill(0);
    dist.forEach((p, j) => {
      for (let f = 0; f < 6; f++) next[j + f]! += p / 6;
    });
    dist = next;
  }
  return dist;
};

const tv = (p: readonly number[], q: readonly number[]): number =>
  p.reduce((acc, pi, i) => acc + Math.abs(pi - (q[i] ?? 0)), 0) / 2;

const fmt = (x: number, d = 4): string => x.toFixed(d);

// --- generate the stream with KATAN64 ---------------------------------------
const keyBytes = crypto.getRandomValues(new Uint8Array(10));
const key = keyBytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
const t0 = performance.now();
const faces: number[] = [];
const sums: number[] = [];
for (let n = 0; n < ROLLS; n++) {
  const { d1, d2 } = rollDice(key, n);
  faces.push(d1, d2);
  sums.push(d1 + d2);
}
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`key = 0x${key.toString(16).padStart(20, '0')}, ${ROLLS} rolls in ${elapsed}s\n`);

// --- A: 2d6 histogram vs N ---------------------------------------------------
const triangle = exactDiceSum(2); // index 0 ↔ sum 2
const normal2 = discreteNormal(7, 35 / 6, 2, 12);
console.log(`A. 2d6 の合計の分布（理論の三角形と正規近似の距離 TV = ${fmt(tv(triangle, normal2))}）`);
console.log('N\tTV(実測,三角形)\tTV(実測,正規)\t1/√N');
const checkpoints = [10, 30, 100, 300, 1000, 3000, 10_000, 30_000, 100_000, 300_000, 1_000_000].filter((n) => n <= ROLLS);
const counts = new Array<number>(11).fill(0);
let filled = 0;
const resultA: { n: number; tri: number; nor: number }[] = [];
for (const n of checkpoints) {
  for (; filled < n; filled++) counts[sums[filled]! - 2]!++;
  const emp = counts.map((c) => c / n);
  const r = { n, tri: tv(emp, triangle), nor: tv(emp, normal2) };
  resultA.push(r);
  console.log(`${n}\t${fmt(r.tri)}\t\t${fmt(r.nor)}\t\t${fmt(1 / Math.sqrt(n))}`);
}

// --- B: sum of k dice (CLT) --------------------------------------------------
console.log('\nB. サイコロ k 個の合計（同じ KATAN の出目列を k 個ずつ区切る）');
console.log('k\tサンプル数\tTV(厳密,正規)\tTV(実測,正規)\tTV(実測,厳密)');
const resultB: { k: number; samples: number; exactVsNormal: number; empVsNormal: number; empVsExact: number }[] = [];
for (const k of [1, 2, 3, 4, 6, 8, 12]) {
  const samples = Math.floor(faces.length / k);
  const exact = exactDiceSum(k);
  const normal = discreteNormal(3.5 * k, (35 * k) / 12, k, 6 * k);
  const c = new Array<number>(exact.length).fill(0);
  for (let i = 0; i < samples; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += faces[i * k + j]!;
    c[s - k]!++;
  }
  const emp = c.map((x) => x / samples);
  const r = { k, samples, exactVsNormal: tv(exact, normal), empVsNormal: tv(emp, normal), empVsExact: tv(emp, exact) };
  resultB.push(r);
  console.log(`${k}\t${samples}\t\t${fmt(r.exactVsNormal)}\t\t${fmt(r.empVsNormal)}\t\t${fmt(r.empVsExact)}`);
}

console.log(`\nJSON ${JSON.stringify({ resultA, resultB, triangleVsNormal: tv(triangle, normal2) })}`);
