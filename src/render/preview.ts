import type { AssetMeta, Background, Layer, ProjectDocumentV2 } from '@/types';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import { getAssetThumbUrl } from '@/lib/assets';
import { getMediaKind } from '@/lib/media';
import { imageResourceManager } from './resources/ImageResourceManager';
import { paintBackground, paintCheckerboard, paintLayer, type Context2D, type PaintMedia } from './paint/layers';

/**
 * Main-thread slide previews (filmstrip thumbnails, the phone preview) drawn with the same
 * painter as the canvas and export. Videos show their poster frame.
 */

export interface SlideScene {
  background: Background;
  /** Layers in paint order. `x` is the left edge of each layer's own slide relative to this one (0, or ±n slides for spanning layers). */
  items: { layer: Layer; x: number }[];
}

export function slideScene(doc: ProjectDocumentV2, slideId: string): SlideScene {
  const index = doc.slideOrder.indexOf(slideId);
  const viewport = getSlideViewport(doc, slideId);
  const background = doc.slides[slideId]?.background ?? { kind: 'solid', color: '#ffffff' };
  if (!viewport) return { background, items: [] };
  return { background, items: compileScene(doc, viewport).map((item) => ({ layer: item.layer, x: item.bounds.x - item.layer.x - index * doc.format.width })) };
}

/** True when two scenes would paint the same pixels (layers are immutable, so identity suffices). */
export function sameScene(a: SlideScene, b: SlideScene) {
  return a.background === b.background && a.items.length === b.items.length && a.items.every((item, i) => item.layer === b.items[i].layer && item.x === b.items[i].x);
}

const posters = new Map<string, Promise<HTMLImageElement | null>>();

function poster(assetId: string) {
  let work = posters.get(assetId);
  if (!work) {
    work = getAssetThumbUrl(assetId).then((url) => url ? new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    }) : null).catch(() => null);
    posters.set(assetId, work);
  }
  return work;
}

interface Loaded { media: PaintMedia; release: () => void }

async function loadMedia(assetId: string, edge: number, meta: AssetMeta | undefined): Promise<Loaded | null> {
  try {
    if (meta && getMediaKind(meta) === 'video') {
      const image = await poster(assetId);
      return image ? { media: { source: image, width: image.naturalWidth, height: image.naturalHeight }, release: () => undefined } : null;
    }
    const lease = await imageResourceManager.acquire(assetId, edge, meta);
    return { media: { source: lease.bitmap, width: lease.bitmap.width, height: lease.bitmap.height }, release: lease.release };
  } catch {
    return null;
  }
}

/**
 * Paints `scene` into `ctx` scaled to `pixelWidth`. Returns false if `isCurrent` turned false
 * while media was loading (a newer paint superseded this one).
 */
export async function paintSlidePreview(
  ctx: Context2D,
  scene: SlideScene,
  format: { width: number; height: number },
  pixelWidth: number,
  assets: Map<string, AssetMeta>,
  options: { checkerboard?: boolean; isCurrent?: () => boolean } = {},
) {
  const scale = pixelWidth / format.width;
  const edge = Math.max(format.width, format.height) * scale * 1.5;
  const ids = new Set<string>();
  if (scene.background.kind === 'image' && scene.background.assetId) ids.add(scene.background.assetId);
  for (const { layer } of scene.items) if (layer.kind === 'image' && layer.assetId) ids.add(layer.assetId);
  const loaded = new Map<string, Loaded>();
  await Promise.all([...ids].map(async (id) => {
    const value = await loadMedia(id, edge, assets.get(id));
    if (value) loaded.set(id, value);
  }));
  try {
    if (options.isCurrent && !options.isCurrent()) return false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.scale(scale, scale);
    const bg = scene.background;
    if (bg.kind === 'transparent' && options.checkerboard) paintCheckerboard(ctx, format.width, format.height, format.width / 24);
    const bgMedia = bg.kind === 'image' && bg.assetId ? loaded.get(bg.assetId)?.media : undefined;
    paintBackground(ctx, bg, format.width, format.height, bgMedia && bg.kind === 'image' ? { ...bgMedia, key: `${bg.assetId}@${bgMedia.width}` } : null);
    for (const { layer, x } of scene.items) {
      if (layer.kind === 'image' && !layer.assetId) continue;
      const media = layer.kind === 'image' && layer.assetId ? loaded.get(layer.assetId)?.media : undefined;
      if (layer.kind === 'image' && !media) continue;
      paintLayer(ctx, layer, x, media);
    }
    ctx.restore();
    return true;
  } finally {
    for (const value of loaded.values()) value.release();
  }
}
