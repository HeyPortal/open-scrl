import Konva from 'konva';
import { paintBackground, paintLayer } from '@/render/paint/layers';
import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, Muxer } from 'mp4-muxer';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import type { Asset, Layer, ProjectDocumentV2 } from '@/types';
import { getAsset, getAssetMetadata } from '@/lib/assets';
import { getMediaKind, setVideoElementPlaying } from '@/lib/media';
import { createTemporaryExportFile } from '@/storage/exportTemp';
import { captureSlotForElapsed } from './timeline';
import {
  createAnimatedGifCanvas,
  seekAnimatedGifCanvas,
  stopAnimatedGifCanvas,
} from '@/lib/gif';

const PREFERRED_FPS = 60;
const FALLBACK_FPS = 30;
const DEFAULT_SLIDE_DURATION = 3;
const MAX_SLIDE_DURATION = 60;
type Drawable = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

async function image(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = reject;
      value.src = url;
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function video(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const value = document.createElement('video');
  value.muted = true;
  value.loop = true;
  value.playsInline = true;
  value.preload = 'auto';
  value.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      value.onloadeddata = () => resolve();
      value.onerror = () => reject(new Error('This browser could not decode an imported video.'));
    });
    value.width = value.videoWidth;
    value.height = value.videoHeight;
    return value;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function drawable(asset: Asset): Promise<Drawable> {
  const kind = getMediaKind(asset);
  if (kind === 'video') return video(asset.blob);
  if (kind === 'gif') return createAnimatedGifCanvas(asset.blob, asset.width, asset.height, false);
  return image(asset.blob);
}

async function start(value: Drawable) {
  if (value instanceof HTMLVideoElement) {
    if (value.readyState >= HTMLMediaElement.HAVE_METADATA) value.currentTime = 0;
    await setVideoElementPlaying(value, true);
  }
}

function seek(value: Drawable, timeSeconds: number) {
  if (value instanceof HTMLCanvasElement) seekAnimatedGifCanvas(value, timeSeconds);
}

function release(value: Drawable) {
  if (value instanceof HTMLCanvasElement) {
    stopAnimatedGifCanvas(value);
    return;
  }
  if (value instanceof HTMLVideoElement) {
    value.pause();
    URL.revokeObjectURL(value.src);
    value.removeAttribute('src');
    value.load();
  }
}

/** A Konva shape that paints one layer through the shared painter, re-reading video and GIF frames on every draw. */
function addLayer(target: Konva.Layer, item: Layer, offsetX: number, source?: Drawable) {
  if (item.kind === 'image' && (!item.assetId || !source)) return;
  const media = source && item.kind === 'image' ? source : undefined;
  target.add(new Konva.Shape({
    listening: false,
    sceneFunc: (context) => {
      const ctx = context._context;
      ctx.save();
      // MP4 frames are opaque; the shape's own transform is identity, so paint in slide space.
      paintLayer(ctx, item, offsetX, media ? { source: media, width: media.width, height: media.height } : null);
      ctx.restore();
    },
  }));
}

