/** Robber jingle synthesised with Web Audio (no external assets). */
let ctx: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (ctx !== null) return ctx;
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== 'function') return null;
  ctx = new Ctor();
  return ctx;
};

const tone = (ac: AudioContext, freq: number, start: number, dur: number, gain: number): void => {
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const g = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.94, start + dur);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(filter).connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
};

/** Returns an error message instead of throwing: sound is non-essential. */
export const playRobber = async (): Promise<string | null> => {
  try {
    const ac = audio();
    if (ac === null) return 'このブラウザは Web Audio に対応していません';
    if (ac.state === 'suspended') await ac.resume();
    const t = ac.currentTime + 0.01;
    tone(ac, 196, t, 0.22, 0.22);
    tone(ac, 147, t + 0.24, 0.22, 0.22);
    tone(ac, 98, t + 0.48, 0.6, 0.28);
    return null;
  } catch (e) {
    return `効果音を再生できませんでした: ${e instanceof Error ? e.message : String(e)}`;
  }
};
