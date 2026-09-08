import { describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { getDatabase } from './database';
import { IndexedDbAssetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';

vi.mock('idb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb')>();
  return { ...actual, openDB: vi.fn(actual.openDB) };
});

describe('database connection recovery', () => {
  it('shares a pending project connection and retries after an asynchronous open failure', async () => {
    vi.mocked(openDB).mockRejectedValueOnce(new Error('Temporary open failure'));
    const pending = getDatabase();
    expect(getDatabase()).toBe(pending);
    await expect(pending).rejects.toThrow('Temporary open failure');
    const db = await getDatabase();
    expect(db.name).toBe('open-scrl');
  });

  it('retries both the asset connection and legacy-index initialization after failure', async () => {
    vi.mocked(openDB).mockRejectedValueOnce(new Error('Temporary asset open failure'));
    const repository = new IndexedDbAssetRepository();
    await expect(repository.listMetadata()).rejects.toThrow('Temporary asset open failure');
    await expect(repository.listMetadata()).resolves.toEqual([]);
  });
});
