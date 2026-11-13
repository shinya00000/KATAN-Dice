import './style.css';
import { rollDiceDetailed, rollTrace, type Die } from './core/dice';
import { createGame, exportGame, gameKey, reveal, rollNext, verifyGame, type Game } from './core/game';
import { activeRolls, canRedo, canUndo, currentRoll, redo, sumOf, undo } from './core/history';
import { normalizeWords, randomSalt } from './core/keygen';
import { isThemeSetting, resolveTheme, type Settings, type ThemeSetting } from './core/settings';
import { sumDistribution } from './core/stats';
import { loadGame, loadSettings, saveGame, saveSettings } from './core/storage';
import { playRobber } from './ui/sound';
import { cipherViewHtml, dieSvg, dieTheme, formatElapsed, histogramSvg, recentHtml } from './ui/views';
import { startWakeLock, type WakeStatus } from './ui/wakeLock';

// ---------------------------------------------------------------------------
// DOM lookup

const el = <T extends HTMLElement>(id: string, ctor: { new (): T; prototype: T }): T => {
  const node = document.getElementById(id);
  if (!(node instanceof ctor)) throw new Error(`要素 #${id} が見つからないか、型が想定と異なります`);
  return node;
};

const dom = {
  stage: el('dice-stage', HTMLDivElement),
  die1: el('die1', HTMLDivElement),
  die2: el('die2', HTMLDivElement),
  sum: el('sum', HTMLDivElement),
  robber: el('robber', HTMLDivElement),
  btnUndo: el('btn-undo', HTMLButtonElement),
  btnRoll: el('btn-roll', HTMLButtonElement),
  btnRedo: el('btn-redo', HTMLButtonElement),
  recent: el('recent', HTMLDivElement),
  cipher: el('cipher', HTMLDivElement),
  timer: el('timer', HTMLDivElement),
  think: el('think', HTMLDivElement),
  count: el('count', HTMLElement),
  voided: el('voided', HTMLSpanElement),
  wake: el('wake', HTMLElement),
  commitment: el('commitment', HTMLElement),
  chart: el('chart', HTMLDivElement),
  badge: el('phase-badge', HTMLSpanElement),
  btnSettings: el('btn-settings', HTMLButtonElement),
  btnMenu: el('btn-menu', HTMLButtonElement),
  menu: el('game-menu', HTMLDivElement),
  btnReveal: el('btn-reveal', HTMLButtonElement),
  btnNew: el('btn-new', HTMLButtonElement),
  commitBox: el('commit-box', HTMLDivElement),
  btnCommitToggle: el('btn-commit-toggle', HTMLButtonElement),
  commitDetail: el('commit-detail', HTMLDivElement),
  commitNote: el('commit-note', HTMLParagraphElement),
  // setup
  dlgSetup: el('dlg-setup', HTMLDialogElement),
  setupForm: el('setup-form', HTMLFormElement),
  wordFields: el('word-fields', HTMLDivElement),
  btnAddWord: el('btn-add-word', HTMLButtonElement),
  btnSetupCancel: el('btn-setup-cancel', HTMLButtonElement),
  btnStart: el('btn-start', HTMLButtonElement),
  setupError: el('setup-error', HTMLParagraphElement),
  // settings
  dlgSettings: el('dlg-settings', HTMLDialogElement),
  setThink: el('set-think', HTMLInputElement),
  setSound: el('set-sound', HTMLInputElement),
  // reveal
  dlgReveal: el('dlg-reveal', HTMLDialogElement),
  revealChecks: el('reveal-checks', HTMLUListElement),
  rvKey: el('rv-key', HTMLElement),
  rvSalt: el('rv-salt', HTMLElement),
  rvWords: el('rv-words', HTMLElement),
  rvCommit: el('rv-commit', HTMLElement),
  btnExport: el('btn-export', HTMLButtonElement),
  btnNewFromReveal: el('btn-new-from-reveal', HTMLButtonElement),
  toast: el('toast', HTMLDivElement),
};

const ANIM_MS = 700;
const RECENT_LIMIT = 14;
const MAX_PLAYERS = 8;
const INITIAL_PLAYERS = 4;

// ---------------------------------------------------------------------------
// state

interface AppState {
  readonly game: Game | null;
  readonly settings: Settings;
  /** true while the roll animation runs: all inputs are ignored (連打防止) */
  readonly busy: boolean;
  readonly wake: WakeStatus;
  /** full commitment shown? null = automatic (expanded until the first roll, for taking a photo) */
  readonly commitExpanded: boolean | null;
}

