import { parseGame, type Game } from './game';
import { defaultSettings, parseSettings, type Settings } from './settings';

const GAME_KEY = 'katan-dice/v1/game';
const SETTINGS_KEY = 'katan-dice/v1/settings';

export type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const readJson = (key: string): LoadResult<unknown> => {
  try {
    const text = localStorage.getItem(key);
    return { ok: true, value: text === null ? null : (JSON.parse(text) as unknown) };
  } catch (e) {
    return { ok: false, error: `localStorage の読み込みに失敗しました: ${describe(e)}` };
  }
};

const writeJson = (key: string, value: unknown): LoadResult<null> => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return { ok: true, value: null };
  } catch (e) {
    return { ok: false, error: `localStorage への保存に失敗しました: ${describe(e)}` };
  }
};

export const loadGame = (): LoadResult<Game | null> => {
  const r = readJson(GAME_KEY);
  if (!r.ok) return r;
  if (r.value === null) return { ok: true, value: null };
  try {
    return { ok: true, value: parseGame(r.value) };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
};

export const saveGame = (g: Game | null): LoadResult<null> => writeJson(GAME_KEY, g);

export const loadSettings = (): Settings => {
  const r = readJson(SETTINGS_KEY);
  return r.ok ? parseSettings(r.value) : defaultSettings;
};

export const saveSettings = (s: Settings): LoadResult<null> => writeJson(SETTINGS_KEY, s);
