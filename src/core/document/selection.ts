import type { Bounds, ProjectDocumentV2 } from '@/types';
import { findLayerSlideId } from './selectors';
import { rotatedBounds, unionBounds } from './geometry';

export interface SelectionUnit {
  ids: string[];
  bounds: Bounds;
}

/** Missing ids are ignored; existing ids must all belong to the same slide. */
export function selectionSlideId(doc: ProjectDocumentV2, ids: readonly string[]): string | undefined {
  let slideId: string | undefined;
  for (const id of ids) {
    if (!doc.layers[id]) continue;
    const sid = findLayerSlideId(doc, id);
    if (!sid) continue;
    if (slideId && slideId !== sid) return undefined;
    slideId = sid;
  }
  return slideId;
}

/** Expansion is slide-local even when the input touches multiple slides. */
export function expandToGroups(doc: ProjectDocumentV2, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return doc.slideOrder.flatMap((sid) => {
    const order = doc.slides[sid]?.layerOrder ?? [];
    const groups = new Set(order.filter((id) => selected.has(id)).map((id) => doc.layers[id]?.groupId).filter((id): id is string => !!id));
    return [...new Set(order)].filter((id) => {
      const layer = doc.layers[id];
      return !!layer && (selected.has(id) || (!!layer.groupId && groups.has(layer.groupId)));
    });
  });
}

export function groupMemberIds(doc: ProjectDocumentV2, layerId: string): string[] {
  return expandToGroups(doc, [layerId]);
}

export function selectionUnits(doc: ProjectDocumentV2, ids: readonly string[]): SelectionUnit[] {
  const expanded = new Set(expandToGroups(doc, ids));
  return doc.slideOrder.flatMap((sid) => {
    const units: SelectionUnit[] = [];
    const groups = new Map<string, SelectionUnit>();
    for (const id of doc.slides[sid]?.layerOrder ?? []) {
      if (!expanded.delete(id)) continue;
      const layer = doc.layers[id];
      let unit = layer.groupId ? groups.get(layer.groupId) : undefined;
      if (!unit) {
        unit = { ids: [], bounds: rotatedBounds(layer) };
        units.push(unit);
        if (layer.groupId) groups.set(layer.groupId, unit);
      }
      unit.ids.push(id);
      unit.bounds = unionBounds([unit.bounds, rotatedBounds(layer)])!;
    }
    return units;
  });
}