let state: AppState = {
  game: null,
  settings: loadSettings(),
  busy: false,
  wake: { kind: 'unsupported' },
  commitExpanded: null,
};

const setState = (patch: Partial<AppState>): void => {
  state = { ...state, ...patch };
  render();
};

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let toastTimer: number | undefined;
const toast = (message: string, kind: 'error' | 'info' = 'error'): void => {
  dom.toast.textContent = message;
  dom.toast.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (dom.toast.className = `toast ${kind}`), kind === 'error' ? 6000 : 4000);
};

/** persists and applies a new game state */
const commitGame = (game: Game | null, patch: Partial<AppState> = {}): void => {
  const saved = saveGame(game);
  if (!saved.ok) toast(saved.error);
  setState({ ...patch, game });
};

// ---------------------------------------------------------------------------
// rendering

const renderDice = (a: Die | null, b: Die | null): void => {
  dom.die1.innerHTML = dieSvg(a, dieTheme(state.settings.diceColor, 1), 'die1');
  dom.die2.innerHTML = dieSvg(b, dieTheme(state.settings.diceColor, 2), 'die2');
};

const renderCipherFinal = (game: Game | null): void => {
  const cur = game === null ? undefined : currentRoll(game.history);
  if (game === null || cur === undefined) {
    dom.cipher.innerHTML = cipherViewHtml({ counter: null, round: 0, snapshot: null, blocks: null });
    return;
  }
  const key = gameKey(game);
  const trace = rollTrace(key, cur.counter);
  const detail = rollDiceDetailed(key, cur.counter);
  dom.cipher.innerHTML = cipherViewHtml({
    counter: cur.counter,
    round: 254,
    snapshot: trace.snapshots[trace.snapshots.length - 1] ?? null,
    blocks: detail.blocks,
  });
};

/** [label, css class, tooltip] — kept short; details go to the tooltip */
const wakeText = (w: WakeStatus): [string, string, string] => {
  switch (w.kind) {
    case 'active':
      return ['スリープ防止: ● 有効', 'wake-line on', '画面が自動で消えないようにしています'];
    case 'released':
      return ['スリープ防止: 一時停止中', 'wake-line', '画面に戻ると再開します'];
    case 'unsupported':
      return ['スリープ防止: 非対応', 'wake-line', 'このブラウザは Screen Wake Lock API に対応していません'];
    case 'error':
      return ['スリープ防止: 利用不可', 'wake-line', w.message];
  }
};

const shortHex = (h: string): string => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

const renderCommitment = (game: Game | null): void => {
  if (game === null) {
    dom.commitment.textContent = '—';
    dom.commitBox.className = 'commit-box';
    dom.commitDetail.hidden = true;
    dom.btnCommitToggle.hidden = true;
    return;
  }
  const fresh = game.history.log.length === 0 && game.phase === 'playing';
  const expanded = state.commitExpanded ?? fresh;
  dom.commitment.textContent = expanded ? game.commitment : shortHex(game.commitment);
  dom.commitment.title = game.commitment;
  dom.commitBox.className = `commit-box${expanded ? ' expanded' : ''}${fresh ? ' spotlight' : ''}`;
  dom.commitDetail.hidden = !expanded;
  dom.commitNote.hidden = !fresh;
  dom.btnCommitToggle.hidden = false;
  dom.btnCommitToggle.textContent = expanded ? 'たたむ' : '全体を表示';
  dom.btnCommitToggle.setAttribute('aria-expanded', String(expanded));
};

const updateTimer = (): void => {
  const game = state.game;
  const cur = game === null ? undefined : currentRoll(game.history);
  if (game === null || game.phase !== 'playing' || cur === undefined || state.busy) {
    dom.timer.textContent = game?.phase === 'revealed' ? '終了' : '--:--';
    dom.timer.className = 'timer';
    dom.think.textContent = '';
    return;
  }
  const elapsed = Date.now() - cur.at;
  const limit = state.settings.thinkSeconds * 1000;
  dom.timer.textContent = formatElapsed(elapsed);
  dom.timer.className = `timer${elapsed >= 2 * limit ? ' over' : elapsed >= limit ? ' warn' : ''}`;
  dom.think.textContent = elapsed >= limit ? `長考中（目安 ${formatElapsed(limit)} を超えています）` : '';
};

