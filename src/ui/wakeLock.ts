export type WakeStatus =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'active' }
  | { readonly kind: 'released' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Keeps the screen awake while the page is visible.
 * Re-acquires the lock whenever the page becomes visible again (the browser releases it on hide).
 */
export const startWakeLock = (onChange: (s: WakeStatus) => void): void => {
  const wl = navigator.wakeLock;
  if (wl === undefined) {
    onChange({ kind: 'unsupported' });
    return;
  }
  let sentinel: WakeLockSentinel | null = null;

  const acquire = async (): Promise<void> => {
    if (document.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released)) return;
    try {
      sentinel = await wl.request('screen');
      onChange({ kind: 'active' });
      sentinel.addEventListener('release', () => onChange({ kind: 'released' }));
    } catch (e) {
      onChange({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  document.addEventListener('visibilitychange', () => void acquire());
  // some browsers require a user gesture: retry on the first interaction as well
  const retry = (): void => void acquire();
  document.addEventListener('pointerdown', retry);
  document.addEventListener('keydown', retry);
  void acquire();
};
