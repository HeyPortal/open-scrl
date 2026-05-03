import { createStore, get, set, del, keys, entries } from 'idb-keyval';
import type { Asset } from '@/types';
import { id } from './nano';

const store = createStore('open-scrl-assets', 'assets');

const cache = new Map<string, { url: string; asset: Asset }>();
const thumbCache = new Map<string, string>();
const THUMB_SIZE = 240;

export class DuplicateAssetError extends Error {
  existing: Asset;

  constructor(existing: Asset) {
    super('Photo has already been imported.');
    this.name = 'DuplicateAssetError';
    this.existing = existing;
  }
}

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
]);

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

function getExtension(name: string): string {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

export function isLikelyImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(getExtension(file.name));
}

function isHeicLike(file: Pick<File, 'name' | 'type'>): boolean {
  const type = file.type.toLowerCase();
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    type === 'image/heic-sequence' ||
    type === 'image/heif-sequence' ||
    HEIC_EXTENSIONS.has(getExtension(file.name))
  );
}

function normalizeMimeByExtension(file: File): File {
  if (file.type.startsWith('image/')) return file;
  const ext = getExtension(file.name);
  const inferred = EXTENSION_TO_MIME[ext];
  if (!inferred) return file;
  return new File([file], file.name, {
    type: inferred,
    lastModified: file.lastModified,
  });
}

async function normalizeImportFile(file: File): Promise<File> {
  const normalizedType = normalizeMimeByExtension(file);
  if (!isHeicLike(normalizedType)) return normalizedType;

  const mod = await import('heic2any');
  const converted = await mod.default({
    blob: normalizedType,
    toType: 'image/jpeg',
    quality: 0.92,
  });
  const output = Array.isArray(converted) ? converted[0] : converted;
  const outName = normalizedType.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([output], outName, { type: 'image/jpeg', lastModified: normalizedType.lastModified });
}

async function loadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob);
      const dim = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dim;
    } catch {
      // Fall back to HTMLImageElement below for browsers / files that fail bitmap decode.
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dim = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dim);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          'Image decode failed. The file may be extremely large, CMYK, or otherwise unsupported by this browser.',
        ),
      );
    };
    img.src = url;
  });
}

async function safeLoadImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    return await loadImageDimensions(blob);
  } catch (err) {
    console.warn('Could not decode image dimensions during import; using fallback size.', err);
    // Import should never be blocked by a metadata probe. The actual object URL
    // is still preserved, and the layer can render if the browser can display it.
    return { width: 1080, height: 1080 };
  }
}

async function sha256(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function findDuplicateAsset(hash: string, blob: Blob): Promise<Asset | undefined> {
  const all = await entries<string, Asset>(store);
  for (const [key, asset] of all) {
    if (asset.hash === hash) return asset;

    // Backfill hashes for older imports only when the size matches, which keeps
    // duplicate checks cheap for large galleries.
    const assetSize = asset.size ?? asset.blob.size;
    if (!asset.hash && assetSize === blob.size) {
      const existingHash = await sha256(asset.blob);
      const updated: Asset = { ...asset, hash: existingHash, size: assetSize };
      await set(key, updated, store);
      if (existingHash === hash) return updated;
    }
  }
  return undefined;
}

export async function importAsset(file: File): Promise<Asset> {
  const normalized = await normalizeImportFile(file);
  const hash = await sha256(normalized);
  const duplicate = await findDuplicateAsset(hash, normalized);
  if (duplicate) throw new DuplicateAssetError(duplicate);

  const dim = await safeLoadImageDimensions(normalized);
  const asset: Asset = {
    id: id(),
    name: normalized.name || file.name,
    mime: normalized.type || file.type || 'image/png',
    width: dim.width,
    height: dim.height,
    blob: normalized,
    size: normalized.size,
    hash,
  };
  await set(asset.id, asset, store);
  return asset;
}

export async function getAsset(assetId: string): Promise<Asset | undefined> {
  return get<Asset>(assetId, store);
}

export async function deleteAsset(assetId: string): Promise<void> {
  const c = cache.get(assetId);
  if (c) {
    URL.revokeObjectURL(c.url);
    cache.delete(assetId);
  }
  const thumb = thumbCache.get(assetId);
  if (thumb) {
    URL.revokeObjectURL(thumb);
    thumbCache.delete(assetId);
  }
  await del(assetId, store);
}

export async function listAssetIds(): Promise<string[]> {
  const ks = await keys(store);
  return ks.map((k) => String(k));
}

export async function listAssets(): Promise<Asset[]> {
  const all = await entries<string, Asset>(store);
  return all.map(([, v]) => v);
}

export async function getAssetUrl(assetId: string): Promise<string | undefined> {
  const cached = cache.get(assetId);
  if (cached) return cached.url;
  const asset = await getAsset(assetId);
  if (!asset) return undefined;
  const url = URL.createObjectURL(asset.blob);
  cache.set(assetId, { url, asset });
  return url;
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not create thumbnail blob.'));
      },
      type,
      quality,
    );
  });
}

async function createThumbnailBlob(asset: Asset): Promise<Blob> {
  const source = await createImageBitmap(asset.blob);
  try {
    const scale = Math.min(1, THUMB_SIZE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create thumbnail canvas context.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return await blobFromCanvas(canvas, 'image/jpeg', 0.78);
  } finally {
    source.close();
  }
}

export async function getAssetThumbUrl(assetId: string): Promise<string | undefined> {
  const cached = thumbCache.get(assetId);
  if (cached) return cached;
  const asset = await getAsset(assetId);
  if (!asset) return undefined;

  try {
    const thumb = await createThumbnailBlob(asset);
    const url = URL.createObjectURL(thumb);
    thumbCache.set(assetId, url);
    return url;
  } catch (err) {
    console.warn('Could not create thumbnail; using original asset URL.', asset.name, err);
    return getAssetUrl(assetId);
  }
}

export function getAssetUrlSync(assetId: string): string | undefined {
  return cache.get(assetId)?.url;
}

export function getCachedAsset(assetId: string): Asset | undefined {
  return cache.get(assetId)?.asset;
}