const render = (): void => {
  const { game, busy } = state;
  const history = game?.history;
  const cur = history === undefined ? undefined : currentRoll(history);
  const playing = game?.phase === 'playing';

  if (!busy) {
    renderDice(cur?.d1 ?? null, cur?.d2 ?? null);
    renderCipherFinal(game);
    const s = cur === undefined ? null : sumOf(cur);
    dom.sum.className = `sum${s === 7 ? ' seven' : ''}`;
    dom.sum.innerHTML = s === null ? '' : `合計<b>${s}</b>`;
  }

  dom.btnRoll.disabled = busy || !playing;
  dom.btnUndo.disabled = busy || !playing || history === undefined || !canUndo(history);
  dom.btnRedo.disabled = busy || !playing || history === undefined || !canRedo(history);
  dom.btnReveal.disabled = busy || game === null;
  dom.btnReveal.textContent = game?.phase === 'revealed' ? '検証結果を見る' : 'ゲーム終了（鍵を公開）…';
  dom.btnNew.disabled = busy;
  dom.badge.hidden = game?.phase !== 'revealed';

  const log = history?.log ?? [];
  dom.recent.innerHTML = recentHtml(log, RECENT_LIMIT, cur?.counter ?? null);
  const active = history === undefined ? [] : activeRolls(history);
  const cancelled = log.length - active.length;
  dom.count.textContent = String(active.length);
  dom.voided.textContent = cancelled > 0 ? `（取消 ${cancelled}）` : '';
  renderCommitment(game);
  dom.chart.innerHTML = histogramSvg(sumDistribution(active), active.length);

  const [wake, wakeClass, wakeTitle] = wakeText(state.wake);
  dom.wake.textContent = wake;
  dom.wake.className = wakeClass;
  dom.wake.title = wakeTitle;

  updateTimer();
};

// ---------------------------------------------------------------------------
// roll / undo / redo

const easeOutCubic = (p: number): number => 1 - (1 - p) ** 3;

/** rAF-driven animation with a timeout fallback (rAF is paused in background tabs) */
const animate = (ms: number, onFrame: (p: number) => void): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      onFrame(1);
      resolve();
    };
    const step = (t: number): void => {
      if (done) return;
      const p = Math.min(1, (t - start) / ms);
      if (p >= 1) return finish();
      onFrame(p);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    window.setTimeout(finish, ms + 400);
  });

const faceFrom = (n: number): Die => ((n % 6) + 1) as Die;

const restartAnimation = (node: HTMLElement, cls: string): void => {
  node.classList.remove(cls);
  void node.offsetWidth; // force reflow so the CSS animation restarts
  node.classList.add(cls);
};

const robberEffect = (): void => {
  restartAnimation(dom.robber, 'show');
  if (state.settings.sound) {
    void playRobber().then((err) => {
      if (err !== null) toast(err);
    });
  }
};

const onRoll = async (): Promise<void> => {
  const game = state.game;
  if (state.busy || game === null || game.phase !== 'playing') return;

  let next: Game;
  try {
    next = rollNext(game, Date.now());
  } catch (e) {
    toast(`サイコロを振れませんでした: ${errorMessage(e)}`);
    return;
  }
  // persist immediately (a reload mid-animation must not reuse the counter), show after the animation
  const saved = saveGame(next);
  if (!saved.ok) toast(saved.error);

  const counter = game.history.nextCounter;
  const key = gameKey(game);
  const trace = rollTrace(key, counter);

  setState({ busy: true });
  dom.sum.innerHTML = '';
  dom.stage.classList.remove('landed');
  dom.stage.classList.add('rolling');
  let lastFlip = -Infinity;
  await animate(ANIM_MS, (p) => {
    const round = Math.min(254, Math.round(easeOutCubic(p) * 254));
    const snapshot = trace.snapshots[round] ?? null;
    dom.cipher.innerHTML = cipherViewHtml({ counter, round, snapshot, blocks: null });
    const now = performance.now();
    if (snapshot !== null && now - lastFlip > 70) {
      lastFlip = now;
      renderDice(faceFrom(snapshot.l1), faceFrom(snapshot.l2));
    }
  });
  dom.stage.classList.remove('rolling');
  restartAnimation(dom.stage, 'landed');

  setState({ game: next, busy: false });
  const cur = currentRoll(next.history);
  if (cur !== undefined && sumOf(cur) === 7) robberEffect();
};

const stepHistory = (step: (h: Game['history']) => Game['history']): void => {
  const game = state.game;
  if (state.busy || game === null || game.phase !== 'playing') return;
  dom.robber.classList.remove('show'); // the 7 effect belongs to the roll that is being stepped away from
  commitGame({ ...game, history: step(game.history) });
};

const onUndo = (): void => stepHistory(undo);
const onRedo = (): void => stepHistory(redo);

