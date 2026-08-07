import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnimatedGifCanvas,
  seekAnimatedGifCanvas,
  setAnimatedGifCanvasPlaying,
  stopAnimatedGifCanvas,
} from './gif';

vi.mock('gifuct-js', () => ({
  parseGIF: vi.fn(() => ({})),
  decompressFrames: vi.fn(() => Array.from({ length: 3 }, (_, index) => ({
    dims: { left: 0, top: 0, width: 1, height: 1 },
    patch: new Uint8ClampedArray([index, 0, 0, 255]),
    delay: 100,
    disposalType: 0,
  }))),
}));

describe('GIF playback control', () => {
  let context: CanvasRenderingContext2D;

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
    context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
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

  it('uses a constant number of canvases and seeks without playback timers', async () => {
    const createElement = vi.spyOn(document, 'createElement');
    const canvas = await createAnimatedGifCanvas(new Blob(['gif']), 1, 1, false);

    expect(createElement.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(2);
    expect(context.drawImage).toHaveBeenCalledTimes(1);

    seekAnimatedGifCanvas(canvas, 0.15);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    seekAnimatedGifCanvas(canvas, 0.05);
    expect(context.drawImage).toHaveBeenCalledTimes(3);
    stopAnimatedGifCanvas(canvas);
  });
});
