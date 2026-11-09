import { paintBackground, paintLayer, type PaintMedia } from '@/render/paint/layers';
import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, Muxer } from 'mp4-muxer';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import type { Asset, Layer, ProjectDocumentV2 } from '@/types';
import { getAsset, getAssetMetadata } from '@/lib/assets';
import { getMediaKind } from '@/lib/media';
import { createTemporaryExportFile } from '@/storage/exportTemp';
import { frameTime, frameTimestamp, loopedSourceTime } from './timeline';
import { loadInterFonts } from '@/render/fonts/inter';
import { ensureLayerFonts } from '@/render/fonts/families';
import {
  createAnimatedGifCanvas,
  seekAnimatedGifCanvas,
  stopAnimatedGifCanvas,
} from '@/lib/gif';

const PREFERRED_FPS = 60;
const FALLBACK_FPS = 30;
const DEFAULT_SLIDE_DURATION = 3;
const MAX_SLIDE_DURATION = 60;
const MAX_ENCODE_QUEUE = 4;
const PROGRESS_INTERVAL_MS = 100;
const SEEK_TIMEOUT_MS = 5000;

/**
 * Media drawn into an MP4 frame. Animated sources are positioned at an exact
 * slide time before each frame is painted, so the export never depends on how
 * fast the device can play, decode or encode in real time.
 */
interface FrameMedia {
  media: () => PaintMedia | null;
  seek?: (timeSeconds: number) => Promise<void> | void;
  release: () => void;
}

function staticImage(bitmap: ImageBitmap): FrameMedia {
  const media = { source: bitmap, width: bitmap.width, height: bitmap.height };
  return { media: () => media, release: () => bitmap.close() };
}

function animatedGif(canvas: HTMLCanvasElement): FrameMedia {
  const media = { source: canvas, width: canvas.width, height: canvas.height };
  return {
    media: () => media,
    seek: (timeSeconds) => seekAnimatedGifCanvas(canvas, timeSeconds),
    release: () => stopAnimatedGifCanvas(canvas),
  };
}

/**
 * Decodes video frames with WebCodecs for the export's fixed frame times;
 * returns undefined when this browser can't demux or decode the track.
 */
async function decodedVideo(blob: Blob, frameTimes: readonly number[]): Promise<FrameMedia | undefined> {
  let input: import('mediabunny').Input | undefined;
  try {
    // Loaded only when a video slide is exported; the importer accepts MP4, MOV, M4V and WebM.
    const { BlobSource, CanvasSink, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
    input = new Input({ source: new BlobSource(blob), formats: [MP4, QTFF, WEBM, MATROSKA] });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('Unsupported video track.');
    const first = await track.getFirstTimestamp();
    const period = (await track.computeDuration()) - first;
    const width = await track.getDisplayWidth();
    const height = await track.getDisplayHeight();
    // Canvases default to the track's display size, with rotation applied.
    const sink = new CanvasSink(track, { poolSize: 2, alpha: await track.canBeTransparent() });
    // The sink reads these ahead of rendering and decodes each packet once per
    // loop, yielding one frame per export frame in the same order.
    const frames = sink.canvasesAtTimestamps(frameTimes.map((time) => first + loopedSourceTime(time, period)));
    const owner = input;
    let media: PaintMedia | null = null;
    return {
      media: () => media,
      seek: async () => {
        const next = await frames.next();
        if (!next.done && next.value) media = { source: next.value.canvas as CanvasImageSource, width, height };
      },
      release: () => {
        void frames.return(undefined);
        owner.dispose();
      },
    };
  } catch (error) {
    // Seeking is far slower, so make an unexpected fallback visible.
    console.warn('Could not decode this video with WebCodecs; seeking its frames instead.', error);
    input?.dispose();
    return undefined;
  }
}

/** Fallback for containers or codecs WebCodecs can't read: seek a media element to each frame time. */
async function seekedVideo(blob: Blob): Promise<FrameMedia> {
  const url = URL.createObjectURL(blob);
  const value = document.createElement('video');
  value.muted = true;
  value.playsInline = true;
  value.preload = 'auto';
  value.src = url;
  const release = () => {
    value.removeAttribute('src');
    value.load();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      value.onloadeddata = () => resolve();
      value.onerror = () => reject(new Error('This browser could not decode an imported video.'));
    });
  } catch (error) {
    release();
    throw error;
  }
  const media = { source: value, width: value.videoWidth, height: value.videoHeight };
  return {
    media: () => media,
    seek: async (timeSeconds) => {
      const time = loopedSourceTime(timeSeconds, value.duration);
      if (Math.abs(value.currentTime - time) < 1e-4 && !value.seeking) return;
      await new Promise<void>((resolve) => {
        const done = () => { window.clearTimeout(timer); value.removeEventListener('seeked', done); resolve(); };
        const timer = window.setTimeout(done, SEEK_TIMEOUT_MS);
        value.addEventListener('seeked', done);
        value.currentTime = time;
      });
    },
    release,
  };
}

