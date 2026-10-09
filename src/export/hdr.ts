import { photoWindow, photoPlacement } from '@/render/paint/photoGeometry';
import type { ImageLayer, ProjectDocumentV2 } from '@/types';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import { maskPath } from '@/render/paint/masks';
import { imageCrop, paintBackground, paintLayer, paintLayerShadow } from '@/render/paint/layers';
import { inspectSlideVideo } from './video';

export interface HDRCapabilities { hdr: boolean; format?: string; error?: string }
export async function hdrCapabilities(): Promise<HDRCapabilities> {
  try {
    const response = await fetch('/api/native/capabilities', { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
    return await response.json() as HDRCapabilities;
  } catch { return { hdr: false, error: 'HDR export needs the local macOS image helper. PNG and JPEG SDR exports work in the browser.' }; }
}
interface PhotoEntry {
  kind: 'photo'; file: string; mask: string;
  crop: { x: number; y: number; width: number; height: number };
  x: number; y: number; width: number; height: number; rotation: number; blur?: number;
}
type Entry = PhotoEntry | { kind: 'raster'; file: string };
export async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
}
async function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare the export.')), 'image/png'));
}
export async function renderHDRSlide(doc: ProjectDocumentV2, index: number, pixelRatio: 1 | 2 = 1): Promise<Blob> {
  const sid = doc.slideOrder[index];
  const slide = doc.slides[sid];
  if (!slide) throw new Error('Select a slide to export.');
  if ((await inspectSlideVideo(doc, sid)).animated) throw new Error('HDR photo export cannot include video or animated GIFs.');
  const { width, height } = doc.format;
  if (width * height * pixelRatio ** 2 > 24_000_000) throw new Error('HDR export exceeds the 24 megapixel limit.');
  const entries: Entry[] = [];
  const files: { name: string; data: string }[] = [];
  const sources = new Map<string, string>();
  const fresh = () => {
    const canvas = document.createElement('canvas'); canvas.width = width * pixelRatio; canvas.height = height * pixelRatio;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable.');
    ctx.scale(pixelRatio, pixelRatio);
    return { canvas, ctx };
  };
  const file = async (blob: Blob) => {
    const name = `image_${files.length}`;
    files.push({ name, data: await blobBase64(blob) }); return name;
  };
  const raster = async (paint: (ctx: CanvasRenderingContext2D) => void) => {
    const { canvas, ctx } = fresh(); paint(ctx);
    entries.push({ kind: 'raster', file: await file(await canvasBlob(canvas)) });
  };
  const photo = async (layer: ImageLayer, x: number, blur = 0) => {
    const assetId = layer.assetId!;
    const meta = await assetRepository.readMetadata(assetId);
    const source = await assetRepository.readSource(assetId);
    if (!meta || !source) throw new Error(`The original for “${layer.name}” is missing. Restore a project backup.`);
    let name = sources.get(assetId);
    if (!name) { name = await file(source); sources.set(assetId, name); }
    const { canvas, ctx } = fresh();
    ctx.translate(x + layer.x + layer.width / 2, layer.y + layer.height / 2);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.translate(-layer.width / 2, -layer.height / 2);
    ctx.globalAlpha = layer.opacity;
    const window = photoWindow(layer);
    const decorated = Boolean((layer as ImageLayer & { frameStyle?: string }).frameStyle && (layer.strokeWidth ?? 0) > 0);
    ctx.translate(window.x, window.y);
    ctx.fillStyle = '#fff'; ctx.fill(maskPath(decorated ? 'rect' : layer.mask, window.width, window.height, decorated ? 0 : layer.cornerRadius));
    entries.push({ kind: 'photo', file: name, mask: await file(await canvasBlob(canvas)), crop: imageCrop(layer, meta.width, meta.height), ...photoPlacement(layer, x), rotation: layer.rotation, blur });
  };
  const bg = slide.background;
  await raster((ctx) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    paintBackground(ctx, bg.kind === 'image' ? { kind: 'solid', color: bg.color } : bg, width, height);
  });
  if (bg.kind === 'image' && bg.assetId) {
    await photo({ id: 'background', kind: 'image', name: 'Background', assetId: bg.assetId, x: 0, y: 0, width, height, opacity: 1, rotation: 0, visible: true, locked: true, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 }, 0, bg.blur);
    if (bg.dim > 0) await raster((ctx) => { ctx.fillStyle = `rgba(0,0,0,${bg.dim})`; ctx.fillRect(0, 0, width, height); });
  }
  const viewport = getSlideViewport(doc, sid)!;
  for (const item of compileScene(doc, viewport)) {
    const layer = item.layer;
    if (!layer.visible || layer.width <= 0 || layer.height <= 0) continue;
    const x = item.bounds.x - layer.x - index * width;
    if (layer.kind !== 'image') { await raster((ctx) => paintLayer(ctx, layer, x)); continue; }
    if (!layer.assetId) continue;
    if (layer.shadow) {
      const preview = await assetRepository.readOriginal(layer.assetId);
      if (!preview) throw new Error('A photo preview is missing.');
      const bitmap = await createImageBitmap(preview);
      try {
        await raster((ctx) => {
          ctx.translate(x + layer.x + layer.width / 2, layer.y + layer.height / 2);
          ctx.rotate(layer.rotation * Math.PI / 180); ctx.translate(-layer.width / 2, -layer.height / 2); ctx.globalAlpha = layer.opacity;
          paintLayerShadow(ctx, layer, { source: bitmap, width: bitmap.width, height: bitmap.height });
        });
      } finally { bitmap.close(); }
    }
    await photo(layer, x);
    if ((layer.strokeWidth ?? 0) > 0) await raster((ctx) => paintLayer(ctx, { ...layer, shadow: null }, x));
  }
  const response = await fetch('/api/native/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: { width, height, pixelRatio, entries }, files }) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'HDR export failed. Check the local image helper.' })) as { error: string };
    throw new Error(result.error);
  }
  const report = JSON.parse(response.headers.get('X-HDR-Report') || '{}') as { gainMap?: boolean; maxLinearHDR?: number };
  if (!report.gainMap || !(report.maxLinearHDR && report.maxLinearHDR > 1.01)) throw new Error('HDR validation failed. No SDR substitution was made.');
  return response.blob();
}
