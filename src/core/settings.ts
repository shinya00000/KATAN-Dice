export type DiceColor = 'classic' | 'redYellow';
export type ThemeSetting = 'dark' | 'light' | 'system';

export interface Settings {
  readonly diceColor: DiceColor;
  /** seconds after which the elapsed timer is highlighted */
  readonly thinkSeconds: number;
  readonly sound: boolean;
  readonly theme: ThemeSetting;
}

export const defaultSettings: Settings = { diceColor: 'classic', thinkSeconds: 120, sound: true, theme: 'dark' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isThemeSetting = (v: unknown): v is ThemeSetting => v === 'dark' || v === 'light' || v === 'system';

/** Lenient parse: invalid fields fall back to defaults (settings are not critical data). */
export const parseSettings = (raw: unknown): Settings => {
  if (!isRecord(raw)) return defaultSettings;
  const { diceColor, thinkSeconds, sound, theme } = raw;
  return {
    diceColor: diceColor === 'classic' || diceColor === 'redYellow' ? diceColor : defaultSettings.diceColor,
    thinkSeconds:
      typeof thinkSeconds === 'number' && Number.isInteger(thinkSeconds) && thinkSeconds >= 10 && thinkSeconds <= 3600
        ? thinkSeconds
        : defaultSettings.thinkSeconds,
    sound: typeof sound === 'boolean' ? sound : defaultSettings.sound,
    theme: isThemeSetting(theme) ? theme : defaultSettings.theme,
  };
};

/** 'system' is resolved with the OS preference */
export const resolveTheme = (theme: ThemeSetting, prefersLight: boolean): 'dark' | 'light' =>
  theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
