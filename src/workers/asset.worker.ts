/// <reference lib="webworker" />
import type { PreparedAsset } from '@/assets/AssetRepository';

const THUMB_SIZE = 240;

async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function normalize(file: File): Promise<Blob> {
  if (!/heic|heif/i.test(`${file.type} ${file.name}`)) return file;
  const module = await import('heic2any');
  const converted = await module.default({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(converted) ? converted[0] : converted;
}

self.onmessage = async (event: MessageEvent<{ id: string; file: File }>) => {
  const { id, file } = event.data;
  try {
    const normalized = await normalize(file);
    const bitmap = await createImageBitmap(normalized);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d'); if (!context) throw new Error('Thumbnail canvas unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.78 });
    const result: PreparedAsset = { file: normalized, thumbnail, hash: await hash(normalized), width: bitmap.width, height: bitmap.height, mime: normalized.type || file.type || 'image/png', name: file.name.replace(/\.(heic|heif)$/i, '.jpg') };
    bitmap.close();
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
