/**
 * Generates the link-preview (OGP) image shown by LINE, X, Slack, etc.
 *
 *   docs/images/og-image.html  – source page (1200×630), built from the app's own stylesheet
 *   public/og-image.png        – rendered PNG, copied to dist/ by Vite and referenced by og:image
 *
 * The page uses src/style.css (Hum: paper, card stock, the torn kraft band), the app's own
 * dieSvg() and Chillax from Fontshare, so the preview always matches the app.
 * PNG rendering uses headless Google Chrome with a throwaway profile (it needs the network for the font).
 *
 * Usage: npx vite-node scripts/og-image.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dieSvg, dieTheme } from '../src/ui/views';

const W = 1200;
const H = 630;
const HTML_OUT = 'docs/images/og-image.html';
const PNG_OUT = 'public/og-image.png';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// a sample run of sums for the band: reads as a sample, not as a claim
const SAMPLE = [6, 8, 5, 9, 7, 4, 10, 6, 8, 11, 3, 8];
const chips = SAMPLE.map((s, i) => {
  const cls = ['chip', s === 7 ? 'seven' : '', i === SAMPLE.length - 1 ? 'current' : ''].filter(Boolean).join(' ');
  return `<span class="${cls}">${s}</span>`;
}).join('');

const page = `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<link href="https://api.fontshare.com/v2/css?f[]=chillax@500,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../src/style.css">
<style>
  html, body { width: ${W}px; height: ${H}px; }
  body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
  .og { display: grid; grid-template-columns: 500px minmax(0, 1fr); gap: var(--space-xl); align-items: center; padding: var(--space-2xl) var(--space-2xl) var(--space-lg); }
  .og .copy { grid-column: 2; grid-row: 1; min-width: 0; }
  .og h1 { max-width: none; white-space: nowrap; font-size: 5.4rem; line-height: 0.95; letter-spacing: -0.04em; }
  .og .sub { margin-top: var(--space-sm); font-size: 2.2rem; font-weight: 600; letter-spacing: -0.01em; }
  .og .lead { margin-top: var(--space-md); font-size: 1.25rem; color: var(--color-ink-2); line-height: 1.5; }
  .og .dice-stage { padding: var(--space-lg); justify-content: space-evenly; min-height: 0; }
  .og .die { width: 190px; }
  .band { --cut-shape: var(--torn-band-top); --cut-fill: var(--color-kraft); padding: var(--space-lg) var(--space-2xl) var(--space-lg); display: flex; justify-content: space-between; align-items: center; color: var(--on-kraft); }
  .band .tiles { display: flex; gap: var(--space-xs); }
  .band .url { font-size: 1.3rem; font-weight: 500; }
</style>
</head>
<body>
  <main class="og">
    <div class="copy">
      <h1>KATAN Dice</h1>
      <p class="sub">共通鍵暗号で振るサイコロ</p>
      <p class="lead">KATAN64 で2つのサイコロを振るカタン用アプリ。<br>出目の公平性を、あとから検証できます。</p>
    </div>
    <div class="dice-stage cut"><div class="dice">
      <div class="die">${dieSvg(3, dieTheme('classic', 1), 'og1')}</div>
      <div class="die">${dieSvg(5, dieTheme('classic', 2), 'og2')}</div>
    </div></div>
  </main>
  <footer class="band cut"><div class="tiles">${chips}</div><span class="url">shinya00000.github.io/KATAN-Dice</span></footer>
</body>
</html>
`;

mkdirSync('docs/images', { recursive: true });
mkdirSync('public', { recursive: true });
writeFileSync(HTML_OUT, page);
console.log(`wrote ${HTML_OUT}`);

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
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      `--window-size=${W},${H}`,
      '--virtual-time-budget=5000',
      `--screenshot=${resolve(PNG_OUT)}`,
      `file://${resolve(HTML_OUT)}`,
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
