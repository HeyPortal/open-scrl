import { openDB } from 'idb';
import { afterAll, describe, expect, it, vi } from 'vitest';

const DATABASE_NAME = 'open-scrl-assets';

describe('IndexedDbAssetRepository legacy migration', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('indexes originals one at a time and coordinates concurrent readers', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Legacy asset database deletion was blocked.'));
    });

    const legacyDb = await openDB(DATABASE_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('assets');
      },
    });
    await legacyDb.put('assets', {
      id: 'legacy-photo',
      name: 'legacy.jpg',
      mime: 'image/jpeg',
      width: 4000,
      height: 3000,
      blob: new Blob(['legacy-photo']),
      size: 12,
      hash: 'legacy-photo-hash',
    }, 'legacy-photo');
    legacyDb.close();

    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const { IndexedDbAssetRepository } = await import('./IndexedDbAssetRepository');
    const repository = new IndexedDbAssetRepository();
    const results = await Promise.all([
      repository.listMetadata(),
      repository.listMetadata(),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual([
      expect.objectContaining({ id: 'legacy-photo', hash: 'legacy-photo-hash' }),
    ]);
    expect(getAll.mock.contexts.map((store) => (store as IDBObjectStore).name)).not.toContain('assets');
  });
});
