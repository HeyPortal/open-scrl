import type { Asset, AssetMeta } from '@/types';
import { AssetImportController, DuplicateAssetError } from '@/assets/AssetImportController';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { imageResourceManager } from '@/render/resources/ImageResourceManager';

export { DuplicateAssetError };

let importer: AssetImportController | null | undefined;
const originalUrls = new Map<string, { url: string; touched: number }>();
const thumbUrls = new Map<string, string>();
const MAX_ORIGINAL_URLS = 12;

const IMAGE_EXTENSIONS = new Set(['jpg','jpeg','png','webp','gif','bmp','svg','avif','heic','heif']);
const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

export function isLikelyImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extension(file.name));
}

async function prepareOnMain(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Thumbnail failed.')), 'image/jpeg', .78));
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
  const result = { file, thumbnail, hash, width: bitmap.width, height: bitmap.height, mime: file.type || 'image/png', name: file.name };
  bitmap.close(); return result;
}

export async function importAsset(file: File): Promise<AssetMeta> {
  if (importer === undefined) importer = typeof Worker !== 'undefined' ? new AssetImportController(assetRepository, 2) : null;
  if (importer) return importer.import(file);
  const prepared = await prepareOnMain(file); const duplicate = await assetRepository.findByHash(prepared.hash);
  if (duplicate) throw new DuplicateAssetError(duplicate);
  return assetRepository.commit(prepared);
}

export async function getAsset(assetId: string): Promise<Asset | undefined> {
  const [meta, blob] = await Promise.all([assetRepository.listMetadata().then((all)=>all.find((x)=>x.id===assetId)), assetRepository.readOriginal(assetId)]);
  return meta && blob ? { id: meta.id, name: meta.name, mime: meta.mime, width: meta.width, height: meta.height, size: meta.size, hash: meta.hash, blob } : undefined;
}

export async function deleteAsset(assetId: string) {
  const original = originalUrls.get(assetId); if (original) URL.revokeObjectURL(original.url);
  const thumb = thumbUrls.get(assetId); if (thumb) URL.revokeObjectURL(thumb);
  originalUrls.delete(assetId); thumbUrls.delete(assetId); imageResourceManager.removeAsset(assetId);
  await assetRepository.remove(assetId);
}

export async function listAssetIds() { return (await assetRepository.listMetadata()).map((a)=>a.id); }
export async function listAssets() { return assetRepository.listMetadata(); }

export async function getAssetUrl(assetId: string): Promise<string | undefined> {
  const cached = originalUrls.get(assetId); if (cached) { cached.touched = performance.now(); return cached.url; }
  const blob = await assetRepository.readOriginal(assetId); if (!blob) return undefined;
  const url = URL.createObjectURL(blob); originalUrls.set(assetId, { url, touched: performance.now() });
  if (originalUrls.size > MAX_ORIGINAL_URLS) {
    const oldest = [...originalUrls].filter(([id])=>id!==assetId).sort((a,b)=>a[1].touched-b[1].touched)[0];
    if (oldest) { URL.revokeObjectURL(oldest[1].url); originalUrls.delete(oldest[0]); }
  }
  return url;
}

export async function getAssetThumbUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbUrls.get(assetId); if (cached) return cached;
  const blob = (await assetRepository.readThumbnail(assetId)) ?? await assetRepository.readOriginal(assetId); if (!blob) return undefined;
  const url = URL.createObjectURL(blob); thumbUrls.set(assetId, url); return url;
}

export function getAssetUrlSync(assetId: string) { return originalUrls.get(assetId)?.url; }