async function frameMedia(asset: Asset, frameTimes: readonly number[]): Promise<FrameMedia> {
  const kind = getMediaKind(asset);
  if (kind === 'video') return (await decodedVideo(asset.blob, frameTimes)) ?? seekedVideo(asset.blob);
  if (kind === 'gif') return animatedGif(await createAnimatedGifCanvas(asset.blob, asset.width, asset.height, false));
  return staticImage(await createImageBitmap(asset.blob));
}

/** Builds a 1x slide painter; MP4 frames are opaque, so transparent slides are flattened onto white. */
async function prepareSlide(project: ProjectDocumentV2, slideId: string, frameTimes: readonly number[]) {
  const targetIndex = project.slideOrder.indexOf(slideId);
  const slide = project.slides[slideId];
  const viewport = getSlideViewport(project, slideId);
  if (targetIndex < 0 || !slide || !viewport) throw new Error('The selected slide no longer exists.');
  const { width, height } = project.format;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas is unavailable.');

  const sources: FrameMedia[] = [];
  const items: { layer: Layer; offsetX: number; media?: FrameMedia }[] = [];
  try {
    const background = slide.background;
    const backgroundAsset = background.kind === 'image' && background.assetId ? await getAsset(background.assetId) : undefined;
    const backgroundImage = backgroundAsset ? await createImageBitmap(backgroundAsset.blob).catch(() => undefined) : undefined;
    if (backgroundImage) sources.push(staticImage(backgroundImage));
    const backgroundMedia = backgroundImage && background.kind === 'image'
      ? { source: backgroundImage, width: backgroundImage.width, height: backgroundImage.height, key: background.assetId ?? '' }
      : null;

    // Repeated placements share one timeline and decoder. Advance and release
    // each asset once, while painting every placement with its own geometry.
    const mediaByAsset = new Map<string, FrameMedia>();
    for (const sceneItem of compileScene(project, viewport)) {
      const offsetX = (project.slideOrder.indexOf(sceneItem.slideId) - targetIndex) * width;
      const { layer } = sceneItem;
      if (layer.kind !== 'image') {
        items.push({ layer, offsetX });
        continue;
      }
      if (!layer.assetId) continue;
      let media = mediaByAsset.get(layer.assetId);
      if (!media) {
        const asset = await getAsset(layer.assetId);
        if (!asset) continue;
        media = await frameMedia(asset, frameTimes);
        mediaByAsset.set(layer.assetId, media);
        sources.push(media);
      }
      items.push({ layer, offsetX, media });
    }

    return {
      canvas,
      /** Advances every animated source to the next frame time, in order, then paints the slide. */
      render: async (timeSeconds: number) => {
        await Promise.all(sources.map((source) => source.seek?.(timeSeconds)));
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        paintBackground(ctx, background, width, height, backgroundMedia);
        ctx.restore();
        for (const item of items) {
          const media = item.media?.media();
          if (item.media && !media) continue;
          paintLayer(ctx, item.layer, item.offsetX, media);
        }
      },
      destroy: () => sources.forEach((source) => source.release()),
    };
  } catch (error) {
    sources.forEach((source) => source.release());
    throw error;
  }
}

