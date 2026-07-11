import { describe, expect, it } from 'vitest';
import { findCrossedSlideSeams } from './slideSeams';

describe('slide seam overlays', () => {
  it('returns only boundaries crossed by a resized layer', () => {
    expect(findCrossedSlideSeams({ x: 90, y: 0, width: 130, height: 50 }, 100, 4)).toEqual([100, 200]);
  });

  it('does not flag an edge that only touches a boundary', () => {
    expect(findCrossedSlideSeams({ x: 20, y: 0, width: 80, height: 50 }, 100, 3)).toEqual([]);
  });

  it('handles layers positioned from right to left', () => {
    expect(findCrossedSlideSeams({ x: 210, y: 0, width: -120, height: 50 }, 100, 3)).toEqual([100, 200]);
  });
});
