import { describe, expect, it } from 'vitest';
import {
  applyAlphaMask,
  canRemoveBackground,
  cutoutFileName,
  fitWithinMaxEdge,
  imageDataToNchwTensor,
  normalizeMask,
  U2NET_SIZE,
} from './backgroundRemoval';

if (typeof ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb' as const;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }
  Object.defineProperty(globalThis, 'ImageData', { value: ImageDataPolyfill });
}

describe('background removal helpers', () => {
  it('allows still photos and rejects animated media', () => {
    expect(canRemoveBackground({ mime: 'image/jpeg', mediaKind: 'image' })).toBe(true);
    expect(canRemoveBackground({ mime: 'image/gif', mediaKind: 'gif' })).toBe(false);
    expect(canRemoveBackground({ mime: 'video/mp4', mediaKind: 'video' })).toBe(false);
    expect(canRemoveBackground(undefined)).toBe(false);
  });

  it('names the cutout from the original file', () => {
    expect(cutoutFileName('portrait.HEIC')).toBe('portrait-cutout.png');
    expect(cutoutFileName('')).toBe('photo-cutout.png');
  });

  it('builds a CHW ImageNet tensor from a square image', () => {
    const image = new ImageData(U2NET_SIZE, U2NET_SIZE);
    image.data[0] = 255;
    image.data[1] = 0;
    image.data[2] = 0;
    image.data[3] = 255;
    const tensor = imageDataToNchwTensor(image);
    expect(tensor).toHaveLength(3 * U2NET_SIZE * U2NET_SIZE);
    expect(tensor[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(tensor[U2NET_SIZE * U2NET_SIZE]).toBeCloseTo((0 - 0.456) / 0.224, 5);
  });

  it('stretches a 2×2 mask onto a larger photo and writes alpha', () => {
    const image = new ImageData(4, 2);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 10;
      image.data[i + 1] = 20;
      image.data[i + 2] = 30;
      image.data[i + 3] = 255;
    }
    const mask = Float32Array.from([0, 1, 0, 1]);
    const out = applyAlphaMask(image, mask, 2, 2);
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBeGreaterThan(0);
    expect(out.data[0]).toBe(10);
  });

  it('normalizes raw model scores into a 0–1 mask', () => {
    const mask = normalizeMask(Float32Array.from([-2, 0, 6]));
    expect(mask[0]).toBe(0);
    expect(mask[2]).toBe(1);
    expect(mask[1]).toBeGreaterThan(0);
    expect(mask[1]).toBeLessThan(1);
  });

  it('caps very large photos before cutout encoding', () => {
    expect(fitWithinMaxEdge(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithinMaxEdge(8192, 4096)).toEqual({ width: 4096, height: 2048 });
  });
});