async function prepareStage(project: ProjectDocumentV2, slideId: string) {
  const targetIndex = project.slideOrder.indexOf(slideId);
  const slide = project.slides[slideId];
  const viewport = getSlideViewport(project, slideId);
  if (targetIndex < 0 || !slide || !viewport) throw new Error('The selected slide no longer exists.');

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-99999px;top:-99999px';
  document.body.appendChild(container);
  const stage = new Konva.Stage({
    container,
    width: project.format.width,
    height: project.format.height,
  });
  const layer = new Konva.Layer();
  const media: Drawable[] = [];
  stage.add(layer);

  // H.264 has no alpha, so transparent slides are flattened onto white.
  const background = slide.background;
  const backgroundAsset = background.kind === 'image' && background.assetId ? await getAsset(background.assetId) : undefined;
  const backgroundImage = backgroundAsset ? await image(backgroundAsset.blob).catch(() => undefined) : undefined;
  layer.add(new Konva.Shape({
    listening: false,
    sceneFunc: (context) => {
      const ctx = context._context;
      const { width, height } = project.format;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      paintBackground(ctx, background, width, height, backgroundImage && background.kind === 'image'
        ? { source: backgroundImage, width: backgroundImage.naturalWidth, height: backgroundImage.naturalHeight, key: background.assetId ?? '' }
        : null);
      ctx.restore();
    },
  }));

  for (const sceneItem of compileScene(project, viewport)) {
    const sourceIndex = project.slideOrder.indexOf(sceneItem.slideId);
    const offsetX = (sourceIndex - targetIndex) * project.format.width;
    let source: Drawable | undefined;
    if (sceneItem.layer.kind === 'image' && sceneItem.layer.assetId) {
      const asset = await getAsset(sceneItem.layer.assetId);
      if (asset) {
        source = await drawable(asset);
        media.push(source);
      }
    }
    addLayer(layer, sceneItem.layer, offsetX, source);
  }

  layer.draw();
  return {
    stage,
    layer,
    play: () => Promise.all(media.map(start)),
    seek: (timeSeconds: number) => media.forEach((value) => seek(value, timeSeconds)),
    destroy: () => {
      media.forEach(release);
      stage.destroy();
      container.remove();
    },
  };
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

function waitUntil(deadline: number) {
  const remaining = deadline - performance.now();
  return remaining > 1
    ? new Promise<void>((resolve) => window.setTimeout(resolve, remaining))
    : Promise.resolve();
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

function encoderConfig(project: ProjectDocumentV2, codec: string, fps: number): VideoEncoderConfig {
  const pixelsPerSecond = project.format.width * project.format.height * fps;
  const bitrate = Math.min(50_000_000, Math.max(fps === PREFERRED_FPS ? 20_000_000 : 12_000_000, Math.round(pixelsPerSecond * .28)));
  return {
    codec,
    width: project.format.width,
    height: project.format.height,
    bitrate,
    bitrateMode: 'variable',
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    avc: { format: 'avc' },
  };
}

async function bestSupportedConfig(project: ProjectDocumentV2) {
  // Prefer High Profile H.264 at 60 fps. Main/Baseline and 30 fps remain
  // compatibility fallbacks for devices with more limited encoders.
  for (const fps of [PREFERRED_FPS, FALLBACK_FPS]) {
    for (const codec of ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a']) {
      const candidate = encoderConfig(project, codec, fps);
      try {
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported) return { config: support.config ?? candidate, fps };
      } catch {
        // Try the next standards-compatible profile.
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
): Promise<RenderedSlideVideo> {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('MP4 export needs a browser with WebCodecs support. Try the latest Chrome or Edge.');
  }
  if (!project.slides[slideId]) throw new Error('A slide no longer exists.');
  await document.fonts?.ready;
  const { config, fps } = await bestSupportedConfig(project);
  const { animated, duration } = await inspectSlideVideo(project, slideId);
  if (!animated) throw new Error('Only slides containing a GIF or video need MP4 rendering.');
  const total = Math.max(1, Math.round(duration * fps));

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
  let prepared: Awaited<ReturnType<typeof prepareStage>> | undefined;
  let completed = false;
  try {
    encoder.configure(config);
    prepared = await prepareStage(project, slideId);
    await prepared.play();
    const started = performance.now();
    const durationMicros = Math.round(duration * 1_000_000);
    let scheduledSlot = 0;
    let lastKeyFrameTimestamp = Number.NEGATIVE_INFINITY;
    let pending: { canvas: HTMLCanvasElement; timestamp: number } | undefined;

    const encodeCanvas = (item: typeof pending, frameDuration: number) => {
      if (!item) return;
      const frame = new VideoFrame(item.canvas, {
        timestamp: item.timestamp,
        duration: Math.max(1, frameDuration),
      });
      const keyFrame = item.timestamp === 0 || item.timestamp - lastKeyFrameTimestamp >= 2_000_000;
      encoder.encode(frame, { keyFrame });
      if (keyFrame) lastKeyFrameTimestamp = item.timestamp;
      frame.close();
    };

    while (scheduledSlot < total) {
      await waitUntil(started + scheduledSlot * 1000 / fps);
      const elapsedMs = performance.now() - started;
      if (pending && elapsedMs >= duration * 1000) {
        onProgress?.(total, total);
        break;
      }
      const slot = captureSlotForElapsed(
        elapsedMs,
        fps,
        total,
        scheduledSlot,
      );
      const timestamp = Math.round(slot * 1_000_000 / fps);
      prepared.seek(slot / fps);
      prepared.layer.draw();
      const canvas = prepared.stage.toCanvas({ pixelRatio: 1, imageSmoothingEnabled: true });
      if (pending) encodeCanvas(pending, timestamp - pending.timestamp);
      pending = { canvas, timestamp };
      onProgress?.(slot + 1, total);
      scheduledSlot = slot + 1;
      if (encoder.encodeQueueSize > 8) await encoder.flush();
      if (encoderError) throw encoderError;
    }
    if (pending) encodeCanvas(pending, durationMicros - pending.timestamp);
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    const result = await output.complete();
    completed = true;
    return result;
  } finally {
    prepared?.destroy();
    if (encoder.state !== 'closed') encoder.close();
    if (!completed) await output.abort(encoderError);
  }
}

export async function renderSlideAsVideoResource(
  project: ProjectDocumentV2,
  slideId: string,
  onProgress?: (frame: number, total: number) => void,
) {
  return renderSlideVideo(project, slideId, true, onProgress);
}

export async function renderSlideAsVideo(
  project: ProjectDocumentV2,
  slideId: string,
  onProgress?: (frame: number, total: number) => void,
) {
  return (await renderSlideVideo(project, slideId, false, onProgress)).blob;
}
