import type { Bounds, Layer, ProjectDocumentV2 } from '@/types';
import { getLayerGlobalBounds, intersects } from '../document/coordinates';
import { findLayerSlideId } from '../document/selectors';

export interface SceneItem {
  id: string;
  slideId: string;
  layer: Layer;
  bounds: Bounds;
}

export function compileScene(doc: ProjectDocumentV2, viewport?: Bounds): SceneItem[] {
  const items: SceneItem[] = [];
  for (const slideId of doc.slideOrder) {
    const slide = doc.slides[slideId];
    for (const layerId of slide.layerOrder) {
      const layer = doc.layers[layerId];
      const bounds = getLayerGlobalBounds(doc, layerId);
      if (!layer || !bounds || !layer.visible || (viewport && !intersects(bounds, viewport))) continue;
      items.push({ id: layerId, slideId: findLayerSlideId(doc, layerId) ?? slideId, layer, bounds });
    }
  }
  return items;
}
