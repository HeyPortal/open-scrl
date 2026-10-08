import { describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, layoutGrid } from '@/lib/grids';
import type { ImageLayer, ProjectDocumentV2 } from '@/types';
import { newDocument } from '@/editor/documentStore';
import { getLiveGrid, hasLinkedSpacing, slotMatchesCell } from './grid';

const template = GRID_TEMPLATES.find((t) => t.id === 'four-grid')!;

function docWithGrid(gap = 10, margin = 0): ProjectDocumentV2 {
  const doc = newDocument();
  const slideId = doc.slideOrder[0];
  const cells = layoutGrid(template, doc.format, gap, margin);
  const slotIds = cells.map((_, i) => `slot${i}`);
  cells.forEach((c, i) => {
    doc.layers[slotIds[i]] = { id: slotIds[i], kind: 'image', name: `Photo ${i + 1}`, x: c.x, y: c.y, width: c.w, height: c.h, rotation: 0, opacity: 1, visible: true, locked: true, assetId: null, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 } as ImageLayer;
  });
  doc.slides[slideId].layerOrder = [...slotIds];
  doc.slides[slideId].grid = { templateId: template.id, gap, margin, slotIds };
  return doc;
}

describe('slotMatchesCell', () => {
  it('tolerates half a pixel and nothing more', () => {
    const cell = { x: 10, y: 20, w: 100, h: 200 };
    expect(slotMatchesCell({ x: 10.4, y: 20, width: 100, height: 200 }, cell)).toBe(true);
    expect(slotMatchesCell({ x: 10.6, y: 20, width: 100, height: 200 }, cell)).toBe(false);
  });
});

describe('getLiveGrid', () => {
  it('is null for a slide without a grid', () => {
    const doc = newDocument();
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });

  it('counts live and hand-moved slots', () => {
    const doc = docWithGrid();
    doc.layers.slot2.x += 30;
    const live = getLiveGrid(doc, doc.slideOrder[0])!;
    expect(live.template.id).toBe('four-grid');
    expect(live.liveSlots).toBe(4);
    expect(live.movedSlots).toBe(1);
  });

  it('ignores slots that were deleted and goes null when none remain', () => {
    const doc = docWithGrid();
    const slide = doc.slides[doc.slideOrder[0]];
    slide.layerOrder = slide.layerOrder.filter((id) => id !== 'slot1');
    expect(getLiveGrid(doc, doc.slideOrder[0])!.liveSlots).toBe(3);
    slide.layerOrder = [];
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });

  it('is null for a template id this build does not know', () => {
    const doc = docWithGrid();
    doc.slides[doc.slideOrder[0]].grid!.templateId = 'from-the-future';
    expect(getLiveGrid(doc, doc.slideOrder[0])).toBeNull();
  });
});

describe('hasLinkedSpacing', () => {
  it('is true only when gap and margin are equal', () => {
    const doc = docWithGrid(20, 20);
    expect(hasLinkedSpacing(getLiveGrid(doc, doc.slideOrder[0])!, doc.format)).toBe(true);
    const unequal = docWithGrid(20, 0);
    expect(hasLinkedSpacing(getLiveGrid(unequal, unequal.slideOrder[0])!, unequal.format)).toBe(false);
  });

  it('is false when equal spacing is more than the template fits', () => {
    const doc = docWithGrid(20, 20);
    const live = getLiveGrid(doc, doc.slideOrder[0])!;
    const fourStack = GRID_TEMPLATES.find((t) => t.id === 'four-stack')!;
    const landscape = { width: 1080, height: 566 };
    // Four stacked rows on a 566 px tall slide fit 100 px of linked spacing, not 120.
    expect(hasLinkedSpacing({ ...live, template: fourStack, grid: { ...live.grid, gap: 100, margin: 100 } }, landscape)).toBe(true);
    expect(hasLinkedSpacing({ ...live, template: fourStack, grid: { ...live.grid, gap: 120, margin: 120 } }, landscape)).toBe(false);
  });
});
