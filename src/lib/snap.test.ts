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
