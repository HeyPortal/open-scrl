import type { AssetMeta } from '@/types';

export interface PreparedAsset {
  file: Blob;
  thumbnail: Blob;
  hash: string;
  width: number;
  height: number;
  mime: string;
  name: string;
  mediaKind?: 'image' | 'gif' | 'video';
  duration?: number;
}

export interface AssetRepository {
  listMetadata(): Promise<AssetMeta[]>;
  findByHash(hash: string): Promise<AssetMeta | undefined>;
  readOriginal(id: string): Promise<Blob | undefined>;
  readThumbnail(id: string): Promise<Blob | undefined>;
  commit(prepared: PreparedAsset): Promise<AssetMeta>;
  remove(id: string): Promise<void>;
}
