/**
 * Generates the link-preview (OGP) image shown by LINE, X, Slack, etc.
 *
 *   docs/images/og-image.svg  – source (1200×630, light theme)
 *   public/og-image.png       – rendered PNG, copied to dist/ by Vite and referenced by og:image
 *
 * The dice are drawn with the app's own dieSvg(); the bit cells are the real KATAN64 register
 * state after 254 rounds (key = ASCII "KATAN-DICE", plaintext 0).
 * PNG rendering uses headless Google Chrome with a throwaway profile.
 *
 * Usage: npx vite-node scripts/og-image.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { katan64EncryptTrace } from '../src/crypto/katan';
import { dieSvg, dieTheme } from '../src/ui/views';

const W = 1200;
const H = 630;
const SVG_OUT = 'docs/images/og-image.svg';
const PNG_OUT = 'public/og-image.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const KEY = [...'KATAN-DICE'].reduce((acc, ch) => (acc << 8n) | BigInt(ch.charCodeAt(0)), 0n);
const trace = katan64EncryptTrace(KEY, 0n);
const last = trace.snapshots[trace.snapshots.length - 1];
if (last === undefined) throw new Error('KATAN trace is empty');

const FONT = `-apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif`;

const cells = (value: number, length: number, x: number, y: number, on: string): string => {
  const size = 13;
  const gap = 4;
  return Array.from({ length }, (_, col) => {
    const i = length - 1 - col; // MSB on the left, as in the app
    const bit = Math.floor(value / 2 ** i) % 2;
    return `<rect x="${x + col * (size + gap)}" y="${y}" width="${size}" height="${size}" rx="3" fill="${bit ? on : '#e6dece'}"/>`;
  }).join('');
};

/** places the app's die SVG (viewBox 0 0 100 100) at (x, y) with the given size and an outer shadow */
const die = (value: 1 | 2 | 3 | 4 | 5 | 6, which: 1 | 2, x: number, y: number, size: number): string =>
  `<g filter="url(#die-shadow)"><svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 100 100">${dieSvg(value, dieTheme('classic', which), `og${which}`)
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')}</svg></g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">
  <defs>
    <radialGradient id="bg" cx="0.2" cy="0.1" r="1.1">
      <stop offset="0" stop-color="#fbf8f1"/>
      <stop offset="0.6" stop-color="#f3eee3"/>
      <stop offset="1" stop-color="#e9e2d3"/>
    </radialGradient>
    <filter id="die-shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#46321a" flood-opacity="0.35"/>
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#46321a" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="32" fill="#fffdf8" stroke="#ddd3c0" stroke-width="2"/>

  <text x="96" y="200" font-size="84" font-weight="800" letter-spacing="1"><tspan fill="#b07a0a">KATAN</tspan><tspan fill="#2a2620"> Dice</tspan></text>
  <text x="100" y="272" font-size="40" font-weight="700" fill="#2a2620">共通鍵暗号で振るサイコロ</text>
  <text x="100" y="340" font-size="26" fill="#6d6556">KATAN64 で2つのサイコロを振るカタン用アプリ</text>
  <text x="100" y="380" font-size="26" fill="#6d6556">出目の公平性を、あとから検証できます</text>

  <text x="100" y="470" font-size="15" font-weight="700" fill="#9a9180" letter-spacing="1">KATAN64 REGISTERS</text>
  <text x="100" y="502" font-size="15" fill="#9a9180" font-family="ui-monospace, Menlo, monospace">L1</text>
  ${cells(last.l1, 25, 132, 490, '#d99a12')}
  <text x="100" y="525" font-size="15" fill="#9a9180" font-family="ui-monospace, Menlo, monospace">L2</text>
  ${cells(last.l2, 39, 132, 513, '#2f86b8')}

  ${die(3, 1, 790, 104, 200)}
  ${die(4, 2, 930, 284, 200)}

  <text x="${W - 80}" y="${H - 70}" font-size="20" text-anchor="end" fill="#8a8273">shinya00000.github.io/KATAN-Dice</text>
</svg>
`;

mkdirSync('docs/images', { recursive: true });
mkdirSync('public', { recursive: true });
writeFileSync(SVG_OUT, svg);
console.log(`wrote ${SVG_OUT}`);

if (!existsSync(CHROME)) {
  throw new Error(`Google Chrome が見つからないため PNG を作れません: ${CHROME}`);
}
const profile = mkdtempSync(join(tmpdir(), 'og-chrome-'));
try {
  const r = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--window-size=${W},${H}`,
      `--screenshot=${resolve(PNG_OUT)}`,
      `file://${resolve(SVG_OUT)}`,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  if (r.status !== 0 || !existsSync(PNG_OUT)) {
    throw new Error(`Chrome での PNG 書き出しに失敗しました (status ${r.status}): ${r.stderr}`);
  }
  console.log(`wrote ${PNG_OUT}`);
} finally {
  rmSync(profile, { recursive: true, force: true });
}
