import type { Asset, AssetMeta } from '@/types';
import { AssetImportController, DuplicateAssetError } from '@/assets/AssetImportController';
import type { PreparedAsset } from '@/assets/AssetRepository';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { imageResourceManager } from '@/render/resources/ImageResourceManager';

export { DuplicateAssetError };

let importer: AssetImportController | null | undefined;
const originalUrls = new Map<string, { url: string; touched: number }>();
const thumbUrls = new Map<string, string>();
const generatedThumbnails = new Map<string, Promise<Blob | undefined>>();
let thumbnailGenerationTail: Promise<void> = Promise.resolve();
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

async function importPrepared(prepared: PreparedAsset, projectId: string) {
  const duplicate = await assetRepository.findByHash(prepared.hash);
  if (duplicate) {
    if (await assetRepository.isLinkedToProject(projectId, duplicate.id)) throw new DuplicateAssetError(duplicate);
  }
  return assetRepository.commit(prepared, projectId);
}

export async function importAsset(file: File, projectId: string): Promise<AssetMeta> {
  if (file.type.startsWith('video/') || VIDEO_EXTENSIONS.has(extension(file.name))) {
    return importPrepared(await prepareVideo(file), projectId);
  }
  if (importer === undefined) importer = typeof Worker !== 'undefined' ? new AssetImportController(assetRepository, 2) : null;
  if (importer) return importer.import(file, projectId);
  return importPrepared(await prepareOnMain(file), projectId);
}

export async function getAsset(assetId: string): Promise<Asset | undefined> {
  const [meta, blob] = await Promise.all([assetRepository.readMetadata(assetId), assetRepository.readOriginal(assetId)]);
  return meta && blob ? { id: meta.id, name: meta.name, mime: meta.mime, width: meta.width, height: meta.height, size: meta.size, hash: meta.hash, blob, mediaKind: meta.mediaKind, duration: meta.duration } : undefined;
}

export async function getAssetMetadata(assetId: string) {
  return assetRepository.readMetadata(assetId);
}

export async function deleteAsset(assetId: string, projectId: string) {
  const removed = await assetRepository.remove(assetId, projectId);
  if (!removed) return;
  const original = originalUrls.get(assetId); if (original) URL.revokeObjectURL(original.url);
  const thumb = thumbUrls.get(assetId); if (thumb) URL.revokeObjectURL(thumb);
  originalUrls.delete(assetId); thumbUrls.delete(assetId); imageResourceManager.removeAsset(assetId);
}

export async function listAssetIds() { return (await assetRepository.listMetadata()).map((a)=>a.id); }
export async function listAssets(projectId: string) { return assetRepository.listMetadata(projectId); }

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

async function createStoredThumbnail(assetId: string): Promise<Blob | undefined> {
  const [meta, original] = await Promise.all([
    assetRepository.readMetadata(assetId),
    assetRepository.readOriginal(assetId),
  ]);
  if (!meta || !original) return undefined;
  const scale = Math.min(1, 240 / Math.max(meta.width, meta.height));
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  if (meta.mediaKind === 'video' || meta.mime.startsWith('video/')) {
    const originalUrl = URL.createObjectURL(original);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = originalUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('This browser could not create a video thumbnail.'));
      });
      canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(originalUrl);
    }
  } else {
    const bitmap = await createImageBitmap(original, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    });
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
  }

  const thumbnail = await canvasBlob(canvas);
  await assetRepository.writeThumbnail(assetId, thumbnail);
  return thumbnail;
}

async function ensureStoredThumbnail(assetId: string) {
  const existing = await assetRepository.readThumbnail(assetId);
  if (existing) return existing;
  let work = generatedThumbnails.get(assetId);
  if (!work) {
    work = thumbnailGenerationTail
      .then(() => createStoredThumbnail(assetId))
      .finally(() => generatedThumbnails.delete(assetId));
    thumbnailGenerationTail = work.then(() => undefined, () => undefined);
    generatedThumbnails.set(assetId, work);
  }
  return work;
}

export async function getAssetThumbUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbUrls.get(assetId); if (cached) return cached;
  const thumbnail = await ensureStoredThumbnail(assetId);
  if (!thumbnail) return undefined;
  const url = URL.createObjectURL(thumbnail); thumbUrls.set(assetId, url); return url;
}

export function getAssetUrlSync(assetId: string) { return originalUrls.get(assetId)?.url; }
