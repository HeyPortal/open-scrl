import type { ProjectDocumentV2 } from '@/types';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import { paintBackground, paintLayer } from '@/render/paint/layers';

export interface RenderOptions { format: 'png' | 'jpeg'; quality: number; pixelRatio: number }
export interface ExportProgress { phase: 'compile' | 'decode' | 'render' | 'encode'; current: number; total: number }
type Surface = OffscreenCanvas | HTMLCanvasElement;

function context(surface: Surface) {
  const value = surface.getContext('2d');
  if (!value) throw new Error('2D canvas is unavailable.');
  return value as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

async function toBlob(surface: Surface, options: RenderOptions) {
  const mime=options.format==='jpeg'?'image/jpeg':'image/png';
  if ('convertToBlob' in surface) return surface.convertToBlob({type:mime,quality:options.quality});
  return new Promise<Blob>((resolve,reject)=>surface.toBlob((blob)=>blob?resolve(blob):reject(new Error('Canvas encoding failed.')),mime,options.quality));
}

export async function renderSlides(
  doc: ProjectDocumentV2,
  slideIndexes: number[],
  readAsset: (id: string) => Promise<Blob | undefined>,
  createSurface: (width: number, height: number) => Surface,
  options: RenderOptions,
  signal?: AbortSignal,
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob[]> {
  const scenes = slideIndexes.map((index) => {
    const viewport = getSlideViewport(doc, doc.slideOrder[index]);
    return viewport ? compileScene(doc, viewport) : [];
  });
  onProgress?.({ phase: 'compile', current: 1, total: 1 });
  // Decoded media is released as soon as the last slide using it is drawn.
  const uses = new Map<string, number>();
  const use = (id: string | null | undefined) => { if (id) uses.set(id, (uses.get(id) ?? 0) + 1); };
  slideIndexes.forEach((index, position) => {
    const bg = doc.slides[doc.slideOrder[index]]?.background;
    if (bg?.kind === 'image') use(bg.assetId);
    for (const item of scenes[position]) if (item.layer.kind === 'image') use(item.layer.assetId);
  });
  const total = uses.size;
  const decoded = new Map<string, ImageBitmap>();
  const acquire = async (id: string) => {
    let bitmap = decoded.get(id);
    if (!bitmap) {
      const blob = await readAsset(id);
      if (!blob) return undefined;
      bitmap = await createImageBitmap(blob);
      decoded.set(id, bitmap);
      onProgress?.({ phase: 'decode', current: decoded.size, total });
    }
    return bitmap;
  };
  const release = (id: string) => {
    const remaining = (uses.get(id) ?? 1) - 1;
    uses.set(id, remaining);
    if (remaining === 0) { decoded.get(id)?.close(); decoded.delete(id); }
  };
  const aborted = () => { if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };

  const output: Blob[] = [];
  try {
    for (let position = 0; position < slideIndexes.length; position++) {
      aborted();
      const index = slideIndexes[position];
      const slide = doc.slides[doc.slideOrder[index]];
      const { width, height } = doc.format;
      const surface = createSurface(width * options.pixelRatio, height * options.pixelRatio);
      const ctx = context(surface);
      ctx.scale(options.pixelRatio, options.pixelRatio);
      // JPEG has no alpha; flatten transparent slides onto white rather than black.
      if (options.format === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
      const bg = slide.background;
      if (bg.kind === 'image' && bg.assetId) {
        const bitmap = await acquire(bg.assetId);
        paintBackground(ctx, bg, width, height, bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height, key: bg.assetId } : null);
        release(bg.assetId);
      } else paintBackground(ctx, bg, width, height);
      for (const item of scenes[position]) {
        aborted();
        const layer = item.layer;
        // Offset of the layer's own slide; layers spanning from neighbors shift by whole slides.
        const x = item.bounds.x - layer.x - index * width;
        if (layer.kind === 'image') {
          if (!layer.assetId) continue;
          const bitmap = await acquire(layer.assetId);
          if (bitmap) paintLayer(ctx, layer, x, { source: bitmap, width: bitmap.width, height: bitmap.height });
          release(layer.assetId);
        } else paintLayer(ctx, layer, x);
      }
      onProgress?.({ phase: 'render', current: position + 1, total: slideIndexes.length });
      output.push(await toBlob(surface, options));
      onProgress?.({ phase: 'encode', current: position + 1, total: slideIndexes.length });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return output;
  } finally {
    for (const bitmap of decoded.values()) bitmap.close();
  }
}
