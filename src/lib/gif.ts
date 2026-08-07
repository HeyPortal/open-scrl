import { decompressFrames, parseGIF } from 'gifuct-js';

interface GifPlaybackController {
  play: (restart?: boolean) => void;
  pause: (reset?: boolean) => void;
  seek: (timeSeconds: number) => void;
  stop: () => void;
}

const playbackByCanvas = new WeakMap<HTMLCanvasElement, GifPlaybackController>();

export async function createAnimatedGifCanvas(
  blob: Blob,
  width: number,
  height: number,
  autoPlay = true,
): Promise<HTMLCanvasElement> {
  const parsed = parseGIF(await blob.arrayBuffer());
  const frames = decompressFrames(parsed, true);
  if (frames.length === 0) throw new Error('The GIF contains no frames.');

  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Could not create an animated GIF canvas.');

  // A single reusable patch surface keeps playback memory bounded. Previous
  // versions retained one full-resolution canvas for every GIF frame.
  const patchCanvas = document.createElement('canvas');
  const patchContext = patchCanvas.getContext('2d');
  if (!patchContext) throw new Error('Could not create a GIF patch canvas.');

  const frameEnds: number[] = [];
  let totalDuration = 0;
  for (const frame of frames) {
    totalDuration += Math.max(20, frame.delay || 100);
    frameEnds.push(totalDuration);
  }

  let stopped = false;
  let playing = false;
  let timer = 0;
  let currentIndex = -1;
  let currentCycle = -1;
  let restoreImage: ImageData | undefined;

  const clear = () => {
    outputContext.clearRect(0, 0, output.width, output.height);
    currentIndex = -1;
    restoreImage = undefined;
  };

  const disposeCurrent = () => {
    if (currentIndex < 0) return;
    const current = frames[currentIndex];
    if (current.disposalType === 2) {
      outputContext.clearRect(
        current.dims.left,
        current.dims.top,
        current.dims.width,
        current.dims.height,
      );
    } else if (current.disposalType === 3 && restoreImage) {
      outputContext.putImageData(restoreImage, 0, 0);
    }
    restoreImage = undefined;
  };

  const drawFrame = (index: number) => {
    const frame = frames[index];
    disposeCurrent();
    restoreImage = frame.disposalType === 3
      ? outputContext.getImageData(0, 0, output.width, output.height)
      : undefined;

    if (patchCanvas.width !== frame.dims.width) patchCanvas.width = frame.dims.width;
    if (patchCanvas.height !== frame.dims.height) patchCanvas.height = frame.dims.height;
    patchContext.clearRect(0, 0, patchCanvas.width, patchCanvas.height);
    const pixels = new Uint8ClampedArray(frame.patch.length);
    pixels.set(frame.patch);
    patchContext.putImageData(
      new ImageData(pixels, frame.dims.width, frame.dims.height),
      0,
      0,
    );
    outputContext.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
    currentIndex = index;
  };

  const drawThrough = (targetIndex: number) => {
    while (currentIndex < targetIndex) drawFrame(currentIndex + 1);
  };

  const resetToFirstFrame = () => {
    clear();
    currentCycle = 0;
    drawFrame(0);
  };

  const scheduleNext = () => {
    if (stopped || !playing || currentIndex < 0) return;
    const delay = Math.max(20, frames[currentIndex].delay || 100);
    timer = window.setTimeout(() => {
      if (currentIndex >= frames.length - 1) {
        clear();
        currentCycle += 1;
      }
      drawFrame(currentIndex + 1);
      scheduleNext();
    }, delay);
  };

  const controller: GifPlaybackController = {
    play: (restart = false) => {
      if (stopped || (playing && !restart)) return;
      window.clearTimeout(timer);
      if (restart || currentIndex < 0) resetToFirstFrame();
      playing = true;
      scheduleNext();
    },
    pause: (reset = false) => {
      if (stopped) return;
      playing = false;
      window.clearTimeout(timer);
      if (reset) resetToFirstFrame();
    },
    seek: (timeSeconds) => {
      if (stopped) return;
      playing = false;
      window.clearTimeout(timer);
      const elapsed = Math.max(0, timeSeconds * 1000);
      const cycle = totalDuration > 0 ? Math.floor(elapsed / totalDuration) : 0;
      const withinCycle = totalDuration > 0 ? elapsed % totalDuration : 0;
      const targetIndex = Math.max(0, frameEnds.findIndex((end) => withinCycle < end));
      if (cycle !== currentCycle || targetIndex < currentIndex) {
        clear();
        currentCycle = cycle;
      }
      drawThrough(targetIndex);
    },
    stop: () => {
      stopped = true;
      playing = false;
      window.clearTimeout(timer);
      clear();
      frames.length = 0;
      patchCanvas.width = 1;
      patchCanvas.height = 1;
    },
  };

  playbackByCanvas.set(output, controller);
  if (autoPlay) controller.play(true);
  else controller.pause(true);
  return output;
}

export function setAnimatedGifCanvasPlaying(
  canvas: HTMLCanvasElement,
  playing: boolean,
  restart = false,
) {
  const controller = playbackByCanvas.get(canvas);
  if (playing) controller?.play(restart);
  else controller?.pause(restart);
}

export function seekAnimatedGifCanvas(canvas: HTMLCanvasElement, timeSeconds: number) {
  playbackByCanvas.get(canvas)?.seek(timeSeconds);
}

export function stopAnimatedGifCanvas(canvas: HTMLCanvasElement) {
  playbackByCanvas.get(canvas)?.stop();
  playbackByCanvas.delete(canvas);
}
