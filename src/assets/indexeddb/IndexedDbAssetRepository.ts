import { openDB, type DBSchema } from 'idb';
import type { Asset, AssetMeta } from '@/types';
import { id } from '@/lib/nano';
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

const dbPromise = openDB<AssetDb>('open-scrl-assets', 3, {
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
});

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class IndexedDbAssetRepository implements AssetRepository {
  private legacyIndexPromise: Promise<void> | null = null;

  private async buildLegacyIndex(): Promise<void> {
    const db = await dbPromise;
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
        await db.put('metadata', meta, meta.id);
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
    const db = await dbPromise;
    if (!projectId) return db.getAll('metadata');
    const links = await db.getAllFromIndex('projectAssets', 'projectId', projectId);
    const metadata = await Promise.all(links.map((link) => db.get('metadata', link.assetId)));
    return metadata.filter((meta): meta is AssetMeta => Boolean(meta));
  }
  async readMetadata(assetId: string) { await this.indexLegacy(); return (await dbPromise).get('metadata', assetId); }
  async findByHash(hash: string) { await this.indexLegacy(); return (await dbPromise).getFromIndex('metadata', 'hash', hash); }

  async isLinkedToProject(projectId: string, assetId: string) {
    return Boolean(await (await dbPromise).get('projectAssets', linkId(projectId, assetId)));
  }

  async linkToProject(projectId: string, assetId: string) {
    const db = await dbPromise;
    if (!(await this.readMetadata(assetId))) return;
    const link: ProjectAssetLink = { id: linkId(projectId, assetId), projectId, assetId, addedAt: Date.now() };
    await db.put('projectAssets', link, link.id);
  }

  async needsProjectScopeMigration() {
    return !(await (await dbPromise).get('settings', PROJECT_SCOPE_MIGRATION));
  }

  async migrateProjectScopes(scopes: ProjectAssetScope[], fallbackProjectId?: string) {
    await this.indexLegacy();
    const db = await dbPromise;
    if (await db.get('settings', PROJECT_SCOPE_MIGRATION)) return;
    const metadata = await db.getAll('metadata');
    if (metadata.length > 0 && scopes.length === 0 && !fallbackProjectId) return;

    const knownAssets = new Set(metadata.map((meta) => meta.id));
    const linkedAssets = new Set<string>();
    const tx = db.transaction(['projectAssets', 'settings'], 'readwrite');
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
    await tx.done;
  }

  async readOriginal(assetId: string): Promise<Blob | undefined> {
    await this.indexLegacy();
    const db = await dbPromise; const meta = await this.readMetadata(assetId); if (!meta) return undefined;
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
    await this.indexLegacy(); const db = await dbPromise; const meta = await this.readMetadata(assetId);
    if (!meta) return undefined;
    return (await readOpfsBlob(meta.thumbnailKey)) ?? await db.get('thumbnails', meta.thumbnailKey);
  }

  async writeThumbnail(assetId: string, thumbnail: Blob) {
    await this.indexLegacy();
    const db = await dbPromise;
    const meta = await db.get('metadata', assetId);
    if (!meta) return;
    if (!(await writeOpfsBlob(meta.thumbnailKey, thumbnail))) {
      await db.put('thumbnails', thumbnail, meta.thumbnailKey);
    }
  }

  async commit(prepared: PreparedAsset, projectId: string): Promise<AssetMeta> {
    const duplicate = await this.findByHash(prepared.hash);
    if (duplicate) { await this.linkToProject(projectId, duplicate.id); return duplicate; }
    const assetId = id(); const blobKey = `asset-${prepared.hash}`; const thumbnailKey = `thumb-${prepared.hash}`;
    const originalInOpfs = await writeOpfsBlob(blobKey, prepared.file);
    const thumbInOpfs = await writeOpfsBlob(thumbnailKey, prepared.thumbnail);
    const meta: AssetMeta = { id: assetId, blobKey, thumbnailKey, hash: prepared.hash, name: prepared.name, mime: prepared.mime, width: prepared.width, height: prepared.height, size: prepared.file.size, mediaKind: prepared.mediaKind, duration: prepared.duration };
    const link: ProjectAssetLink = { id: linkId(projectId, assetId), projectId, assetId, addedAt: Date.now() };
    const db = await dbPromise; const tx = db.transaction(['metadata', 'blobs', 'thumbnails', 'projectAssets'], 'readwrite');
    await tx.objectStore('metadata').put(meta, assetId);
    if (!originalInOpfs) await tx.objectStore('blobs').put(prepared.file, blobKey);
    if (!thumbInOpfs) await tx.objectStore('thumbnails').put(prepared.thumbnail, thumbnailKey);
    await tx.objectStore('projectAssets').put(link, link.id);
    await tx.done; return meta;
  }

  async remove(assetId: string, projectId: string): Promise<boolean> {
    const db = await dbPromise;
    await db.delete('projectAssets', linkId(projectId, assetId));
    const remainingLinks = await db.getAllKeysFromIndex('projectAssets', 'assetId', assetId);
    if (remainingLinks.length > 0) return false;
    const meta = await db.get('metadata', assetId); if (!meta) return false;
    const tx = db.transaction(['metadata', 'blobs', 'thumbnails', 'assets'], 'readwrite');
    await tx.objectStore('metadata').delete(assetId);
    await tx.objectStore('blobs').delete(meta.blobKey);
    await tx.objectStore('thumbnails').delete(meta.thumbnailKey);
    await tx.objectStore('assets').delete(assetId);
    await tx.done;
    await Promise.all([deleteOpfsBlob(meta.blobKey), deleteOpfsBlob(meta.thumbnailKey)]);
    return true;
  }
}

export const assetRepository = new IndexedDbAssetRepository();
