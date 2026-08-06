import Konva from 'konva';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { compileScene } from '@/core/scene/compileScene';
import { getSlideViewport } from '@/core/document/coordinates';
import type { Asset, Layer, ProjectDocumentV2 } from '@/types';
import { getAsset, getAssetMetadata } from '@/lib/assets';
import { getMediaKind, setVideoElementPlaying } from '@/lib/media';
import {
  createAnimatedGifCanvas,
  setAnimatedGifCanvasPlaying,
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
  if (value instanceof HTMLCanvasElement) {
    setAnimatedGifCanvasPlaying(value, true, true);
  } else if (value instanceof HTMLVideoElement) {
    if (value.readyState >= HTMLMediaElement.HAVE_METADATA) value.currentTime = 0;
    await setVideoElementPlaying(value, true);
  }
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

function crop(layer: Extract<Layer, { kind: 'image' }>, source: Drawable) {
  const scale = Math.max(1, layer.cropScale ?? 1);
  const box = layer.width / layer.height;
  const ratio = source.width / source.height;
  let width = source.width;
  let height = source.height;
  if (ratio > box) width = source.height * box;
  else height = source.width / box;
  width /= scale;
  height /= scale;
  const maxX = Math.max(0, source.width - width);
  const maxY = Math.max(0, source.height - height);
  return {
    x: maxX / 2 + layer.cropOffsetX * maxX,
    y: maxY / 2 + layer.cropOffsetY * maxY,
    width,
    height,
  };
}

function addLayer(target: Konva.Layer, item: Layer, offsetX: number, source?: Drawable) {
  if (item.kind === 'image') {
    if (!item.assetId || !source) return;
    const area = crop(item, source);
    target.add(new Konva.Image({
      x: offsetX + item.x + item.width / 2,
      y: item.y + item.height / 2,
      offsetX: item.width / 2,
      offsetY: item.height / 2,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      opacity: item.opacity,
      cornerRadius: item.cornerRadius,
      image: source,
      crop: area,
    }));
    return;
  }
  if (item.kind === 'shape') {
    if (item.shape === 'rect') {
      target.add(new Konva.Rect({
        x: offsetX + item.x + item.width / 2,
        y: item.y + item.height / 2,
        offsetX: item.width / 2,
        offsetY: item.height / 2,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        opacity: item.opacity,
        fill: item.fill,
        stroke: item.strokeWidth > 0 ? item.stroke : undefined,
        strokeWidth: item.strokeWidth,
        cornerRadius: item.cornerRadius,
      }));
    } else {
      target.add(new Konva.Ellipse({
        x: offsetX + item.x + item.width / 2,
        y: item.y + item.height / 2,
        radiusX: item.width / 2,
        radiusY: item.height / 2,
        rotation: item.rotation,
        opacity: item.opacity,
        fill: item.fill,
        stroke: item.strokeWidth > 0 ? item.stroke : undefined,
        strokeWidth: item.strokeWidth,
      }));
    }
    return;
  }
  target.add(new Konva.Text({
    x: offsetX + item.x + item.width / 2,
    y: item.y + item.height / 2,
    offsetX: item.width / 2,
    offsetY: item.height / 2,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
    opacity: item.opacity,
    text: item.text,
    fontFamily: item.fontFamily,
    fontSize: item.fontSize,
    fontStyle: `${item.italic ? 'italic ' : ''}${item.fontWeight}`,
    fill: item.fill,
    align: item.align,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
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

  if (slide.background.kind === 'solid') {
    layer.add(new Konva.Rect({
      x: 0,
      y: 0,
      width: project.format.width,
      height: project.format.height,
      fill: slide.background.color,
    }));
  } else {
    layer.add(new Konva.Rect({
      x: 0,
      y: 0,
      width: project.format.width,
      height: project.format.height,
      fillLinearGradientStartPoint: { x: 0, y: 0 },
      fillLinearGradientEndPoint: {
        x: project.format.width * Math.cos(slide.background.angle * Math.PI / 180),
        y: project.format.height * Math.sin(slide.background.angle * Math.PI / 180),
      },
      fillLinearGradientColorStops: [0, slide.background.from, 1, slide.background.to],
    }));
  }

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

export async function renderSlideAsVideo(
  project: ProjectDocumentV2,
  slideId: string,
  onProgress?: (frame: number, total: number) => void,
) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('MP4 export needs a browser with WebCodecs support. Try the latest Chrome or Edge.');
  }
  if (!project.slides[slideId]) throw new Error('A slide no longer exists.');
  await document.fonts?.ready;
  const { config, fps } = await bestSupportedConfig(project);
  const { animated, duration } = await inspectSlideVideo(project, slideId);
  if (!animated) throw new Error('Only slides containing a GIF or video need MP4 rendering.');
  const total = Math.max(1, Math.round(duration * fps));

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: project.format.width,
      height: project.format.height,
      frameRate: fps,
    },
    fastStart: 'in-memory',
  });
  let encoderError: DOMException | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => { encoderError = error; },
  });
  encoder.configure(config);
  let prepared: Awaited<ReturnType<typeof prepareStage>> | undefined;
  try {
    prepared = await prepareStage(project, slideId);
    await prepared.play();
    const started = performance.now();
    for (let frameIndex = 0; frameIndex < total; frameIndex++) {
      await waitUntil(started + frameIndex * 1000 / fps);
      prepared.layer.draw();
      const canvas = prepared.stage.toCanvas({ pixelRatio: 1, imageSmoothingEnabled: true });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(frameIndex * 1_000_000 / fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();
      onProgress?.(frameIndex + 1, total);
      if (encoder.encodeQueueSize > 8) await encoder.flush();
      if (encoderError) throw encoderError;
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    prepared?.destroy();
    encoder.close();
  }
}
