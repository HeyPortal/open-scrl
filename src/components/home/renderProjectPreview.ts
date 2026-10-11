import { readProject } from '@/storage/database';
import { migrateDocument } from '@/core/document/migrations';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { paintSlidePreview, slideScene } from '@/render/preview';
import type { AssetMeta } from '@/types';

/**
 * Paints `count` consecutive slides of a stored project, starting at `slideIndex`, side by side in one image
 * (one slide by default), so a carousel reads as a continuous strip. Read-only: nothing is written back, no
 * editor or asset-store state is touched, and a document that cannot be read or migrated simply has no
 * preview. Kept in its own lazy chunk, loaded on the first visible card.
 */
export async function renderProjectPreview(projectId: string, pixelWidth: number, slideIndex = 0, count = 1): Promise<Blob | null> {
  const stored = await readProject(projectId);
  if (!stored) return null;
  let doc;
  try {
    doc = migrateDocument(stored);
  } catch {
    return null;
  }
  const slideIds = doc.slideOrder.slice(slideIndex, slideIndex + Math.max(1, count));
  if (!slideIds.length) return null;
  const scenes = slideIds.map((slideId) => slideScene(doc, slideId));

  // Metadata lets the painter tell videos (poster frame) from images and skip a second lookup.
  const ids = new Set<string>();
  for (const scene of scenes) {
    if (scene.background.kind === 'image' && scene.background.assetId) ids.add(scene.background.assetId);
    for (const { layer } of scene.items) if (layer.kind === 'image' && layer.assetId) ids.add(layer.assetId);
  }
  const assets = new Map<string, AssetMeta>();
  await Promise.all([...ids].map(async (id) => {
    const meta = await assetRepository.readMetadata(id).catch(() => undefined);
    if (meta) assets.set(id, meta);
  }));

  const width = Math.max(1, Math.round(pixelWidth));
  const height = Math.max(1, Math.round((pixelWidth * doc.format.height) / doc.format.width));
  const strip = document.createElement('canvas');
  strip.width = width * scenes.length;
  strip.height = height;
  const ctx = strip.getContext('2d');
  if (!ctx) return null;
  // The painter resets its canvas, so each slide is painted on its own and copied into place.
  const slide = scenes.length > 1 ? document.createElement('canvas') : strip;
  slide.width = width;
  slide.height = height;
  const slideCtx = slide.getContext('2d');
  if (!slideCtx) return null;
  for (const [index, scene] of scenes.entries()) {
    if (!(await paintSlidePreview(slideCtx, scene, doc.format, width, assets, { checkerboard: true }))) return null;
    if (slide !== strip) ctx.drawImage(slide, index * width, 0);
  }
  // WebP where the browser can encode it (smaller); other browsers fall back to PNG.
  return new Promise<Blob | null>((resolve) => strip.toBlob(resolve, 'image/webp', 0.9));
}
