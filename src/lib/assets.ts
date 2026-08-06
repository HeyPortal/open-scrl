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
const VIDEO_EXTENSIONS = new Set(['mp4','mov','m4v','webm','ogv','ogg']);
const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

export function isLikelyMediaFile(file: Pick<File, 'name' | 'type'>): boolean {
  const ext = extension(file.name);
  return file.type.startsWith('image/') || file.type.startsWith('video/') || IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}
export const isLikelyImageFile = isLikelyMediaFile;

function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = .78) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Thumbnail failed.')), type, quality));
}

async function prepareVideo(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = url;
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('This browser could not decode the video.')); });
    const scale = Math.min(1, 240 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
    return { file, thumbnail: await canvasBlob(canvas), hash, width: video.videoWidth, height: video.videoHeight, mime: file.type || 'video/mp4', name: file.name, mediaKind: 'video' as const, duration: Number.isFinite(video.duration) ? video.duration : 0 };
  } finally { URL.revokeObjectURL(url); }
}

async function prepareOnMain(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const thumbnail = await canvasBlob(canvas);
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
  const mediaKind = file.type === 'image/gif' ? 'gif' as const : 'image' as const;
  let duration = 0;
  if (mediaKind === 'gif') { try { const { parseGIF, decompressFrames } = await import('gifuct-js'); duration = decompressFrames(parseGIF(await file.arrayBuffer()), false).reduce((total, frame) => total + Math.max(20, frame.delay || 100), 0) / 1000; } catch { duration = 0; } }
  const result = { file, thumbnail, hash, width: bitmap.width, height: bitmap.height, mime: file.type || 'image/png', name: file.name, mediaKind, duration };
  bitmap.close(); return result;
}

export async function importAsset(file: File): Promise<AssetMeta> {
  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension(file.name))) {
    const prepared = await prepareVideo(file); const duplicate = await assetRepository.findByHash(prepared.hash);
    if (duplicate) throw new DuplicateAssetError(duplicate);
    return assetRepository.commit(prepared);
  }
  if (importer === undefined) importer = typeof Worker !== 'undefined' ? new AssetImportController(assetRepository, 2) : null;
  if (importer) return importer.import(file);
  const prepared = await prepareOnMain(file); const duplicate = await assetRepository.findByHash(prepared.hash);
  if (duplicate) throw new DuplicateAssetError(duplicate);
  return assetRepository.commit(prepared);
}

export async function getAsset(assetId: string): Promise<Asset | undefined> {
  const [meta, blob] = await Promise.all([assetRepository.listMetadata().then((all)=>all.find((x)=>x.id===assetId)), assetRepository.readOriginal(assetId)]);
  return meta && blob ? { id: meta.id, name: meta.name, mime: meta.mime, width: meta.width, height: meta.height, size: meta.size, hash: meta.hash, blob, mediaKind: meta.mediaKind, duration: meta.duration } : undefined;
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