export async function inspectSlideVideo(project: ProjectDocumentV2, slideId: string) {
  const viewport = getSlideViewport(project, slideId);
  if (!viewport) throw new Error('A slide no longer exists.');
  let duration = DEFAULT_SLIDE_DURATION;
  let animated = false;
  for (const { layer } of compileScene(project, viewport)) {
    if (layer.kind !== 'image' || !layer.assetId) continue;
    const asset = await getAssetMetadata(layer.assetId);
    if (!asset || getMediaKind(asset) === 'image') continue;
    animated = true;
    duration = Math.max(duration, asset.duration || 0);
  }
  return { animated, duration: Math.min(MAX_SLIDE_DURATION, duration) };
}

/** Applies backpressure without flushing, which would stall the encoder pipeline. */
async function waitForEncoder(encoder: VideoEncoder) {
  while (encoder.state === 'configured' && encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
    await new Promise<void>((resolve) => {
      const done = () => { window.clearTimeout(timer); encoder.removeEventListener('dequeue', done); resolve(); };
      const timer = window.setTimeout(done, 50);
      encoder.addEventListener('dequeue', done);
    });
  }
}

export interface RenderedSlideVideo {
  blob: Blob;
  release: () => Promise<void>;
}

async function createVideoOutput(preferTemporary: boolean) {
  const temporary = preferTemporary ? await createTemporaryExportFile('mp4') : undefined;
  if (temporary && typeof FileSystemWritableFileStream !== 'undefined') {
    return {
      target: new FileSystemWritableFileStreamTarget(temporary.writable),
      complete: async (): Promise<RenderedSlideVideo> => {
        await temporary.close();
        return { blob: await temporary.getFile(), release: temporary.remove };
      },
      abort: async (reason?: unknown) => {
        await temporary.abort(reason);
        await temporary.remove();
      },
    };
  }
  await temporary?.remove();
  const target = new ArrayBufferTarget();
  return {
    target,
    complete: async (): Promise<RenderedSlideVideo> => ({
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      release: async () => undefined,
    }),
    abort: async () => undefined,
  };
}

