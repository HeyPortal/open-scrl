import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Asset, AssetMeta } from '@/types';
import { id } from '@/lib/nano';
import { completeTransaction } from '@/storage/transaction';
import type { AssetRepository, PreparedAsset, ProjectAssetScope } from '../AssetRepository';
import { deleteOpfsBlob, readOpfsBlob, writeOpfsBlob } from '../opfs/blobStorage';

interface ProjectAssetLink {
  id: string;
  projectId: string;
  assetId: string;
  addedAt: number;
}

interface AssetDb extends DBSchema {
  assets: { key: string; value: Asset };
  metadata: { key: string; value: AssetMeta; indexes: { hash: string } };
  blobs: { key: string; value: Blob };
  thumbnails: { key: string; value: Blob };
  projectAssets: {
    key: string;
    value: ProjectAssetLink;
    indexes: { projectId: string; assetId: string };
  };
  settings: { key: string; value: boolean };
}

const PROJECT_SCOPE_MIGRATION = 'project-scopes-v1';
const LEGACY_INDEX_MIGRATION = 'legacy-index-v1';
const linkId = (projectId: string, assetId: string) => `${projectId}:${assetId}`;

let dbPromise: Promise<IDBPDatabase<AssetDb>> | null = null;
function getAssetDatabase() {
  return dbPromise ??= openDB<AssetDb>('open-scrl-assets', 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
      if (!db.objectStoreNames.contains('metadata')) {
        const metadata = db.createObjectStore('metadata');
        metadata.createIndex('hash', 'hash', { unique: true });
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails');
      if (!db.objectStoreNames.contains('projectAssets')) {
        const links = db.createObjectStore('projectAssets');
        links.createIndex('projectId', 'projectId');
        links.createIndex('assetId', 'assetId');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    },
  }).catch((error) => { dbPromise = null; throw error; });
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class IndexedDbAssetRepository implements AssetRepository {
  private legacyIndexPromise: Promise<void> | null = null;

  private async buildLegacyIndex(): Promise<void> {
    const db = await getAssetDatabase();
    if (await db.get('settings', LEGACY_INDEX_MIGRATION)) return;
    // Read only the small key list up front, then migrate one original at a
    // time. Loading the entire legacy store here can exhaust browser memory
    // for projects with a large photo or video library.
    const legacyAssetIds = await db.getAllKeys('assets');
    for (const assetId of legacyAssetIds) {
      const asset = await db.get('assets', assetId);
      if (!asset) continue;
      if (!(await db.get('metadata', asset.id))) {
        const hash = asset.hash ?? await sha256(asset.blob);
        const meta: AssetMeta = { id: asset.id, blobKey: `legacy:${asset.id}`, thumbnailKey: `thumb:${asset.id}`, hash, name: asset.name, mime: asset.mime, width: asset.width, height: asset.height, size: asset.size ?? asset.blob.size, mediaKind: asset.mediaKind, duration: asset.duration };
        const tx = db.transaction(['assets', 'metadata'], 'readwrite');
        await completeTransaction(tx, async () => {
          if (await tx.objectStore('assets').count(asset.id) && !(await tx.objectStore('metadata').get(asset.id))) {
            await tx.objectStore('metadata').put(meta, meta.id);
          }
        });
      }
    }
    await db.put('settings', true, LEGACY_INDEX_MIGRATION);
  }

  private async indexLegacy(): Promise<void> {
    // Every caller must wait for the same migration. Marking migration as
    // complete before its asynchronous work finishes lets concurrent reads
    // observe an empty or partially populated media library.
    if (!this.legacyIndexPromise) {
      this.legacyIndexPromise = this.buildLegacyIndex().catch((error) => {
        this.legacyIndexPromise = null;
        throw error;
      });
    }
    await this.legacyIndexPromise;
  }

  async listMetadata(projectId?: string) {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    if (!projectId) return db.getAll('metadata');
    const links = await db.getAllFromIndex('projectAssets', 'projectId', projectId);
    const metadata = await Promise.all(links.map((link) => db.get('metadata', link.assetId)));
    return metadata.filter((meta): meta is AssetMeta => Boolean(meta));
  }
  async readMetadata(assetId: string) { await this.indexLegacy(); return (await getAssetDatabase()).get('metadata', assetId); }
  async findByHash(hash: string) { await this.indexLegacy(); return (await getAssetDatabase()).getFromIndex('metadata', 'hash', hash); }

  async isLinkedToProject(projectId: string, assetId: string) {
    return Boolean(await (await getAssetDatabase()).get('projectAssets', linkId(projectId, assetId)));
  }

  async linkToProject(projectId: string, assetId: string) {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    const tx = db.transaction(['metadata', 'projectAssets'], 'readwrite');
    await completeTransaction(tx, async () => {
      if (!(await tx.objectStore('metadata').get(assetId))) return;
      const link: ProjectAssetLink = { id: linkId(projectId, assetId), projectId, assetId, addedAt: Date.now() };
      await tx.objectStore('projectAssets').put(link, link.id);
    });
  }

  async needsProjectScopeMigration() {
    return !(await (await getAssetDatabase()).get('settings', PROJECT_SCOPE_MIGRATION));
  }

  async migrateProjectScopes(scopes: ProjectAssetScope[], fallbackProjectId?: string) {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    const tx = db.transaction(['metadata', 'projectAssets', 'settings'], 'readwrite');
    await completeTransaction(tx, async () => {
      if (await tx.objectStore('settings').get(PROJECT_SCOPE_MIGRATION)) return;
      const metadata = await tx.objectStore('metadata').getAll();
      if (metadata.length > 0 && scopes.length === 0 && !fallbackProjectId) return;

      const knownAssets = new Set(metadata.map((meta) => meta.id));
      const linkedAssets = new Set<string>();
      for (const scope of scopes) {
        for (const assetId of new Set(scope.assetIds)) {
          if (!knownAssets.has(assetId)) continue;
          const link: ProjectAssetLink = { id: linkId(scope.projectId, assetId), projectId: scope.projectId, assetId, addedAt: Date.now() };
          await tx.objectStore('projectAssets').put(link, link.id);
          linkedAssets.add(assetId);
        }
      }

      // Old versions had one shared library and did not record where unused
      // imports originated. Preserve those files in the most recently edited
      // project instead of copying them into every project forever.
      if (fallbackProjectId) {
        for (const meta of metadata) {
          if (linkedAssets.has(meta.id)) continue;
          const link: ProjectAssetLink = { id: linkId(fallbackProjectId, meta.id), projectId: fallbackProjectId, assetId: meta.id, addedAt: Date.now() };
          await tx.objectStore('projectAssets').put(link, link.id);
        }
      }
      await tx.objectStore('settings').put(true, PROJECT_SCOPE_MIGRATION);
    });
  }

  async readOriginal(assetId: string): Promise<Blob | undefined> {
    await this.indexLegacy();
    const db = await getAssetDatabase(); const meta = await this.readMetadata(assetId); if (!meta) return undefined;
    if (meta.blobKey.startsWith('legacy:')) {
      // Reads must not rewrite metadata: a concurrent deletion could otherwise
      // be undone by a delayed legacy-to-OPFS copy.
      return (await db.get('assets', assetId))?.blob;
    }
    // A failed OPFS write can leave an empty file behind. A stored fallback
    // is authoritative whenever one exists.
    return (await db.get('blobs', meta.blobKey)) ?? await readOpfsBlob(meta.blobKey);
  }

  async readThumbnail(assetId: string) {
    await this.indexLegacy(); const db = await getAssetDatabase(); const meta = await this.readMetadata(assetId);
    if (!meta) return undefined;
    return (await db.get('thumbnails', meta.thumbnailKey)) ?? await readOpfsBlob(meta.thumbnailKey);
  }

  async writeThumbnail(assetId: string, thumbnail: Blob) {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    if (!(await db.get('metadata', assetId))) return;
    const thumbnailKey = `thumb-${id()}`;
    const inOpfs = await writeOpfsBlob(thumbnailKey, thumbnail);
    let previousKey: string | undefined;
    let committed = false;
    try {
      const tx = db.transaction(['metadata', 'thumbnails'], 'readwrite');
      await completeTransaction(tx, async () => {
        const meta = await tx.objectStore('metadata').get(assetId);
        if (!meta) return;
        previousKey = meta.thumbnailKey;
        if (!inOpfs) await tx.objectStore('thumbnails').put(thumbnail, thumbnailKey);
        await tx.objectStore('metadata').put({ ...meta, thumbnailKey }, assetId);
        await tx.objectStore('thumbnails').delete(previousKey);
      });
      committed = previousKey !== undefined;
    } finally {
      if (!committed) await deleteOpfsBlob(thumbnailKey);
    }
    if (previousKey) await deleteOpfsBlob(previousKey);
  }

  async commit(prepared: PreparedAsset, projectId: string): Promise<AssetMeta> {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    // Fast path still checks and links inside one transaction.
    const existingTx = db.transaction(['metadata', 'projectAssets'], 'readwrite');
    let existing: AssetMeta | undefined;
    await completeTransaction(existingTx, async () => {
      existing = await existingTx.objectStore('metadata').index('hash').get(prepared.hash);
      if (existing) {
        const link = { id: linkId(projectId, existing.id), projectId, assetId: existing.id, addedAt: Date.now() };
        await existingTx.objectStore('projectAssets').put(link, link.id);
      }
    });
    if (existing) return existing;

    // Each attempt owns its files. Losing a deduplication race or deleting an
    // older asset can never delete another attempt's originals.
    const assetId = id();
    const blobKey = `asset-${assetId}`;
    const thumbnailKey = `thumb-${assetId}`;
    let retained = false;
    try {
      const originalInOpfs = await writeOpfsBlob(blobKey, prepared.file);
      const thumbInOpfs = await writeOpfsBlob(thumbnailKey, prepared.thumbnail);
      const meta: AssetMeta = { id: assetId, blobKey, thumbnailKey, hash: prepared.hash, name: prepared.name, mime: prepared.mime, width: prepared.width, height: prepared.height, size: prepared.file.size, mediaKind: prepared.mediaKind, duration: prepared.duration };
      const tx = db.transaction(['metadata', 'blobs', 'thumbnails', 'projectAssets'], 'readwrite');
      let result = meta;
      await completeTransaction(tx, async () => {
        const duplicate = await tx.objectStore('metadata').index('hash').get(prepared.hash);
        if (duplicate) result = duplicate;
        else {
          await tx.objectStore('metadata').put(meta, assetId);
          if (!originalInOpfs) await tx.objectStore('blobs').put(prepared.file, blobKey);
          if (!thumbInOpfs) await tx.objectStore('thumbnails').put(prepared.thumbnail, thumbnailKey);
        }
        const link = { id: linkId(projectId, result.id), projectId, assetId: result.id, addedAt: Date.now() };
        await tx.objectStore('projectAssets').put(link, link.id);
      });
      retained = result.id === assetId;
      return result;
    } finally {
      if (!retained) await Promise.all([deleteOpfsBlob(blobKey), deleteOpfsBlob(thumbnailKey)]);
    }
  }

  async remove(assetId: string, projectId: string): Promise<boolean> {
    await this.indexLegacy();
    const db = await getAssetDatabase();
    const tx = db.transaction(['projectAssets', 'metadata', 'blobs', 'thumbnails', 'assets'], 'readwrite');
    let removed: AssetMeta | undefined;
    await completeTransaction(tx, async () => {
      const links = tx.objectStore('projectAssets');
      // A stale caller that no longer owns a link must not delete an asset.
      if (!(await links.get(linkId(projectId, assetId)))) return;
      await links.delete(linkId(projectId, assetId));
      if (await links.index('assetId').count(assetId)) return;
      removed = await tx.objectStore('metadata').get(assetId);
      if (!removed) return;
      await tx.objectStore('metadata').delete(assetId);
      await tx.objectStore('blobs').delete(removed.blobKey);
      await tx.objectStore('thumbnails').delete(removed.thumbnailKey);
      await tx.objectStore('assets').delete(assetId);
    });
    if (!removed) return false;
    await Promise.all([deleteOpfsBlob(removed.blobKey), deleteOpfsBlob(removed.thumbnailKey)]);
    return true;
  }

}

export const assetRepository = new IndexedDbAssetRepository();
