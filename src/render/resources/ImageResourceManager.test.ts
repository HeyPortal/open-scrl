import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { ImageResourceManager } from './ImageResourceManager';

vi.mock('@/assets/indexeddb/IndexedDbAssetRepository', () => ({
  assetRepository: { readOriginal: async () => new Blob(['image']), readMetadata: async () => ({ width: 10, height: 10 }) },
}));
const bitmap = () => ({ width: 10, height: 10, close: vi.fn() }) as unknown as ImageBitmap;
const decode = vi.fn();
beforeEach(() => { decode.mockReset(); vi.stubGlobal('createImageBitmap', decode); });
afterEach(() => vi.unstubAllGlobals());

describe('image resource ownership', () => {
  it('shares decoding and keeps the remaining consumer alive under memory pressure', async () => {
    const image = bitmap();
    decode.mockResolvedValue(image);
    const manager = new ImageResourceManager(0);
    const [cancelled, visible] = await Promise.all([manager.acquire('photo', 512), manager.acquire('photo', 512)]);
    expect(decode).toHaveBeenCalledOnce();
    cancelled.release();
    cancelled.release();
    expect(image.close).not.toHaveBeenCalled();
    visible.release();
    expect(image.close).toHaveBeenCalledOnce();
    expect(manager.byteSize).toBe(0);
  });

  it('invalidates a pending decode without deleting a replacement decode', async () => {
    const old = deferred<ImageBitmap>();
    const replacement = deferred<ImageBitmap>();
    decode.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const manager = new ImageResourceManager(0);
    const pending = manager.acquire('photo', 512);
    const rejected = expect(pending).rejects.toThrow('removed');
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    manager.removeAsset('photo');
    const fresh = manager.acquire('photo', 512);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
    const staleBitmap = bitmap();
    old.resolve(staleBitmap);
    await rejected;
    expect(staleBitmap.close).toHaveBeenCalledOnce();
    const same = manager.acquire('photo', 512);
    const newBitmap = bitmap();
    replacement.resolve(newBitmap);
    const [a, b] = await Promise.all([fresh, same]);
    expect(decode).toHaveBeenCalledTimes(2);
    a.release();
    expect(newBitmap.close).not.toHaveBeenCalled();
    b.release();
    expect(newBitmap.close).toHaveBeenCalledOnce();
  });

  it('an old lease cannot release a new bitmap with the same asset ID', async () => {
    const old = bitmap();
    const next = bitmap();
    decode.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const manager = new ImageResourceManager(0);
    const lease = await manager.acquire('photo', 512);
    manager.removeAsset('photo');
    const fresh = await manager.acquire('photo', 512);
    lease.release();
    expect(next.close).not.toHaveBeenCalled();
    fresh.release();
    expect(next.close).toHaveBeenCalledOnce();
    expect(old.close).toHaveBeenCalledOnce();
  });
});
