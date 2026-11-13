import { describe, expect, it } from 'vitest';
import { addRoll, emptyHistory, undo } from '../src/core/history';
import { defaultSettings, parseSettings, resolveTheme } from '../src/core/settings';
import { recentHtml } from '../src/ui/views';

describe('settings: theme', () => {
  it('defaults to dark and keeps valid values', () => {
    expect(parseSettings(null).theme).toBe('dark');
    expect(parseSettings({ ...defaultSettings, theme: 'neon' }).theme).toBe('dark');
    expect(parseSettings({ ...defaultSettings, theme: 'light' }).theme).toBe('light');
    expect(parseSettings({ ...defaultSettings, theme: 'system' }).theme).toBe('system');
  });

  it('resolves "system" with the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });
});

describe('recent rolls strip', () => {
  it('is chronological (old → new) and marks the current roll, not the undone one', () => {
    let h = emptyHistory;
    for (const d1 of [1, 2, 3] as const) h = addRoll(h, { d1, d2: 1, at: 0 });
    h = undo(h); // sums: 2, 3, (4 undone)
    const html = recentHtml(h.log, 14, 1);
    const sums = [...html.matchAll(/>(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(sums).toEqual([2, 3, 4]);
    expect(html).toMatch(/class="chip active current"[^>]*>3</);
    expect(html).toMatch(/class="chip undone"[^>]*>4</);
  });

  it('keeps only the newest entries', () => {
    let h = emptyHistory;
    for (let i = 0; i < 20; i++) h = addRoll(h, { d1: 1, d2: 1, at: i });
    const html = recentHtml(h.log, 14, 19);
    expect(html.match(/class="chip/g)).toHaveLength(14);
    expect(html).toContain('#20: 1 + 1 = 2');
    expect(html).not.toContain('#6: ');
  });
});

describe('3D die rendering', () => {
  it('uses gradient ids unique per die so two dice never share a fill', async () => {
    const { dieSvg, dieTheme } = await import('../src/ui/views');
    const a = dieSvg(3, dieTheme('redYellow', 1), 'die1');
    const b = dieSvg(3, dieTheme('redYellow', 2), 'die2');
    expect(a).toContain('id="die1-face"');
    expect(b).toContain('url(#die2-face)');
    expect(b).not.toContain('die1-');
    expect(a.match(/<circle /g)).toHaveLength(3); // one flat pip per eye, no extra shadow circles
  });

  it('lighten / darken stay within #rrggbb and reject bad input', async () => {
    const { lighten, darken } = await import('../src/ui/views');
    expect(lighten('#000000', 1)).toBe('#ffffff');
    expect(darken('#ffffff', 1)).toBe('#000000');
    expect(lighten('#808080', 0)).toBe('#808080');
    expect(() => darken('red', 0.1)).toThrow(/invalid colour/);
  });
});
