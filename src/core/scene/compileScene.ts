import type { Bounds, Layer, ProjectDocumentV2 } from '@/types';
import { intersects } from '../document/coordinates';

export interface SceneItem {
  id: string;
  slideId: string;
  layer: Layer;
  bounds: Bounds;
}

export function compileScene(doc: ProjectDocumentV2, viewport?: Bounds): SceneItem[] {
  const items: SceneItem[] = [];
  for (const [index, slideId] of doc.slideOrder.entries()) {
    const slide = doc.slides[slideId];
    if (!slide) continue;
    for (const layerId of slide.layerOrder) {
      const layer = doc.layers[layerId];
      if (!layer?.visible) continue;
      const bounds = { x: index * doc.format.width + layer.x, y: layer.y, width: layer.width, height: layer.height };
      if (viewport && !intersects(bounds, viewport)) continue;
      items.push({ id: layerId, slideId, layer, bounds });
    }
  }
  return items;
}
