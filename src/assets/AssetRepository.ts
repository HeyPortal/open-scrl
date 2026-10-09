import type { AssetMeta } from '@/types';

export interface PreparedAsset {
  file: Blob;
  sourceFile?: Blob;
  sourceMime?: string;
  sourceName?: string;
  thumbnail: Blob;
  hash: string;
  width: number;
  height: number;
  mime: string;
  name: string;
  mediaKind?: 'image' | 'gif' | 'video';
  duration?: number;
}

export interface ProjectAssetScope {
  projectId: string;
  assetIds: string[];
}

export interface AssetRepository {
  listMetadata(projectId?: string): Promise<AssetMeta[]>;
  readMetadata(id: string): Promise<AssetMeta | undefined>;
  findByHash(hash: string): Promise<AssetMeta | undefined>;
  isLinkedToProject(projectId: string, assetId: string): Promise<boolean>;
  linkToProject(projectId: string, assetId: string): Promise<void>;
  needsProjectScopeMigration(): Promise<boolean>;
  migrateProjectScopes(scopes: ProjectAssetScope[], fallbackProjectId?: string): Promise<void>;
  readOriginal(id: string): Promise<Blob | undefined>;
  readThumbnail(id: string): Promise<Blob | undefined>;
  writeThumbnail(id: string, thumbnail: Blob): Promise<void>;
  commit(prepared: PreparedAsset, projectId: string): Promise<AssetMeta>;
  remove(id: string, projectId: string): Promise<boolean>;
}
