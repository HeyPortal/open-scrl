import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbAssetRepository } from './IndexedDbAssetRepository';

// Simulate a file handle created successfully followed by an unsuccessful
// write: subsequent OPFS reads still see the empty file.
const opfs = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn() }));
vi.mock('../opfs/blobStorage', () => ({
  writeOpfsBlob: opfs.write,
  readOpfsBlob: opfs.read,
  deleteOpfsBlob: vi.fn(),
}));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('asset storage fallback', () => {
  it('reads committed IndexedDB blobs instead of files left by failed writes', async () => {
    // fake-indexeddb uses Node structuredClone, which cannot clone jsdom Blobs.
    vi.stubGlobal('Blob', NodeBlob);
    opfs.write.mockResolvedValue(false);
    opfs.read.mockResolvedValue(new Blob([]));
    const repository = new IndexedDbAssetRepository();
    const original = new Blob(['original photo']);
    const thumbnail = new Blob(['thumbnail']);
    const meta = await repository.commit({
      file: original, thumbnail, hash: 'fallback-photo', name: 'photo.png',
      mime: 'image/png', width: 10, height: 10, mediaKind: 'image', duration: 0,
    }, 'fallback-project');
    expect((await repository.readOriginal(meta.id))?.size).toBe(original.size);
    expect((await repository.readThumbnail(meta.id))?.size).toBe(thumbnail.size);
    expect(opfs.read).not.toHaveBeenCalled();

    const replacement = new Blob(['replacement thumbnail in OPFS']);
    opfs.write.mockResolvedValue(true);
    opfs.read.mockResolvedValue(replacement);
    await repository.writeThumbnail(meta.id, replacement);
    expect((await repository.readThumbnail(meta.id))?.size).toBe(replacement.size);
  });
});
