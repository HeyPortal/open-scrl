/// <reference lib="webworker" />
import { editingPhoto } from '@/lib/decodePhoto';
import type { PreparedAsset } from '@/assets/AssetRepository';

const THUMB_SIZE = 240;

async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function gifDuration(blob: Blob) {
  try {
    const { parseGIF, decompressFrames } = await import('gifuct-js');
    const frames = decompressFrames(parseGIF(await blob.arrayBuffer()), false);
    return frames.reduce((total, frame) => total + Math.max(20, frame.delay || 100), 0) / 1000;
  } catch { return 0; }
}

self.onmessage = async (event: MessageEvent<{ id: string; file: File }>) => {
  const { id, file } = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    const normalized = await editingPhoto(file);
    const mime = normalized.type || file.type || 'image/png';
    const mediaKind = mime === 'image/gif' ? 'gif' : 'image';
    bitmap = await createImageBitmap(normalized);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Thumbnail canvas unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
    const result: PreparedAsset = { file: normalized, thumbnail, hash: await hash(file), width: bitmap.width, height: bitmap.height, mime, name: file.name, sourceFile: normalized === file ? undefined : file, sourceMime: file.type || 'image/heic', sourceName: file.name, mediaKind, duration: mediaKind === 'gif' ? await gifDuration(normalized) : 0 };
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap?.close();
  }
};
