import type { ProjectDocumentV2 } from '@/types';
import { findLayerSlideId, groupMemberIds, selectionSlideId, selectionUnits } from '@/core/document/selectors';
import { useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';

const doc = () => useDocumentStore.getState().doc;
const session = () => useEditorSession.getState();

/** Selected ids that still exist, in selection order. */
export function currentSelection(d: ProjectDocumentV2 = doc()): string[] {
  return session().selectedLayerIds.filter((id) => !!d.layers[id]);
}

/**
 * The group the user has stepped into: the selection is part of one group but not all of it.
 * Clicks then pick single members instead of the whole group.
 */
export function enteredGroupId(d: ProjectDocumentV2 = doc(), ids: readonly string[] = currentSelection(d)): string | null {
  const group = ids.length ? d.layers[ids[0]]?.groupId : undefined;
  if (!group || !ids.every((id) => d.layers[id]?.groupId === group)) return null;
  return groupMemberIds(d, ids[0]).length > ids.length ? group : null;
}

/** What a click on `layerId` picks: its whole group, or just the layer inside an entered group. */
export function clickUnit(layerId: string, d: ProjectDocumentV2 = doc()): string[] {
  const group = d.layers[layerId]?.groupId;
  return group && group === enteredGroupId(d) ? [layerId] : groupMemberIds(d, layerId);
}

/**
 * Selects on pointer down. A plain click keeps an existing multi-selection when it lands on
 * a selected layer, so the whole selection can be dragged. `additive` (Shift, or ⌘/Ctrl)
 * toggles the clicked layer's group in or out of the selection.
 */
export function pickLayer(layerId: string, additive: boolean) {
  const d = doc();
  const s = session();
  if (!d.layers[layerId]) return;
  const current = currentSelection(d);
  const unit = clickUnit(layerId, d);
  const slideId = findLayerSlideId(d, layerId);
  if (slideId && slideId !== s.selectedSlideId) {
    s.selectSlide(slideId);
    s.selectLayers(unit, layerId);
    return;
  }
  if (additive) {
    if (selectionSlideId(d, [...current, layerId]) === undefined) { s.selectLayers(unit, layerId); return; }
    if (unit.some((id) => current.includes(id))) {
      s.selectLayers(current.filter((id) => !unit.includes(id)));
      return;
    }
    s.selectLayers([...current, ...unit], layerId);
    return;
  }
  if (current.includes(layerId)) { s.selectLayers(current, layerId); return; }
  s.selectLayers(unit, layerId);
}

/** True when a plain click on this already-selected layer should narrow the selection to it. */
export function clickWouldNarrow(layerId: string): boolean {
  const d = doc();
  const current = currentSelection(d);
  return current.includes(layerId) && selectionUnits(d, current).length > 1;
}

export function narrowTo(layerId: string) {
  session().selectLayers(clickUnit(layerId, doc()), layerId);
}

/** Double-click on a grouped layer steps into the group and selects only that layer. */
export function enterGroup(layerId: string) {
  session().selectLayers([layerId], layerId);
}

/** Esc: from inside a group, select the whole group; otherwise clear the selection. */
export function selectParent() {
  const d = doc();
  const current = currentSelection(d);
  if (enteredGroupId(d, current)) {
    session().selectLayers(groupMemberIds(d, current[0]), session().selectedLayerId);
    return;
  }
  session().selectLayer(null);
}
