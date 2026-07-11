import type { Bounds, ProjectDocumentV2 } from '@/types';
import { findLayerSlideId } from './selectors';

export function getSlideViewport(doc: ProjectDocumentV2, slideId: string): Bounds | undefined {
  const index = doc.slideOrder.indexOf(slideId);
  if (index < 0) return undefined;
  return { x: index * doc.format.width, y: 0, width: doc.format.width, height: doc.format.height };
}

export function getLayerGlobalBounds(doc: ProjectDocumentV2, layerId: string): Bounds | undefined {
  const layer = doc.layers[layerId];
  const slideId = findLayerSlideId(doc, layerId);
  const viewport = slideId ? getSlideViewport(doc, slideId) : undefined;
  if (!layer || !viewport) return undefined;
  return { x: viewport.x + layer.x, y: layer.y, width: layer.width, height: layer.height };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getVisibleLayerIds(doc: ProjectDocumentV2, viewport: Bounds): string[] {
  return Object.keys(doc.layers).filter((id) => {
    const bounds = getLayerGlobalBounds(doc, id);
    return !!bounds && intersects(bounds, viewport);
  });
}
