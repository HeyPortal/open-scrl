import { WebHaptics, type HapticInput } from 'web-haptics';
import { create } from 'zustand';

const PREFERENCE_KEY = 'open-scrl:haptics';
const feedback = {
  selection: { pattern: [{ duration: 12, intensity: .4 }], priority: 0 },
  snap: { pattern: [{ duration: 12, intensity: .75 }], priority: 0 },
  ready: { pattern: [{ duration: 22, intensity: .7 }], priority: 1 },
  confirm: { pattern: [{ duration: 26, intensity: .7 }], priority: 2 },
  delete: { pattern: [{ duration: 35, intensity: .85 }], priority: 2 },
  history: { pattern: [{ duration: 18, intensity: .55 }], priority: 2 },
  success: { pattern: [{ duration: 24, intensity: .5 }, { delay: 55, duration: 32, intensity: .8 }], priority: 3 },
  error: { pattern: [{ duration: 30, intensity: .8 }, { delay: 45, duration: 30, intensity: .8 }, { delay: 45, duration: 30, intensity: .8 }], priority: 3 },
} satisfies Record<string, { pattern: HapticInput; priority: number }>;
export type MobileFeedback = keyof typeof feedback;

function readPreference() {
  try { return localStorage.getItem(PREFERENCE_KEY) !== 'off'; } catch { return true; }
}

export const useHapticPreference = create<{ enabled: boolean; setEnabled(enabled: boolean): void }>((set) => ({
  enabled: readPreference(),
  setEnabled: (enabled) => {
    try { localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off'); } catch { /* Session preference still works. */ }
    set({ enabled });
  },
}));

let engine: WebHaptics | null = null;
let owners = 0;
let lastAt = -Infinity;
let lastPriority = -1;
let quietUntil = 0;

export function cancelMobileHaptics() {
  try { engine?.cancel(); } catch { /* Feedback must never interrupt editing. */ }
  lastAt = -Infinity;
  lastPriority = -1;
  quietUntil = 0;
}

/** Mounted only by mobile layouts. One engine owns the library's fallback switch and timers. */
export function startMobileHaptics() {
  owners += 1;
  if (owners === 1) {
    engine = new WebHaptics({ debug: false, showSwitch: false });
    window.addEventListener('blur', cancelMobileHaptics);
    document.addEventListener('visibilitychange', onVisibility);
  }
  const unsubscribe = useHapticPreference.subscribe((state, previous) => {
    if (!state.enabled && previous.enabled) cancelMobileHaptics();
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsubscribe();
    if (--owners !== 0) return;
    window.removeEventListener('blur', cancelMobileHaptics);
    document.removeEventListener('visibilitychange', onVisibility);
    cancelMobileHaptics();
    try { engine?.destroy(); } catch { /* Cleanup remains safe on restricted browsers. */ }
    engine = null;
  };
}

function onVisibility() { if (document.visibilityState === 'hidden') cancelMobileHaptics(); }

/** Small ticks are throttled; a confirmed action may supersede its preceding selection tick. */
export function mobileHaptic(kind: MobileFeedback) {
  if (!engine || !useHapticPreference.getState().enabled || document.visibilityState === 'hidden') return;
  const now = performance.now();
  const cue = feedback[kind];
  if ((now - lastAt < 55 || now < quietUntil) && cue.priority <= lastPriority) return;
  lastAt = now;
  lastPriority = cue.priority;
  quietUntil = now + (kind === 'success' ? 120 : kind === 'error' ? 190 : 55);
  try { void engine.trigger(cue.pattern).catch(() => undefined); } catch { /* Optional device feedback. */ }
}

/** One tick when entering a new alignment; holding a guide across many frames stays quiet. */
export function createSnapFeedback() {
  let previous = new Set<string>();
  return {
    update(keys: string[]) {
      const next = new Set(keys);
      if (keys.some((key) => !previous.has(key))) mobileHaptic('snap');
      previous = next;
    },
    reset(keys: string[] = []) { previous = new Set(keys); },
  };
}
