import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelMobileHaptics, createSnapFeedback, mobileHaptic, startMobileHaptics, useHapticPreference } from './mobileHaptics';

const engine = vi.hoisted(() => ({ trigger: vi.fn(), cancel: vi.fn(), destroy: vi.fn(), construct: vi.fn() }));
vi.mock('web-haptics', () => ({
  WebHaptics: class {
    constructor(options: unknown) { engine.construct(options); }
    trigger = engine.trigger;
    cancel = engine.cancel;
    destroy = engine.destroy;
  },
}));

let now = 0;
let stops: (() => void)[] = [];
const mount = () => { const stop = startMobileHaptics(); stops.push(stop); return stop; };
beforeEach(() => {
  vi.clearAllMocks();
  engine.trigger.mockResolvedValue(undefined);
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  useHapticPreference.getState().setEnabled(true);
});
afterEach(() => { stops.forEach((stop) => stop()); stops = []; vi.restoreAllMocks(); });

describe('mobile web haptics', () => {
  it('only runs while a mobile layout owns it, without debug audio or a visible switch', () => {
    mobileHaptic('confirm');
    expect(engine.trigger).not.toHaveBeenCalled();
    const stop = mount();
    mobileHaptic('confirm');
    expect(engine.construct).toHaveBeenCalledExactlyOnceWith({ debug: false, showSwitch: false });
    expect(engine.trigger).toHaveBeenCalledTimes(1);
    stop();
    mobileHaptic('delete');
    expect(engine.trigger).toHaveBeenCalledTimes(1);
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });

  it('lets confirmations replace a small tick and prevents incidental selection from replacing them', () => {
    mount();
    mobileHaptic('selection');
    mobileHaptic('selection');
    mobileHaptic('ready');
    mobileHaptic('confirm');
    mobileHaptic('selection');
    mobileHaptic('confirm');
    expect(engine.trigger).toHaveBeenCalledTimes(3);
    now = 60;
    mobileHaptic('selection');
    expect(engine.trigger).toHaveBeenCalledTimes(4);
  });

  it('gives each interaction a distinct short pattern and protects result sequences from ticks', () => {
    mount();
    for (const kind of ['selection', 'snap', 'ready', 'confirm', 'delete', 'history', 'success', 'error'] as const) {
      mobileHaptic(kind);
      now += 250;
    }
    const patterns = engine.trigger.mock.calls.map(([pattern]) => JSON.stringify(pattern));
    expect(new Set(patterns).size).toBe(8);
    now -= 220;
    mobileHaptic('selection');
    expect(engine.trigger).toHaveBeenCalledTimes(8);
  });

  it('ticks on new guides rather than every frame, and rearms after leaving', () => {
    mount();
    const snap = createSnapFeedback();
    snap.update(['v:500']);
    now += 100;
    snap.update(['v:500']);
    expect(engine.trigger).toHaveBeenCalledTimes(1);
    snap.update(['v:500', 'h:800']);
    expect(engine.trigger).toHaveBeenCalledTimes(2);
    now += 100;
    snap.update([]);
    snap.update(['v:500']);
    expect(engine.trigger).toHaveBeenCalledTimes(3);
    now += 100;
    snap.reset();
    snap.update(['v:500']);
    expect(engine.trigger).toHaveBeenCalledTimes(4);
  });

  it('starts a twist quietly at its existing rotation stop', () => {
    mount();
    const snap = createSnapFeedback();
    snap.reset(['rotation:0']);
    snap.update(['rotation:0']);
    expect(engine.trigger).not.toHaveBeenCalled();
    snap.update([]);
    snap.update(['rotation:45']);
    expect(engine.trigger).toHaveBeenCalledTimes(1);
  });

  it('saves an opt-out and immediately cancels active feedback', () => {
    mount();
    mobileHaptic('success');
    useHapticPreference.getState().setEnabled(false);
    expect(localStorage.getItem('open-scrl:haptics')).toBe('off');
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    mobileHaptic('delete');
    expect(engine.trigger).toHaveBeenCalledTimes(1);
    useHapticPreference.getState().setEnabled(true);
    mobileHaptic('selection');
    expect(localStorage.getItem('open-scrl:haptics')).toBe('on');
    expect(engine.trigger).toHaveBeenCalledTimes(2);
  });

  it('stops on blur or hidden pages and never starts feedback in the background', () => {
    mount();
    window.dispatchEvent(new Event('blur'));
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    mobileHaptic('success');
    expect(engine.cancel).toHaveBeenCalledTimes(2);
    expect(engine.trigger).not.toHaveBeenCalled();
  });

  it('shares one engine across owners and tears down once, including repeated cleanup', () => {
    const a = mount(), b = mount();
    a(); a();
    mobileHaptic('selection');
    expect(engine.construct).toHaveBeenCalledTimes(1);
    expect(engine.destroy).not.toHaveBeenCalled();
    b(); b();
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps editing safe when feedback or preference storage is blocked', async () => {
    mount();
    engine.trigger.mockRejectedValueOnce(new Error('Blocked'));
    mobileHaptic('confirm');
    await Promise.resolve();
    cancelMobileHaptics();
    engine.trigger.mockImplementationOnce(() => { throw new Error('Blocked'); });
    expect(() => mobileHaptic('confirm')).not.toThrow();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(() => useHapticPreference.getState().setEnabled(false)).not.toThrow();
    expect(useHapticPreference.getState().enabled).toBe(false);
  });
});
