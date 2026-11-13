/**
 * Generates the figures and numbers used in README.md.
 *
 * Rolls the app's own KATAN64 dice ROLLS times with a fixed, documented key
 * (K = ASCII "KATAN-DICE", exactly 80 bits) so that the result is reproducible, then writes
 *   docs/images/distribution.svg  – histogram of 2d6 sums vs. the exact triangle
 *   docs/images/convergence.svg   – total-variation distance vs. N (log-log)
 * and prints the statistics as JSON.
 *
 * Usage: npx vite-node scripts/readme-figures.ts [rolls]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { rollDice } from '../src/core/dice';
import { theoreticalProbability } from '../src/core/stats';

const ROLLS = Number(process.argv[2] ?? 1_000_000);
if (!Number.isInteger(ROLLS) || ROLLS < 1000) throw new Error(`rolls must be an integer >= 1000: ${process.argv[2]}`);

const KEY_ASCII = 'KATAN-DICE';
const KEY = [...KEY_ASCII].reduce((acc, ch) => (acc << 8n) | BigInt(ch.charCodeAt(0)), 0n);
const OUT_DIR = 'docs/images';

// ---------------------------------------------------------------- math
const erf = (x: number): number => {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const phi = (z: number): number => 0.5 * (1 + erf(z / Math.SQRT2));
const SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const triangle = SUMS.map(theoreticalProbability);
const sd = Math.sqrt(35 / 6);
const normal = SUMS.map((s, i) => (i === SUMS.length - 1 ? 1 : phi((s + 0.5 - 7) / sd)) - (i === 0 ? 0 : phi((s - 0.5 - 7) / sd)));
const tv = (p: readonly number[], q: readonly number[]): number => p.reduce((a, x, i) => a + Math.abs(x - (q[i] ?? 0)), 0) / 2;

// ---------------------------------------------------------------- simulation
const t0 = performance.now();
const sumCounts = new Array<number>(11).fill(0);
const faceCounts = new Array<number>(6).fill(0);
const pairCounts = new Array<number>(36).fill(0);
const checkpoints = [10, 30, 100, 300, 1_000, 3_000, 10_000, 30_000, 100_000, 300_000, 1_000_000, 3_000_000].filter((n) => n <= ROLLS);
const convergence: { n: number; triangle: number; normal: number }[] = [];
let prevSum = 0;
let sumXY = 0;
let sumX = 0;
let sumX2 = 0;
for (let n = 0; n < ROLLS; n++) {
  const { d1, d2 } = rollDice(KEY, n);
  const s = d1 + d2;
  sumCounts[s - 2]!++;
  faceCounts[d1 - 1]!++;
  faceCounts[d2 - 1]!++;
  pairCounts[(d1 - 1) * 6 + (d2 - 1)]!++;
  if (n > 0) sumXY += prevSum * s;
  sumX += s;
  sumX2 += s * s;
  prevSum = s;
  if (checkpoints.includes(n + 1)) {
    const emp = sumCounts.map((c) => c / (n + 1));
    convergence.push({ n: n + 1, triangle: tv(emp, triangle), normal: tv(emp, normal) });
  }
}
const seconds = (performance.now() - t0) / 1000;

const chi2 = (obs: readonly number[], exp: readonly number[]): number => obs.reduce((a, o, i) => a + (o - exp[i]!) ** 2 / exp[i]!, 0);
const chiSums = chi2(sumCounts, triangle.map((p) => p * ROLLS));
const chiFaces = chi2(faceCounts, faceCounts.map(() => (2 * ROLLS) / 6));
const chiPairs = chi2(pairCounts, pairCounts.map(() => ROLLS / 36));
const mean = sumX / ROLLS;
const variance = sumX2 / ROLLS - mean ** 2;
// lag-1 autocorrelation of consecutive sums
const lag1 = (sumXY / (ROLLS - 1) - mean ** 2) / variance;

// ---------------------------------------------------------------- svg helpers
const FONT = `font-family="-apple-system, 'Hiragino Sans', 'Noto Sans JP', 'Segoe UI', sans-serif"`;
const fmt = (x: number, d: number): string => x.toFixed(d);
const frame = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${FONT}>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="#ffffff" stroke="#e3ddd0"/>
${body}
</svg>
`;

// ---------------------------------------------------------------- figure 1: distribution
const distributionSvg = (): string => {
  const W = 720;
  const H = 380;
  const m = { l: 56, r: 24, t: 70, b: 46 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const yMax = 0.18;
  const y = (p: number): number => m.t + ih - (p / yMax) * ih;
  const slot = iw / SUMS.length;
  const parts: string[] = [];
  parts.push(`<text x="${m.l - 32}" y="30" font-size="17" font-weight="700" fill="#2a2620">KATAN64 で ${ROLLS.toLocaleString('en-US')} 回振ったときの「2つの目の合計」の分布</text>`);
  parts.push(
    `<rect x="${m.l - 32}" y="44" width="12" height="12" rx="2" fill="#e2a92f"/><text x="${m.l - 14}" y="54" font-size="12" fill="#5c564b">実測</text>` +
      `<rect x="${m.l + 26}" y="44" width="12" height="12" rx="2" fill="#ddd6c8"/><text x="${m.l + 44}" y="54" font-size="12" fill="#5c564b">理論値 (6 − |s − 7|) / 36</text>`,
  );
  for (let p = 0; p <= yMax + 1e-9; p += 0.05) {
    parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(p)}" y2="${y(p)}" stroke="#efeae0"/>`);
    parts.push(`<text x="${m.l - 8}" y="${y(p) + 4}" font-size="11" text-anchor="end" fill="#8a8273">${Math.round(p * 100)}%</text>`);
  }
  SUMS.forEach((s, i) => {
    const cx = m.l + slot * (i + 0.5);
    const obs = sumCounts[i]! / ROLLS;
    const exp = triangle[i]!;
    const color = s === 7 ? '#cf4430' : '#e2a92f';
    parts.push(`<rect x="${cx - slot * 0.42}" y="${y(exp)}" width="${slot * 0.84}" height="${y(0) - y(exp)}" rx="3" fill="#ddd6c8"/>`);
    parts.push(`<rect x="${cx - slot * 0.23}" y="${y(obs)}" width="${slot * 0.46}" height="${y(0) - y(obs)}" rx="3" fill="${color}"/>`);
    parts.push(`<text x="${cx}" y="${Math.min(y(obs), y(exp)) - 6}" font-size="11" text-anchor="middle" fill="#2a2620">${fmt(obs * 100, 2)}%</text>`);
    parts.push(`<text x="${cx}" y="${H - m.b + 20}" font-size="14" font-weight="700" text-anchor="middle" fill="${s === 7 ? '#cf4430' : '#5c564b'}">${s}</text>`);
  });
  parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="#c9c1b0"/>`);
  parts.push(`<text x="${W - m.r}" y="${H - 10}" font-size="11" text-anchor="end" fill="#8a8273">鍵 K = ASCII "${KEY_ASCII}"（再現用の固定鍵）</text>`);
  return frame(W, H, parts.join('\n'));
};

// ---------------------------------------------------------------- figure 2: convergence
const convergenceSvg = (): string => {
  const W = 720;
  const H = 400;
  const m = { l: 64, r: 44, t: 74, b: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const xMin = 1;
  const xMax = Math.log10(Math.max(...checkpoints));
  const yMinL = -3;
  const yMaxL = 0;
  const x = (n: number): number => m.l + ((Math.log10(n) - xMin) / (xMax - xMin)) * iw;
  const y = (v: number): number => m.t + ((yMaxL - Math.log10(v)) / (yMaxL - yMinL)) * ih;
  const parts: string[] = [];
  parts.push(`<text x="20" y="30" font-size="17" font-weight="700" fill="#2a2620">振る回数 N と、理論分布からのずれ（全変動距離 TV）</text>`);
  const legend = [
    ['#2a78d6', '', '実測 vs 三角形（厳密な理論値）'],
    ['#eb6834', '6 4', '実測 vs 正規分布 N(7, 35/6)'],
    ['#9a9384', '2 3', '三角形と正規分布そのものの距離'],
  ] as const;
  const legendX = [20, 245, 460];
  legend.forEach(([color, dash, label], i) => {
    const lx = legendX[i] ?? 20;
    parts.push(`<line x1="${lx}" x2="${lx + 22}" y1="50" y2="50" stroke="${color}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
    parts.push(`<text x="${lx + 28}" y="54" font-size="12" fill="#5c564b">${label}</text>`);
  });
  for (let e = yMinL; e <= yMaxL; e++) {
    const v = 10 ** e;
    parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#efeae0"/>`);
    parts.push(`<text x="${m.l - 8}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#8a8273">${v}</text>`);
  }
  for (let e = xMin; e <= Math.floor(xMax); e++) {
    const n = 10 ** e;
    parts.push(`<line x1="${x(n)}" x2="${x(n)}" y1="${m.t}" y2="${m.t + ih}" stroke="#f5f1e8"/>`);
    parts.push(`<text x="${x(n)}" y="${m.t + ih + 18}" font-size="11" text-anchor="middle" fill="#8a8273">${n.toLocaleString('en-US')}</text>`);
  }
  parts.push(`<text x="${m.l + iw / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="#5c564b">振る回数 N（対数目盛）</text>`);
  parts.push(`<text x="18" y="${m.t + ih / 2}" font-size="12" text-anchor="middle" fill="#5c564b" transform="rotate(-90 18 ${m.t + ih / 2})">TV（対数目盛）</text>`);
  // reference 1/√N
  const n0 = 10;
  const n1 = Math.max(...checkpoints);
  parts.push(`<line x1="${x(n0)}" x2="${x(n1)}" y1="${y(1 / Math.sqrt(n0))}" y2="${y(1 / Math.sqrt(n1))}" stroke="#cfc8b8" stroke-width="1.2"/>`);
  // label for the reference line, placed in the empty lower-left corner of the plot
  parts.push(`<line x1="${x(12)}" x2="${x(12) + 22}" y1="${y(0.0016)}" y2="${y(0.0016)}" stroke="#cfc8b8" stroke-width="1.2"/>`);
  parts.push(`<text x="${x(12) + 28}" y="${y(0.0016) + 4}" font-size="11" fill="#9a9384">細線: 参考 1/√N</text>`);
  const gap = tv(triangle, normal);
  parts.push(`<line x1="${x(n0)}" x2="${x(n1)}" y1="${y(gap)}" y2="${y(gap)}" stroke="#9a9384" stroke-width="1.5" stroke-dasharray="2 3"/>`);
  const series = (key: 'triangle' | 'normal', color: string, dash: string): void => {
    const pts = convergence.map((c) => `${x(c.n)},${y(c[key])}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
    convergence.forEach((c) => parts.push(`<circle cx="${x(c.n)}" cy="${y(c[key])}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`));
  };
  series('normal', '#eb6834', '6 4');
  series('triangle', '#2a78d6', '');
  return frame(W, H, parts.join('\n'));
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/distribution.svg`, distributionSvg());
writeFileSync(`${OUT_DIR}/convergence.svg`, convergenceSvg());

console.log(
  JSON.stringify(
    {
      rolls: ROLLS,
      seconds: Number(seconds.toFixed(1)),
      key: `0x${KEY.toString(16)}`,
      sums: SUMS.map((s, i) => ({ s, count: sumCounts[i], observed: sumCounts[i]! / ROLLS, expected: triangle[i] })),
      faces: faceCounts,
      chi2: { sums: chiSums, faces: chiFaces, pairs: chiPairs },
      mean,
      variance,
      lag1,
      triangleVsNormal: tv(triangle, normal),
      convergence,
    },
    null,
    2,
  ),
);
