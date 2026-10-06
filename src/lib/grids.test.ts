import { describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, MIN_CELL, layoutGrid, maxGapFor, maxMargin } from './grids';

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
});
