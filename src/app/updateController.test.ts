import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateController, type UpdateSnapshot } from './updateController';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(initial: Partial<UpdateSnapshot> = {}) {
  let snapshot: UpdateSnapshot = { ready: true, busy: false, version: 'project:1', saveError: null, ...initial };
  let changed: (() => void) | undefined;
  const flush = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const activate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const reload = vi.fn();
  const controller = new UpdateController({ snapshot: () => snapshot, subscribe: (listener) => { changed = listener; return () => { changed = undefined; }; }, flush, activate, reload });
  const stop = controller.start();
  return { controller, flush, activate, reload, stop, change: (next: Partial<UpdateSnapshot>) => { snapshot = { ...snapshot, ...next }; changed?.(); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const settle = () => vi.runAllTimersAsync();

describe('application update guard', () => {
  it('waits for startup and whole import/export jobs before saving or offering reload', async () => {
    const h = harness({ ready: false, busy: true });
    h.controller.notifyUpdate();
    await settle();
    expect(h.flush).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().status).toBe('waiting');
    h.change({ ready: true });
    await settle();
    expect(h.flush).not.toHaveBeenCalled();
    h.change({ busy: false });
    await settle();
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().status).toBe('ready');
    expect(h.activate).not.toHaveBeenCalled();
  });

  it('saves a newer revision that arrives during a slow save before offering reload', async () => {
    const h = harness();
    const save = deferred();
    h.flush.mockReturnValueOnce(save.promise);
    h.controller.notifyUpdate();
    await settle();
    expect(h.controller.getSnapshot().status).toBe('waiting');
    h.change({ version: 'project:2' });
    save.resolve();
    await settle();
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(h.controller.getSnapshot().status).toBe('ready');
  });

  it('includes commands placed by an import caller in a later microtask', async () => {
    const h = harness({ busy: true });
    h.controller.notifyUpdate();
    h.change({ busy: false });
    await Promise.resolve();
    h.change({ version: 'project:2' });
    await settle();
    expect(h.flush).toHaveBeenCalledTimes(2);
    expect(h.controller.getSnapshot().status).toBe('ready');
  });

  it('withdraws readiness for a new job and checks again on the reload click', async () => {
    const h = harness();
    h.controller.notifyUpdate();
    await settle();
    h.change({ busy: true });
    expect(h.controller.getSnapshot().status).toBe('waiting');
    h.controller.requestUpdate();
    await settle();
    expect(h.activate).not.toHaveBeenCalled();
    h.change({ busy: false, version: 'project:2' });
    await settle();
    expect(h.activate).toHaveBeenCalledOnce();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().status).toBe('updating');
  });

  it('waits for jobs and latest edits after activation, then reloads only once', async () => {
    const h = harness();
    h.controller.notifyUpdate();
    await settle();
    h.controller.requestUpdate();
    await settle();
    h.change({ busy: true, version: 'project:2' });
    h.controller.notifyActivated();
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).not.toHaveBeenCalled();
    h.change({ busy: false });
    await settle();
    expect(h.reload).toHaveBeenCalledOnce();
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('keeps a failed save open and resumes after the existing save retry succeeds', async () => {
    const h = harness();
    h.flush.mockImplementationOnce(async () => {
      h.change({ saveError: 'Disk full' });
      throw new Error('Disk full');
    });
    h.controller.notifyUpdate();
    await settle();
    expect(h.controller.getSnapshot().status).toBe('error');
    h.controller.requestUpdate();
    await settle();
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
    h.change({ saveError: null });
    await settle();
    expect(h.activate).toHaveBeenCalledOnce();
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('offers a saved reload after another tab activates without accepting for the user', async () => {
    const h = harness({ busy: true });
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).not.toHaveBeenCalled();
    h.change({ busy: false });
    await settle();
    expect(h.controller.getSnapshot().status).toBe('ready');
    expect(h.reload).not.toHaveBeenCalled();
    h.controller.requestUpdate();
    await settle();
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('keeps a dismissed prompt inactive across edits and background work', async () => {
    const h = harness();
    h.controller.notifyUpdate();
    await settle();
    h.controller.dismiss();
    h.change({ version: 'project:2', busy: true });
    h.change({ busy: false });
    h.controller.notifyActivated();
    await settle();
    expect(h.controller.getSnapshot().status).toBe('idle');
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('activates a newer waiting version after an earlier external activation was deferred', async () => {
    const h = harness();
    h.controller.notifyActivated();
    await settle();
    h.controller.notifyUpdate();
    await settle();
    h.controller.requestUpdate();
    await settle();
    expect(h.activate).toHaveBeenCalledOnce();
    expect(h.reload).not.toHaveBeenCalled();
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('retries activation failures without losing the document', async () => {
    const h = harness();
    h.activate.mockRejectedValueOnce(new Error('Unavailable worker'));
    h.controller.notifyUpdate();
    await settle();
    h.controller.requestUpdate();
    await settle();
    expect(h.controller.getSnapshot().status).toBe('error');
    expect(h.reload).not.toHaveBeenCalled();
    h.controller.requestUpdate();
    await settle();
    expect(h.activate).toHaveBeenCalledTimes(2);
    h.controller.notifyActivated();
    await settle();
    expect(h.reload).toHaveBeenCalledOnce();
  });

  it('ignores a slow save that completes after disposal', async () => {
    const h = harness();
    const save = deferred();
    h.flush.mockReturnValue(save.promise);
    h.controller.notifyActivated();
    h.controller.requestUpdate();
    h.stop();
    save.resolve();
    await settle();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.activate).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().status).not.toBe('ready');
  });
});
