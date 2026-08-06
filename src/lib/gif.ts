import { decompressFrames, parseGIF } from 'gifuct-js';

const cleanupByCanvas = new WeakMap<HTMLCanvasElement, () => void>();

function copyCanvas(source: HTMLCanvasElement) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  return copy;
}

export async function createAnimatedGifCanvas(
  blob: Blob,
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  const parsed = parseGIF(await blob.arrayBuffer());
  const decoded = decompressFrames(parsed, true);
  if (decoded.length === 0) throw new Error('The GIF contains no frames.');

  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const context = composite.getContext('2d');
  if (!context) throw new Error('Could not create a GIF canvas.');

  const frames: { canvas: HTMLCanvasElement; delay: number }[] = [];
  let previousFrame: (typeof decoded)[number] | undefined;
  let restoreImage: ImageData | undefined;

  for (const frame of decoded) {
    if (previousFrame?.disposalType === 2) {
      const d = previousFrame.dims;
      context.clearRect(d.left, d.top, d.width, d.height);
    } else if (previousFrame?.disposalType === 3 && restoreImage) {
      context.putImageData(restoreImage, 0, 0);
    }

    restoreImage = frame.disposalType === 3
      ? context.getImageData(0, 0, composite.width, composite.height)
      : undefined;
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const pixels = new Uint8ClampedArray(frame.patch.length);
    pixels.set(frame.patch);
    patchCanvas.getContext('2d')?.putImageData(
      new ImageData(pixels, frame.dims.width, frame.dims.height),
      0,
      0,
    );
    context.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    frames.push({ canvas: copyCanvas(composite), delay: Math.max(20, frame.delay || 100) });
    previousFrame = frame;
  }

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Could not create an animated GIF canvas.');

  let stopped = false;
  let timer = 0;
  let frameIndex = 0;
  const drawNext = () => {
    if (stopped) return;
    const frame = frames[frameIndex];
    outputContext.clearRect(0, 0, output.width, output.height);
    outputContext.drawImage(frame.canvas, 0, 0);
    frameIndex = (frameIndex + 1) % frames.length;
    timer = window.setTimeout(drawNext, frame.delay);
  };
  drawNext();
  cleanupByCanvas.set(output, () => {
    stopped = true;
    window.clearTimeout(timer);
    frames.length = 0;
  });
  return output;
}

export function stopAnimatedGifCanvas(canvas: HTMLCanvasElement) {
  cleanupByCanvas.get(canvas)?.();
  cleanupByCanvas.delete(canvas);
}
