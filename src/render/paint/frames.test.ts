import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '@/types';
import { photoWindow, photoPlacement } from './frames';
import { imageCrop } from './layers';
const photo: ImageLayer = { id: 'photo', name: 'Photo', kind: 'image', assetId: 'original', x: 100, y: 200, width: 600, height: 800, rotation: 0, opacity: 1, visible: true, locked: false, cornerRadius: 0, cropScale: 1, cropOffsetX: 0, cropOffsetY: 0, strokeWidth: 40, frameStyle: 'polaroid' };
describe('decorative frame geometry', () => {
  it('fits the crop to the opening with an asymmetric Polaroid bottom mat', () => {
    const opening = photoWindow(photo);
    expect(opening).toEqual({ x: 40, y: 40, width: 520, height: 632 });
    expect(imageCrop(photo, 4000, 3000).width / imageCrop(photo, 4000, 3000).height).toBeCloseTo(opening.width / opening.height);
  });
  it('rotates the inset about the outer frame center for HDR placement', () => {
    const rotated = { ...photo, rotation: 90 };
    expect(photoPlacement(rotated, 1080)).toEqual({ x: 1264, y: 284, width: 520, height: 632 });
  });
  it('leaves legacy borders unchanged and clamps large frames to a usable opening', () => {
    expect(photoWindow({ ...photo, frameStyle: undefined })).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(photoWindow({ ...photo, strokeWidth: 10000 }).height).toBeGreaterThan(0);
    expect(photoWindow({ ...photo, strokeWidth: 0 })).toEqual({ x: 0, y: 0, width: 600, height: 800 });
  });
});
