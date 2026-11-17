import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '@/types';
import { snapBox } from './snap';

const photo = (patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id: 'photo', kind: 'image', name: 'Photo', x: 200, y: 100, width: 100, height: 100,
  rotation: 0, opacity: 1, visible: true, locked: false, assetId: 'asset', cornerRadius: 0,
  cropOffsetX: 0, cropOffsetY: 0, cropScale: 1, ...patch,
});

describe('photo snapping', () => {
  it('snaps a photo edge to the canvas edge', () => {
    const result = snapBox({ x: 4, y: 30, width: 100, height: 100 }, [], { width: 500, height: 500 }, 6);
    expect(result.x).toBe(0);
    expect(result.guides.some((guide) => guide.orientation === 'v' && guide.position === 0)).toBe(true);
  });

  it('snaps to the edge of another photo, including locked photos', () => {
    const target = photo({ locked: true });
    const result = snapBox({ x: 96, y: 100, width: 100, height: 100 }, [target], { width: 500, height: 500 }, 6);
    expect(result.x).toBe(100);
    expect(result.guides.some((guide) => guide.orientation === 'v' && guide.position === 200)).toBe(true);
  });

  it('snaps photo centers to one another', () => {
    const result = snapBox({ x: 202, y: 250, width: 100, height: 100 }, [photo()], { width: 500, height: 500 }, 6);
    expect(result.x).toBe(200);
  });
});

describe('equal-spacing snapping', () => {
  const canvas = { width: 1000, height: 1000 };
  const at = (id: string, x: number, width = 100, y = 100, height = 100) => photo({ id, x, y, width, height });
  const sizes = (gaps: { start: number; end: number }[]) => gaps.map((gap) => gap.end - gap.start);

  it('snaps a gap to match another gap and marks both', () => {
    const result = snapBox({ x: 296, y: 120, width: 100, height: 100 }, [at('a', 0), at('b', 150)], canvas, 6);
    expect(result.x).toBe(300);
    expect(result.gaps).toHaveLength(2);
    expect(result.gaps.every((gap) => gap.axis === 'x')).toBe(true);
    expect(result.gaps.map((gap) => [gap.start, gap.end]).sort((a, b) => a[0] - b[0])).toEqual([[100, 150], [250, 300]]);
  });

  it('matches a gap before a neighbour on the right', () => {
    const result = snapBox({ x: 504, y: 100, width: 100, height: 100 }, [at('a', 0), at('b', 150), at('c', 650)], canvas, 6);
    expect(result.x).toBe(500);
    expect(sizes(result.gaps)).toEqual([50, 50]);
  });

  it('centres a box between two neighbours', () => {
    const result = snapBox({ x: 203, y: 100, width: 100, height: 100 }, [at('a', 0), at('b', 400)], canvas, 6);
    expect(result.x).toBe(200);
    expect(sizes(result.gaps)).toEqual([100, 100]);
  });

  it('marks every equal gap on the slide', () => {
    const others = [at('a', 0, 80), at('b', 120, 80), at('c', 240, 80)];
    const result = snapBox({ x: 362, y: 100, width: 80, height: 100 }, others, canvas, 6);
    expect(result.x).toBe(360);
    expect(sizes(result.gaps)).toEqual([40, 40, 40]);
  });

  it('snaps vertical gaps', () => {
    const result = snapBox({ x: 100, y: 303, width: 100, height: 100 }, [at('a', 100, 100, 0), at('b', 100, 100, 150)], canvas, 6);
    expect(result.y).toBe(300);
    expect(result.gaps.map((gap) => gap.axis)).toEqual(['y', 'y']);
  });

  it('ignores gaps outside the threshold and gaps between layers that do not face each other', () => {
    expect(snapBox({ x: 290, y: 100, width: 100, height: 100 }, [at('a', 0), at('b', 150)], canvas, 6).gaps).toEqual([]);
    // b sits lower than the moving box, so the a–b gap is not one of its rows.
    const result = snapBox({ x: 296, y: 600, width: 100, height: 100 }, [at('a', 0, 100, 600), at('b', 150, 100, 100)], canvas, 6);
    expect(result.x).toBe(296);
    expect(result.gaps).toEqual([]);
  });

  it('prefers a closer alignment snap and keeps its guide', () => {
    // Left edge 2px from c's left edge; the equal gap would need a 4px move.
    const result = snapBox({ x: 296, y: 400, width: 100, height: 100 }, [at('a', 0), at('b', 150), at('c', 298, 100, 600)], canvas, 6);
    expect(result.x).toBe(298);
    expect(result.gaps).toEqual([]);
    expect(result.guides.some((guide) => guide.orientation === 'v' && guide.position === 298)).toBe(true);
  });

  it('matches a gap from another row on the slide', () => {
    // The 60px gap lives in a row below; the moving box's row only has its neighbour a.
    const others = [at('a', 0, 100, 100), at('b', 0, 100, 500), at('c', 160, 100, 500)];
    const result = snapBox({ x: 157, y: 100, width: 100, height: 100 }, others, canvas, 6);
    expect(result.x).toBe(160);
    const across = result.gaps.filter((gap) => gap.axis === 'x');
    expect(sizes(across)).toEqual([60, 60]);
    expect(across.map((gap) => gap.position).sort((x, y) => x - y)).toEqual([150, 550]);
    // The columns are also evenly stacked: a above b matches the box above c.
    expect(sizes(result.gaps.filter((gap) => gap.axis === 'y'))).toEqual([300, 300]);
  });

  it('measures a seam-spanning layer by its portion on the slide', () => {
    // b and c live past the right edge of the slide, so the 100px gap between them does not count.
    const others = [at('a', 0), at('b', 1050), at('c', 1250)];
    expect(snapBox({ x: 196, y: 100, width: 100, height: 100 }, others, canvas, 6).x).toBe(196);
    // A layer over the seam counts by its on-slide part.
    const spanning = [at('a', 0), at('b', 150), at('d', 950, 200)];
    const result = snapBox({ x: 803, y: 100, width: 100, height: 100 }, spanning, canvas, 6);
    expect(result.x).toBe(800);
    expect(sizes(result.gaps)).toEqual([50, 50]);
  });

  it('moves only the resized edge to match a gap', () => {
    const result = snapBox({ x: 300, y: 100, width: 147, height: 100 }, [at('a', 0), at('b', 150), at('c', 500)], canvas, 6, { edges: { x: 'end' } });
    expect(result.x + 147).toBe(450);
    expect(result.gaps.length).toBeGreaterThanOrEqual(2);
  });

  it('resizes an edge to centre between neighbours', () => {
    // 50px gap on the fixed left side; the right edge snaps to leave 50px before c.
    const result = snapBox({ x: 300, y: 100, width: 102, height: 100 }, [at('a', 150), at('c', 450)], canvas, 6, { edges: { x: 'end' } });
    expect(result.x + 102).toBe(400);
    expect(sizes(result.gaps)).toEqual([50, 50]);
  });
});
