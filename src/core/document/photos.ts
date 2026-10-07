import type { ImageLayer, ProjectDocumentV2 } from '@/types';
import { getSlideLayers } from './selectors';

/** Filled, visible photo frames. Locks freeze geometry, not their contents. */
export function filledPhotoFrames(doc: ProjectDocumentV2, slideId: string): ImageLayer[] {
  return getSlideLayers(doc, slideId).filter((layer): layer is ImageLayer =>
    layer.kind === 'image' && layer.visible && layer.assetId !== null,
  );
}

export function canShufflePhotoFrames(doc: ProjectDocumentV2, slideId: string): boolean {
  return new Set(filledPhotoFrames(doc, slideId).map((layer) => layer.assetId)).size > 1;
}

export function canSwapPhotoFrames(doc: ProjectDocumentV2, sourceId: string, targetId: string): boolean {
  const source = doc.layers[sourceId], target = doc.layers[targetId];
  return sourceId !== targetId && source?.kind === 'image' && target?.kind === 'image'
    && source.visible && target.visible && source.assetId !== target.assetId;
}

/** Assign content without changing the frame or its styling. */
export function setFramePhoto(layer: ImageLayer, assetId: string | null): void {
  layer.assetId = assetId;
  layer.cropOffsetX = 0;
  layer.cropOffsetY = 0;
  layer.cropScale = 1;
}

/** A bounded shuffle, including a guaranteed change when duplicate photos exist. */
export function shuffledPhotoIds(assetIds: string[], random: () => number = Math.random): string[] | null {
  if (new Set(assetIds).size < 2) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const shuffled = [...assetIds];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.some((assetId, i) => assetId !== assetIds[i])) return shuffled;
  }
  // Even a random source that repeatedly yields the identity must terminate.
  const shuffled = [...assetIds];
  const different = shuffled.findIndex((assetId) => assetId !== shuffled[0]);
  [shuffled[0], shuffled[different]] = [shuffled[different], shuffled[0]];
  return shuffled;
}