/** mouse clicks drop focus so that a later Space press never re-activates the same button */
const onClick = (button: HTMLButtonElement, handler: () => void): void => {
  button.addEventListener('click', (e) => {
    if (e.detail > 0) button.blur();
    handler();
  });
};

onClick(dom.btnRoll, () => void onRoll());
onClick(dom.btnUndo, onUndo);
onClick(dom.btnRedo, onRedo);

const dialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;

// ---------------------------------------------------------------------------
// ⋯ menu (irreversible game actions live here, away from the everyday buttons)

const menuOpen = (): boolean => !dom.menu.hidden;

const setMenu = (open: boolean): void => {
  dom.menu.hidden = !open;
  dom.btnMenu.setAttribute('aria-expanded', String(open));
  if (open) dom.menu.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
};

dom.btnMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(!menuOpen());
});
document.addEventListener('click', (e) => {
  if (menuOpen() && e.target instanceof Node && !dom.menu.contains(e.target)) setMenu(false);
});
dom.menu.addEventListener('click', (e) => {
  if (e.target instanceof HTMLElement && e.target.closest('.menu-item') !== null) setMenu(false);
});

document.addEventListener('keydown', (e) => {
  if (menuOpen()) {
    if (e.key === 'Escape') {
      setMenu(false);
      dom.btnMenu.focus();
    }
    return;
  }
  if (dialogOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const action = e.code === 'Space' ? onRoll : e.key === 'ArrowLeft' ? onUndo : e.key === 'ArrowRight' ? onRedo : null;
  if (action === null) return;
  e.preventDefault();
  if (!e.repeat) void action();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !dialogOpen() && !menuOpen()) e.preventDefault();
});

// ---------------------------------------------------------------------------
// setup (new game)

const addWordField = (): void => {
  const n = dom.wordFields.children.length;
  if (n >= MAX_PLAYERS) return;
  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = `プレイヤー${n + 1}の合言葉`;
  input.setAttribute('aria-label', input.placeholder);
  dom.wordFields.append(input);
  dom.btnAddWord.disabled = n + 1 >= MAX_PLAYERS;
};

const openSetup = (): void => {
  dom.wordFields.replaceChildren();
  for (let i = 0; i < INITIAL_PLAYERS; i++) addWordField();
  dom.setupError.textContent = '';
  dom.btnStart.disabled = false;
  dom.btnSetupCancel.hidden = state.game === null;
  dom.dlgSetup.showModal();
  dom.wordFields.querySelector('input')?.focus();
};

dom.btnAddWord.addEventListener('click', () => {
  addWordField();
  const inputs = dom.wordFields.querySelectorAll('input');
  inputs[inputs.length - 1]?.focus();
});

dom.btnSetupCancel.addEventListener('click', () => dom.dlgSetup.close());

// without a game the setup dialog must not be dismissed with Escape
dom.dlgSetup.addEventListener('cancel', (e) => {
  if (state.game === null) e.preventDefault();
});

dom.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const words = normalizeWords(Array.from(dom.wordFields.querySelectorAll('input'), (i) => i.value));
  dom.btnStart.disabled = true;
  dom.setupError.textContent = '';
  void (async () => {
    try {
      const game = await createGame(randomSalt(), words, Date.now());
      dom.dlgSetup.close();
      commitGame(game, { commitExpanded: null });
      toast(
        `鍵を生成しました（合言葉 ${words.length} 個）。右上のコミットメントを撮影・メモしておくと、終了後に検証できます。`,
        'info',
      );
    } catch (err) {
      dom.setupError.textContent = `鍵を生成できませんでした: ${errorMessage(err)}`;
      dom.btnStart.disabled = false;
    }
  })();
});

dom.btnNew.addEventListener('click', () => {
  const g = state.game;
  if (
    g !== null &&
    g.phase === 'playing' &&
    g.history.log.length > 0 &&
    !window.confirm(
      'このゲームの鍵はまだ公開していません。\n破棄して新しいゲームを始めますか？\n（公開して検証するには「ゲーム終了（鍵を公開）」を使います）',
    )
  ) {
    return;
  }
  openSetup();
});

dom.btnCommitToggle.addEventListener('click', () => {
  const g = state.game;
  const fresh = g !== null && g.history.log.length === 0 && g.phase === 'playing';
  setState({ commitExpanded: !(state.commitExpanded ?? fresh) });
});

// ---------------------------------------------------------------------------
// reveal & verify

const checkItem = (ok: boolean, text: string): HTMLLIElement => {
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'ng';
  li.textContent = text;
  return li;
};

