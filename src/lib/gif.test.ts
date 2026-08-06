import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimatedGifCanvas,
  setAnimatedGifCanvasPlaying,
  stopAnimatedGifCanvas,
} from './gif';

vi.mock('gifuct-js', () => ({
  parseGIF: vi.fn(() => ({})),
  decompressFrames: vi.fn(() => [{
    dims: { left: 0, top: 0, width: 1, height: 1 },
    patch: new Uint8ClampedArray([0, 0, 0, 255]),
    delay: 100,
    disposalType: 0,
  }]),
}));

describe('GIF playback control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ImageData', class {
      data: Uint8ClampedArray;
      width: number;
      height: number;

      constructor(
        data: Uint8ClampedArray,
        width: number,
        height: number,
      ) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not schedule animation until playback is explicitly enabled', async () => {
    const canvas = await createAnimatedGifCanvas(new Blob(['gif']), 1, 1, false);
    expect(vi.getTimerCount()).toBe(0);

    setAnimatedGifCanvasPlaying(canvas, true, true);
    expect(vi.getTimerCount()).toBe(1);

    setAnimatedGifCanvasPlaying(canvas, false, true);
    expect(vi.getTimerCount()).toBe(0);
    stopAnimatedGifCanvas(canvas);
  });
});
