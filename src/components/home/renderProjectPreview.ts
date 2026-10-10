import { readProject } from '@/storage/database';
import { migrateDocument } from '@/core/document/migrations';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { paintSlidePreview, slideScene } from '@/render/preview';
import type { AssetMeta } from '@/types';

/**
 * Paints a slide (the first by default) of a stored project for the home screen. Read-only: nothing is written
 * back, no editor or asset-store state is touched, and a document that cannot be read or migrated
 * simply has no preview. Kept in its own lazy chunk, loaded on the first visible card.
 */
export async function renderProjectPreview(projectId: string, pixelWidth: number, slideIndex = 0): Promise<Blob | null> {
  const stored = await readProject(projectId);
  if (!stored) return null;
  let doc;
  try {
    doc = migrateDocument(stored);
  } catch {
    return null;
  }
  const slideId = doc.slideOrder[slideIndex];
  if (!slideId) return null;
  const scene = slideScene(doc, slideId);

  // Metadata lets the painter tell videos (poster frame) from images and skip a second lookup.
  const ids = new Set<string>();
  if (scene.background.kind === 'image' && scene.background.assetId) ids.add(scene.background.assetId);
  for (const { layer } of scene.items) if (layer.kind === 'image' && layer.assetId) ids.add(layer.assetId);
  const assets = new Map<string, AssetMeta>();
  await Promise.all([...ids].map(async (id) => {
    const meta = await assetRepository.readMetadata(id).catch(() => undefined);
    if (meta) assets.set(id, meta);
  }));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pixelWidth));
  canvas.height = Math.max(1, Math.round((pixelWidth * doc.format.height) / doc.format.width));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (!(await paintSlidePreview(ctx, scene, doc.format, canvas.width, assets, { checkerboard: true }))) return null;
  // WebP where the browser can encode it (smaller); other browsers fall back to PNG.
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
}