const openReveal = async (game: Game): Promise<void> => {
  dom.rvKey.textContent = game.keyHex;
  dom.rvSalt.textContent = game.saltHex;
  dom.rvCommit.textContent = game.commitment;
  dom.rvWords.replaceChildren(
    ...(game.words.length === 0
      ? [document.createTextNode('（なし）')]
      : game.words.map((w, i) => {
          const pill = document.createElement('span');
          pill.className = 'word-pill';
          pill.textContent = `w${i + 1} = ${w}`;
          return pill;
        })),
  );
  const pending = document.createElement('li');
  pending.textContent = '検証中…';
  dom.revealChecks.replaceChildren(pending);
  if (!dom.dlgReveal.open) dom.dlgReveal.showModal();

  try {
    const r = await verifyGame(game);
    dom.revealChecks.replaceChildren(
      checkItem(r.keyDerivationOk, `合言葉と r から鍵 K を再計算 → ${r.keyDerivationOk ? '一致' : '不一致'}`),
      checkItem(
        r.commitmentOk,
        `公開された K から Com を再計算 → 開始時に表示した Com と${r.commitmentOk ? '一致' : '一致しません'}`,
      ),
      checkItem(
        r.mismatches.length === 0,
        r.mismatches.length === 0
          ? `全 ${r.checked} 投（取消を含む）を鍵から再計算 → すべて一致`
          : `全 ${r.checked} 投中 ${r.mismatches.length} 投が不一致（#${r.mismatches.map((c) => c + 1).join(', #')}）`,
      ),
    );
  } catch (err) {
    dom.revealChecks.replaceChildren(checkItem(false, `検証できませんでした: ${errorMessage(err)}`));
  }
};

dom.btnReveal.addEventListener('click', () => {
  const g = state.game;
  if (g === null) return;
  if (g.phase === 'revealed') {
    void openReveal(g);
    return;
  }
  if (!window.confirm('鍵を公開してゲームを終了します。\n公開後はこのゲームでサイコロを振れません。よろしいですか？')) return;
  const next = reveal(g, Date.now());
  commitGame(next);
  void openReveal(next);
});

dom.btnExport.addEventListener('click', () => {
  const g = state.game;
  if (g === null) return;
  const blob = new Blob([exportGame(g)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date(g.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `katan-dice-${stamp}.json`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

dom.btnNewFromReveal.addEventListener('click', () => {
  dom.dlgReveal.close();
  openSetup();
});

// ---------------------------------------------------------------------------
// settings

const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

const applyTheme = (theme: ThemeSetting): void => {
  document.documentElement.dataset.theme = resolveTheme(theme, prefersLight.matches);
};

prefersLight.addEventListener('change', () => applyTheme(state.settings.theme));

const applySettings = (settings: Settings): void => {
  const saved = saveSettings(settings);
  if (!saved.ok) toast(saved.error);
  applyTheme(settings.theme);
  setState({ settings });
};

dom.btnSettings.addEventListener('click', () => {
  const s = state.settings;
  dom.dlgSettings.querySelectorAll<HTMLInputElement>('input[name="diceColor"]').forEach((r) => {
    r.checked = r.value === s.diceColor;
  });
  dom.dlgSettings.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((r) => {
    r.checked = r.value === s.theme;
  });
  dom.setThink.value = String(s.thinkSeconds);
  dom.setSound.checked = s.sound;
  dom.dlgSettings.showModal();
});

dom.dlgSettings.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    if (isThemeSetting(radio.value)) applySettings({ ...state.settings, theme: radio.value });
  }),
);

dom.dlgSettings.querySelectorAll<HTMLInputElement>('input[name="diceColor"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    if (radio.value === 'classic' || radio.value === 'redYellow') {
      applySettings({ ...state.settings, diceColor: radio.value });
    }
  }),
);

dom.setThink.addEventListener('change', () => {
  const v = Number(dom.setThink.value);
  if (Number.isInteger(v) && v >= 10 && v <= 3600) {
    applySettings({ ...state.settings, thinkSeconds: v });
  } else {
    toast('長考の目安は 10〜3600 秒の整数で指定してください');
    dom.setThink.value = String(state.settings.thinkSeconds);
  }
});

dom.setSound.addEventListener('change', () => applySettings({ ...state.settings, sound: dom.setSound.checked }));

// ---------------------------------------------------------------------------
// boot

const loaded = loadGame();
if (!loaded.ok) toast(`${loaded.error}。新しいゲームを始めてください。`);
state = { ...state, game: loaded.ok ? loaded.value : null };
applyTheme(state.settings.theme);
render();
window.setInterval(updateTimer, 250);
startWakeLock((wake) => setState({ wake }));
if (state.game === null) openSetup();
