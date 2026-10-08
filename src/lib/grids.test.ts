import { describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, MAX_GRID_INSET, MIN_CELL, layoutGrid, linkedMax, maxGapFor, maxMargin } from './grids';

const portrait = { width: 1080, height: 1350 };
const landscape = { width: 1080, height: 566 };
const tpl = (id: string) => GRID_TEMPLATES.find((t) => t.id === id)!;

describe('layoutGrid', () => {
  it('with margin 0 reproduces the template cells exactly', () => {
    for (const t of GRID_TEMPLATES) for (const gap of [0, 24]) {
      expect(layoutGrid(t, portrait, gap, 0)).toEqual(t.cells(portrait.width, portrait.height, gap));
    }
  });

  it('insets a single-cell template on every side', () => {
    expect(layoutGrid(tpl('single'), portrait, 0, 40)).toEqual([{ x: 40, y: 40, w: 1000, h: 1270 }]);
  });

  it('keeps every cell inside the margin rectangle', () => {
    for (const t of GRID_TEMPLATES) for (const c of layoutGrid(t, portrait, 20, 50)) {
      expect(c.x).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(c.y).toBeGreaterThanOrEqual(50 - 1e-6);
      expect(c.x + c.w).toBeLessThanOrEqual(portrait.width - 50 + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(portrait.height - 50 + 1e-6);
    }
  });

  it('never produces a cell under the minimum size, even at maximum gap and margin on the shortest format', () => {
    for (const t of GRID_TEMPLATES) for (const c of layoutGrid(t, landscape, 120, 120)) {
      expect(Number.isFinite(c.w) && Number.isFinite(c.h)).toBe(true);
      expect(c.w).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
      expect(c.h).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
  });
});

describe('limits', () => {
  it('caps the margin at a quarter of the shorter side or 120', () => {
    expect(maxMargin(1080, 566)).toBe(120);
    expect(maxMargin(200, 200)).toBe(50);
  });

  it('maxGapFor never exceeds 120 and its layout needs no further clamping', () => {
    for (const t of GRID_TEMPLATES) {
      const max = maxGapFor(t, landscape, 120);
      expect(max).toBeLessThanOrEqual(120);
      expect(max).toBeGreaterThanOrEqual(0);
      const side = Math.min(...layoutGrid(t, landscape, max, 120).flatMap((c) => [c.w, c.h]));
      expect(side).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
  });

  it('caps an out-of-range requested gap at 120 and never flips or overlaps cells', () => {
    const cells = layoutGrid(tpl('nine-grid'), portrait, 600, 0);
    for (const c of cells) {
      expect(c.w).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
      expect(c.h).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
    for (let i = 1; i < cells.length; i++) {
      if (cells[i].y === cells[i - 1].y) expect(cells[i].x).toBeGreaterThanOrEqual(cells[i - 1].x + cells[i - 1].w - 1e-6);
    }
    expect(cells).toEqual(layoutGrid(tpl('nine-grid'), portrait, 120, 0));
  });
});

describe('linkedMax', () => {
  it('is the largest whole value that both the gap and the margin can take at once', () => {
    for (const format of [portrait, landscape]) for (const t of GRID_TEMPLATES) {
      const v = linkedMax(t, format);
      const cap = Math.min(MAX_GRID_INSET, maxMargin(format.width, format.height));
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(cap);
      expect(maxGapFor(t, format, v)).toBeGreaterThanOrEqual(v);
      if (v < cap) expect(maxGapFor(t, format, v + 1)).toBeLessThan(v + 1);
    }
  });

  it('reaches the full 120 when cells are roomy, and a laid-out linked pair needs no clamping', () => {
    expect(linkedMax(tpl('four-grid'), portrait)).toBe(120);
    for (const t of GRID_TEMPLATES) {
      const v = linkedMax(t, landscape);
      const side = Math.min(...layoutGrid(t, landscape, v, v).flatMap((c) => [c.w, c.h]));
      expect(side).toBeGreaterThanOrEqual(MIN_CELL - 1e-6);
    }
  });
});
