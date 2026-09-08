import { Blob as NodeBlob } from 'node:buffer';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import type { PreparedAsset } from '../AssetRepository';
import { IndexedDbAssetRepository } from './IndexedDbAssetRepository';

const opfs = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock('../opfs/blobStorage', () => ({ writeOpfsBlob: opfs.write, readOpfsBlob: opfs.read, deleteOpfsBlob: opfs.remove }));
const files = new Map<string, Blob>();
const prepared = (hash: string): PreparedAsset => ({ file: new Blob(['original']), thumbnail: new Blob(['thumb']), hash, width: 10, height: 10, name: 'photo', mime: 'image/png' });

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  files.clear();
  opfs.write.mockReset().mockImplementation(async (key: string, blob: Blob) => { files.set(key, blob); return true; });
  opfs.read.mockReset().mockImplementation(async (key: string) => files.get(key));
  opfs.remove.mockReset().mockImplementation(async (key: string) => { files.delete(key); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('atomic asset mutations', () => {
  it('deduplicates simultaneous commits from separate repositories and cleans losing files', async () => {
    const a = new IndexedDbAssetRepository();
    const b = new IndexedDbAssetRepository();
    const bothWriting = deferred();
    let originals = 0;
    opfs.write.mockImplementation(async (key: string, blob: Blob) => {
      files.set(key, blob);
      if (key.startsWith('asset-')) {
        if (++originals === 2) bothWriting.resolve();
        await bothWriting.promise;
      }
      return true;
    });
    const input = prepared('concurrent-commit');
    const [first, second] = await Promise.all([a.commit(input, 'a'), b.commit(input, 'b')]);
    expect(first.id).toBe(second.id);
    expect(await a.isLinkedToProject('a', first.id)).toBe(true);
    expect(await b.isLinkedToProject('b', first.id)).toBe(true);
    expect([...files.keys()].sort()).toEqual([first.blobKey, first.thumbnailKey].sort());
    expect(await a.remove(first.id, 'a')).toBe(false);
    expect((await b.readOriginal(first.id))?.size).toBe(input.file.size);
  });

  it('late cleanup of a deleted asset cannot remove a reimport with the same hash', async () => {
    const a = new IndexedDbAssetRepository();
    const b = new IndexedDbAssetRepository();
    const input = prepared('reimport');
    const old = await a.commit(input, 'a');
    const deleting = deferred();
    const resume = deferred();
    opfs.remove.mockImplementation(async (key: string) => {
      if (key === old.blobKey) { deleting.resolve(); await resume.promise; }
      files.delete(key);
    });
    const removal = a.remove(old.id, 'a');
    await deleting.promise;
    const fresh = await b.commit(input, 'b');
    resume.resolve();
    expect(await removal).toBe(true);
    expect(fresh.id).not.toBe(old.id);
    expect((await b.readOriginal(fresh.id))?.size).toBe(input.file.size);
    expect(files.has(fresh.thumbnailKey)).toBe(true);
  });

  it('linking and last-reference deletion cannot leave dangling project links', async () => {
    const a = new IndexedDbAssetRepository();
    const b = new IndexedDbAssetRepository();
    for (const linkFirst of [true, false]) {
      const asset = await a.commit(prepared(`link-race-${linkFirst}`), 'a');
      if (linkFirst) await Promise.all([b.linkToProject('b', asset.id), a.remove(asset.id, 'a')]);
      else await Promise.all([a.remove(asset.id, 'a'), b.linkToProject('b', asset.id)]);
      const meta = await b.readMetadata(asset.id);
      expect(await b.isLinkedToProject('b', asset.id)).toBe(Boolean(meta));
      if (meta) expect(await b.readOriginal(asset.id)).toBeDefined();
    }
  });

  it('a thumbnail finishing after deletion neither resurrects metadata nor leaks its staged file', async () => {
    const a = new IndexedDbAssetRepository();
    const b = new IndexedDbAssetRepository();
    const asset = await a.commit(prepared('thumbnail-race'), 'a');
    const writing = deferred();
    const resume = deferred();
    opfs.write.mockImplementation(async (key: string, blob: Blob) => {
      files.set(key, blob); writing.resolve(); await resume.promise; return true;
    });
    const update = a.writeThumbnail(asset.id, new Blob(['new thumbnail']));
    await writing.promise;
    await b.remove(asset.id, 'a');
    resume.resolve();
    await update;
    expect(await a.readMetadata(asset.id)).toBeUndefined();
    expect(files.size).toBe(0);
  });

  it('aborts partial database writes and cleans staged files after a synchronous write failure', async () => {
    const repository = new IndexedDbAssetRepository();
    await repository.listMetadata();
    opfs.write.mockImplementation(async (key: string, blob: Blob) => { files.set(key, blob); return false; });
    const db = await openDB('open-scrl-assets');
    const linksBefore = await db.getAllFromIndex('projectAssets', 'projectId', 'a');
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'blobs') throw new DOMException('Cannot clone', 'DataCloneError');
      return original.apply(this, args);
    });
    await expect(repository.commit(prepared('rollback'), 'a')).rejects.toThrow('Cannot clone');
    expect(await repository.findByHash('rollback')).toBeUndefined();
    expect(files.size).toBe(0);
    expect(await db.getAllFromIndex('projectAssets', 'projectId', 'a')).toEqual(linksBefore);
    db.close();
  });
});
