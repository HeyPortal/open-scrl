import type { Draft } from 'immer';
import { GRID_TEMPLATES, layoutGrid, type GridCell, type GridTemplate } from '@/lib/grids';
import type { Layer, ProjectDocumentV2, SlideGrid } from '@/types';

export const SLOT_EPSILON = 0.5;

export function slotMatchesCell(layer: Pick<Layer, 'x' | 'y' | 'width' | 'height'>, cell: GridCell): boolean {
  return (
    Math.abs(layer.x - cell.x) <= SLOT_EPSILON &&
    Math.abs(layer.y - cell.y) <= SLOT_EPSILON &&
    Math.abs(layer.width - cell.w) <= SLOT_EPSILON &&
    Math.abs(layer.height - cell.h) <= SLOT_EPSILON
  );
}

export interface LiveGrid {
  grid: SlideGrid;
  template: GridTemplate;
  liveSlots: number;
  movedSlots: number;
}

/** The slide's grid if it is still meaningful: known template and at least one slot still on the slide. */
export function getLiveGrid(doc: ProjectDocumentV2, slideId: string): LiveGrid | null {
  const slide = doc.slides[slideId];
  const grid = slide?.grid;
  if (!slide || !grid) return null;
  const template = GRID_TEMPLATES.find((t) => t.id === grid.templateId);
  if (!template) return null;
  const onSlide = new Set(slide.layerOrder);
  const cells = layoutGrid(template, doc.format, grid.gap, grid.margin);
  let liveSlots = 0;
  let movedSlots = 0;
  grid.slotIds.forEach((id, i) => {
    const layer = doc.layers[id];
    if (!layer || !onSlide.has(id) || !cells[i]) return;
    liveSlots++;
    if (!slotMatchesCell(layer, cells[i])) movedSlots++;
  });
  return liveSlots > 0 ? { grid, template, liveSlots, movedSlots } : null;
}

/**
 * Re-lays out one slide's grid inside an Immer draft. Only slots still on their old computed cell move;
 * hand-moved slots and every other layer are left alone. `live` must come from the document the draft started from.
 */
export function relayoutSlideGrid(
  draft: Draft<ProjectDocumentV2>,
  slideId: string,
  live: LiveGrid,
  format: { width: number; height: number },
  gap: number,
  margin: number,
): void {
  const slide = draft.slides[slideId];
  const grid = slide?.grid;
  if (!slide || !grid) return;
  const oldCells = layoutGrid(live.template, format, live.grid.gap, live.grid.margin);
  const newCells = layoutGrid(live.template, format, gap, margin);
  grid.slotIds.forEach((id, i) => {
    const layer = draft.layers[id];
    if (!layer || !slide.layerOrder.includes(id) || !oldCells[i] || !newCells[i]) return;
    if (!slotMatchesCell(layer, oldCells[i])) return;
    const c = newCells[i];
    layer.x = c.x;
    layer.y = c.y;
    layer.width = c.w;
    layer.height = c.h;
  });
  grid.gap = gap;
  grid.margin = margin;
}
