import { openDB, type DBSchema } from 'idb';
import type { Asset, AssetMeta } from '@/types';
import { id } from '@/lib/nano';
import type { AssetRepository, PreparedAsset } from '../AssetRepository';
import { deleteOpfsBlob, readOpfsBlob, writeOpfsBlob } from '../opfs/blobStorage';

interface AssetDb extends DBSchema {
  assets: { key: string; value: Asset };
  metadata: { key: string; value: AssetMeta; indexes: { hash: string } };
  blobs: { key: string; value: Blob };
  thumbnails: { key: string; value: Blob };
}

const dbPromise = openDB<AssetDb>('open-scrl-assets', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    if (!db.objectStoreNames.contains('metadata')) {
      const metadata = db.createObjectStore('metadata');
      metadata.createIndex('hash', 'hash', { unique: true });
    }
    if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails');
  },
});

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class IndexedDbAssetRepository implements AssetRepository {
  private migrated = false;

  private async indexLegacy(): Promise<void> {
    if (this.migrated) return;
    this.migrated = true;
    const db = await dbPromise;
    let cursor = await db.transaction('assets').store.openCursor();
    while (cursor) {
      const asset = cursor.value;
      if (!(await db.get('metadata', asset.id))) {
        const hash = asset.hash ?? await sha256(asset.blob);
        const meta: AssetMeta = { id: asset.id, blobKey: `legacy:${asset.id}`, thumbnailKey: `thumb:${asset.id}`, hash, name: asset.name, mime: asset.mime, width: asset.width, height: asset.height, size: asset.size ?? asset.blob.size };
        await db.put('metadata', meta, meta.id);
      }
      cursor = await cursor.continue();
    }
  }

  async listMetadata() { await this.indexLegacy(); return (await dbPromise).getAll('metadata'); }
  async findByHash(hash: string) { await this.indexLegacy(); return (await dbPromise).getFromIndex('metadata', 'hash', hash); }

  async readOriginal(assetId: string): Promise<Blob | undefined> {
    await this.indexLegacy();
    const db = await dbPromise; const meta = await db.get('metadata', assetId); if (!meta) return undefined;
    if (meta.blobKey.startsWith('legacy:')) {
      const legacy = await db.get('assets', assetId); if (!legacy) return undefined;
      const opfsKey = `asset-${meta.hash}`;
      if (await writeOpfsBlob(opfsKey, legacy.blob)) {
        await db.put('metadata', { ...meta, blobKey: opfsKey }, assetId);
      }
      return legacy.blob;
    }
    return (await readOpfsBlob(meta.blobKey)) ?? await db.get('blobs', meta.blobKey);
  }

  async readThumbnail(assetId: string) {
    await this.indexLegacy(); const db = await dbPromise; const meta = await db.get('metadata', assetId);
    if (!meta) return undefined;
    return (await readOpfsBlob(meta.thumbnailKey)) ?? await db.get('thumbnails', meta.thumbnailKey);
  }

  async commit(prepared: PreparedAsset): Promise<AssetMeta> {
    const duplicate = await this.findByHash(prepared.hash); if (duplicate) return duplicate;
    const assetId = id(); const blobKey = `asset-${prepared.hash}`; const thumbnailKey = `thumb-${prepared.hash}`;
    const originalInOpfs = await writeOpfsBlob(blobKey, prepared.file);
    const thumbInOpfs = await writeOpfsBlob(thumbnailKey, prepared.thumbnail);
    const meta: AssetMeta = { id: assetId, blobKey, thumbnailKey, hash: prepared.hash, name: prepared.name, mime: prepared.mime, width: prepared.width, height: prepared.height, size: prepared.file.size };
    const db = await dbPromise; const tx = db.transaction(['metadata', 'blobs', 'thumbnails'], 'readwrite');
    await tx.objectStore('metadata').put(meta, assetId);
    if (!originalInOpfs) await tx.objectStore('blobs').put(prepared.file, blobKey);
    if (!thumbInOpfs) await tx.objectStore('thumbnails').put(prepared.thumbnail, thumbnailKey);
    await tx.done; return meta;
  }

  async remove(assetId: string): Promise<void> {
    const db = await dbPromise; const meta = await db.get('metadata', assetId); if (!meta) return;
    const tx = db.transaction(['metadata', 'blobs', 'thumbnails', 'assets'], 'readwrite');
    await Promise.all([tx.objectStore('metadata').delete(assetId), tx.objectStore('blobs').delete(meta.blobKey), tx.objectStore('thumbnails').delete(meta.thumbnailKey), tx.objectStore('assets').delete(assetId), tx.done]);
    await Promise.all([deleteOpfsBlob(meta.blobKey), deleteOpfsBlob(meta.thumbnailKey)]);
  }
}

export const assetRepository = new IndexedDbAssetRepository();
