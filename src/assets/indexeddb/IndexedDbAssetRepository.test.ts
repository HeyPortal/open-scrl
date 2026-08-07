import { openDB } from 'idb';
import { afterAll, describe, expect, it, vi } from 'vitest';

const DATABASE_NAME = 'open-scrl-assets';

describe('IndexedDbAssetRepository legacy migration', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('indexes originals one at a time and isolates their project associations', async () => {
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
    await legacyDb.put('assets', {
      id: 'unused-photo',
      name: 'unused.jpg',
      mime: 'image/jpeg',
      width: 2000,
      height: 1500,
      blob: new Blob(['unused-photo']),
      size: 12,
      hash: 'unused-photo-hash',
    }, 'unused-photo');
    legacyDb.close();

    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const { IndexedDbAssetRepository } = await import('./IndexedDbAssetRepository');
    const repository = new IndexedDbAssetRepository();
    const results = await Promise.all([
      repository.listMetadata(),
      repository.listMetadata(),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy-photo', hash: 'legacy-photo-hash' }),
      expect.objectContaining({ id: 'unused-photo', hash: 'unused-photo-hash' }),
    ]));
    expect(getAll.mock.contexts.map((store) => (store as IDBObjectStore).name)).not.toContain('assets');

    await repository.migrateProjectScopes([
      { projectId: 'project-a', assetIds: ['legacy-photo'] },
      { projectId: 'project-b', assetIds: [] },
    ], 'project-a');
    expect(await repository.needsProjectScopeMigration()).toBe(false);
    expect(await repository.listMetadata('project-a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy-photo' }),
      expect.objectContaining({ id: 'unused-photo' }),
    ]));
    expect(await repository.listMetadata('project-b')).toEqual([]);

    await repository.linkToProject('project-b', 'legacy-photo');
    expect(await repository.listMetadata('project-b')).toEqual([
      expect.objectContaining({ id: 'legacy-photo' }),
    ]);

    const thumbnail = new Blob(['small-thumbnail'], { type: 'image/jpeg' });
    await repository.writeThumbnail('legacy-photo', thumbnail);
    expect(await repository.readThumbnail('legacy-photo')).toBeDefined();

    await repository.remove('legacy-photo', 'project-a');
    expect(await repository.readMetadata('legacy-photo')).toBeDefined();
    await repository.remove('legacy-photo', 'project-b');
    expect(await repository.readMetadata('legacy-photo')).toBeUndefined();
  });
});
