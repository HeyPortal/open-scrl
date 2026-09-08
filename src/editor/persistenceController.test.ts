import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { PersistenceController } from './persistenceController';

afterEach(() => vi.useRealTimers());

describe('autosave coordination', () => {
  it('all flush callers wait until edits during a slow save are persisted', async () => {
    const first = deferred();
    const second = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const controller = new PersistenceController(save);
    const initial = controller.flush();
    await Promise.resolve();
    controller.markDirty();
    const concurrent = controller.flush();
    expect(concurrent).toBe(initial);
    let finished = false;
    void initial.then(() => { finished = true; });
    first.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    second.resolve();
    await concurrent;
    expect(finished).toBe(true);
  });

  it('reports a debounced failure once and allows explicit retry', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(undefined);
    const report = vi.fn();
    const controller = new PersistenceController(save, 750, report);
    controller.markDirty();
    await vi.advanceTimersByTimeAsync(750);
    expect(report).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(save).toHaveBeenCalledOnce();
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not save after disposal or drain queued edits from a disposed controller', async () => {
    vi.useFakeTimers();
    const active = deferred();
    const save = vi.fn(() => active.promise);
    const controller = new PersistenceController(save);
    const work = controller.flush();
    await Promise.resolve();
    controller.markDirty();
    controller.dispose();
    active.resolve();
    await work;
    controller.markDirty();
    await controller.flush();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledOnce();
  });
});