function encoderConfig(project: ProjectDocumentV2, codec: string, fps: number, hardwareAcceleration: HardwareAcceleration): VideoEncoderConfig {
  const pixelsPerSecond = project.format.width * project.format.height * fps;
  const bitrate = Math.min(50_000_000, Math.max(fps === PREFERRED_FPS ? 20_000_000 : 12_000_000, Math.round(pixelsPerSecond * .28)));
  return {
    codec,
    width: project.format.width,
    height: project.format.height,
    bitrate,
    bitrateMode: 'variable',
    framerate: fps,
    hardwareAcceleration,
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
}

async function bestSupportedConfig(project: ProjectDocumentV2) {
  // Prefer High Profile H.264 at 60 fps. Main/Baseline and 30 fps remain
  // compatibility fallbacks for devices with more limited encoders. Chromium
  // treats 'prefer-hardware' as a requirement, so devices without a suitable
  // hardware encoder (or one capped below the canvas size) use software.
  for (const acceleration of ['prefer-hardware', 'no-preference'] as const) {
    for (const fps of [PREFERRED_FPS, FALLBACK_FPS]) {
      for (const codec of ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a']) {
        const candidate = encoderConfig(project, codec, fps, acceleration);
        try {
          const support = await VideoEncoder.isConfigSupported(candidate);
          if (support.supported) return { config: support.config ?? candidate, fps };
        } catch {
          // Try the next standards-compatible profile.
        }
      }
    }
  }
  throw new Error('This device cannot encode an Instagram-compatible H.264 MP4.');
}

async function renderSlideVideo(
  project: ProjectDocumentV2,
  slideId: string,
  preferTemporary: boolean,
  onProgress?: (frame: number, total: number) => void,
  options: { signal?: AbortSignal } = {},
): Promise<RenderedSlideVideo> {
  const checkCancelled = () => { if (options.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError'); };
  checkCancelled();
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('MP4 export needs a browser with WebCodecs support. Try the latest Chrome or Edge.');
  }
  if (!project.slides[slideId]) throw new Error('A slide no longer exists.');
  await loadInterFonts();
  await ensureLayerFonts(compileScene(project, getSlideViewport(project, slideId)!).map((item) => item.layer));
  await document.fonts?.ready;
  checkCancelled();
  const { config, fps } = await bestSupportedConfig(project);
  const { animated, duration } = await inspectSlideVideo(project, slideId);
  if (!animated) throw new Error('Only slides containing a GIF or video need MP4 rendering.');
  const total = Math.max(1, Math.round(duration * fps));
  checkCancelled();

  const output = await createVideoOutput(preferTemporary);
  const muxer = new Muxer({
    target: output.target,
    video: {
      codec: 'avc',
      width: project.format.width,
      height: project.format.height,
      frameRate: fps,
    },
    // Reserve metadata space up front so encoded samples can be written to
    // OPFS immediately instead of being retained by the muxer until finalize.
    fastStart: { expectedVideoChunks: total },
  });
  let encoderError: DOMException | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => { encoderError = error; },
  });
  const cancelEncoder = () => { if (encoder.state !== 'closed') encoder.close(); };
  options.signal?.addEventListener('abort', cancelEncoder, { once: true });
  let prepared: Awaited<ReturnType<typeof prepareSlide>> | undefined;
  let completed = false;
  try {
    checkCancelled();
    encoder.configure(config);
    const frameTimes = Array.from({ length: total }, (_, index) => frameTime(index, fps));
    prepared = await prepareSlide(project, slideId, frameTimes);
    checkCancelled();
    const durationMicros = Math.round(duration * 1_000_000);
    const keyFrameInterval = fps * 2;
    let lastProgressTime = -Infinity;
    // Every frame is rendered at its exact slide time, however long the device
    // takes, so slow phones export more slowly instead of dropping frames.
    for (let index = 0; index < total; index++) {
      checkCancelled();
      const timestamp = frameTimestamp(index, fps);
      await prepared.render(frameTimes[index]);
      checkCancelled();
      if (encoderError) throw encoderError;
      await waitForEncoder(encoder);
      const next = index + 1 < total ? frameTimestamp(index + 1, fps) : durationMicros;
      const frame = new VideoFrame(prepared.canvas, { timestamp, duration: Math.max(1, next - timestamp) });
      try {
        encoder.encode(frame, { keyFrame: index % keyFrameInterval === 0 });
      } finally {
        frame.close();
      }
      // Updating the export UI for every frame competes with decoding and
      // painting. Keep progress responsive without changing the frame timeline.
      if (onProgress) {
        const now = performance.now();
        if (index + 1 === total || now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
          lastProgressTime = now;
          onProgress(index + 1, total);
        }
      }
    }
    await encoder.flush();
    checkCancelled();
    if (encoderError) throw encoderError;
    muxer.finalize();
    const result = await output.complete();
    completed = true;
    return result;
  } catch (error) {
    checkCancelled();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', cancelEncoder);
    prepared?.destroy();
    if (encoder.state !== 'closed') encoder.close();
    if (!completed) await output.abort(encoderError);
  }
}

export async function renderSlideAsVideoResource(
  project: ProjectDocumentV2,
  slideId: string,
  onProgress?: (frame: number, total: number) => void,
  options: { signal?: AbortSignal } = {},
) {
  return renderSlideVideo(project, slideId, true, onProgress, options);
}

export async function renderSlideAsVideo(
  project: ProjectDocumentV2,
  slideId: string,
  onProgress?: (frame: number, total: number) => void,
) {
  return (await renderSlideVideo(project, slideId, false, onProgress)).blob;
}
