import type { Background, Bounds, ImageLayer, Layer, ShapeLayer } from '@/types';
import { photoWindow, paintFrame } from './frames';
import { backgroundGradient, canvasGradient } from './gradient';
import { isTransparentColor, withOpacity } from './color';
import { maskPath } from './masks';
import { layoutTextLayer, paintTextContent } from './text';
import { blurredCover, coverRect, createCanvas } from './blur';

/**
 * One painter for the editor canvas, previews, and PNG and MP4 export, so what you see is what
 * you export. Everything draws in project pixels with a y-down transform already applied.
 */

export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PaintMedia {
  source: CanvasImageSource;
  /** Natural pixel size of `source`. */
  width: number;
  height: number;
}

/** The part of the media an image layer shows: cover-fit, zoomed by `cropScale`, offset in the slack. */
export function imageCrop(layer: Pick<ImageLayer, 'width' | 'height' | 'cropScale' | 'cropOffsetX' | 'cropOffsetY' | 'frameStyle' | 'strokeWidth'>, width: number, height: number) {
  const scale = Math.max(1, layer.cropScale ?? 1);
  const window = photoWindow(layer);
  const box = window.width / window.height;
  let sw = width, sh = height;
  if (width / height > box) sw = height * box; else sh = width / box;
  sw /= scale; sh /= scale;
  const maxX = Math.max(0, width - sw), maxY = Math.max(0, height - sh);
  return { x: maxX / 2 + layer.cropOffsetX * maxX, y: maxY / 2 + layer.cropOffsetY * maxY, width: sw, height: sh };
}

export function paintImageContent(ctx: Context2D, layer: ImageLayer, media: PaintMedia | null | undefined) {
  const window = photoWindow(layer);
  const decorated = Boolean(layer.frameStyle && (layer.strokeWidth ?? 0) > 0);
  const path = maskPath(decorated ? 'rect' : layer.mask, window.width, window.height, decorated ? 0 : layer.cornerRadius);
  if (media && media.width > 0 && media.height > 0) {
    const crop = imageCrop(layer, media.width, media.height);
    ctx.save();
    ctx.translate(window.x, window.y);
    ctx.clip(path);
    ctx.drawImage(media.source, crop.x, crop.y, crop.width, crop.height, 0, 0, window.width, window.height);
    ctx.restore();
  }
  if (decorated) { paintFrame(ctx, layer); return; }
  const border = layer.strokeWidth ?? 0;
  if (border > 0 && !isTransparentColor(layer.stroke)) {
    // Centered strokes are clipped to the mask, so the border sits inside the photo's outline.
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = layer.stroke!;
    ctx.lineWidth = border * 2;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.restore();
  }
}

export function shapePath(layer: ShapeLayer) {
  return maskPath(layer.shape === 'ellipse' ? 'ellipse' : 'rect', layer.width, layer.height, layer.cornerRadius);
}

export function paintShapeContent(ctx: Context2D, layer: ShapeLayer) {
  const path = shapePath(layer);
  if (!isTransparentColor(layer.fill)) {
    ctx.fillStyle = layer.fill;
    ctx.fill(path);
  }
  if (layer.strokeWidth > 0 && !isTransparentColor(layer.stroke)) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = layer.strokeWidth;
    ctx.stroke(path);
  }
}

export function paintLayerContent(ctx: Context2D, layer: Layer, media?: PaintMedia | null) {
  if (layer.kind === 'image') paintImageContent(ctx, layer, media);
  else if (layer.kind === 'shape') paintShapeContent(ctx, layer);
  else paintTextContent(ctx, layer);
}

/** Local bounds of everything a layer paints, which can extend past its box (outlines, highlights). */
export function layerContentBounds(ctx: Context2D, layer: Layer): Bounds {
  if (layer.kind === 'text') return layoutTextLayer(ctx, layer).bounds;
  const outset = layer.kind === 'shape' ? layer.strokeWidth / 2 : 0;
  return { x: -outset, y: -outset, width: layer.width + outset * 2, height: layer.height + outset * 2 };
}

let scratch: OffscreenCanvas | HTMLCanvasElement | null = null;
const SHADOW_SOURCE_EDGE = 2048;
// Far enough that the silhouette itself lands off-canvas while its shadow is offset back.
const OFFSTAGE = 1 << 16;

/**
 * Paints the layer's drop shadow, cast by everything it draws (transparent parts of photos
 * included). The content is rendered once into a scratch canvas, drawn far off-canvas, and only
 * its shadow is offset back into view. Shadow distances are in project pixels and don't rotate.
 */
export function paintLayerShadow(ctx: Context2D, layer: Layer, media?: PaintMedia | null) {
  const shadow = layer.shadow;
  if (!shadow || shadow.opacity <= 0 || isTransparentColor(shadow.color)) return;
  if (layer.kind === 'image' && !media) return;
  const m = ctx.getTransform();
  const deviceScale = Math.hypot(m.a, m.b) || 1;
  const bounds = layerContentBounds(ctx, layer);
  const res = Math.min(deviceScale, SHADOW_SOURCE_EDGE / Math.max(bounds.width, bounds.height, 1));
  const w = Math.ceil(bounds.width * res), h = Math.ceil(bounds.height * res);
  if (w < 1 || h < 1) return;
  if (!scratch) scratch = createCanvas(w, h);
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const sctx = scratch.getContext('2d') as Context2D;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  sctx.setTransform(res, 0, 0, res, -bounds.x * res, -bounds.y * res);
  paintLayerContent(sctx, layer, media);

  ctx.save();
  ctx.setTransform(new DOMMatrix([1, 0, 0, 1, -OFFSTAGE, 0]).multiply(m));
  ctx.shadowColor = withOpacity(shadow.color, shadow.opacity);
  ctx.shadowBlur = shadow.blur * deviceScale;
  ctx.shadowOffsetX = shadow.offsetX * deviceScale + OFFSTAGE;
  ctx.shadowOffsetY = shadow.offsetY * deviceScale;
  ctx.drawImage(scratch, 0, 0, w, h, bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.restore();
}

/** Paints a layer whose slide's left edge is at `x` (export and previews). */
export function paintLayer(ctx: Context2D, layer: Layer, x: number, media?: PaintMedia | null) {
  if (!layer.visible || layer.width <= 0 || layer.height <= 0) return;
  ctx.save();
  ctx.translate(x + layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.translate(-layer.width / 2, -layer.height / 2);
  ctx.globalAlpha *= layer.opacity;
  paintLayerShadow(ctx, layer, media);
  paintLayerContent(ctx, layer, media);
  ctx.restore();
}

export interface BackgroundMedia extends PaintMedia {
  /** Identifies the decoded media for the blur cache. */
  key: string;
}

/** Paints a slide background over `width`×`height`. Transparent backgrounds paint nothing. */
export function paintBackground(ctx: Context2D, bg: Background, width: number, height: number, media?: BackgroundMedia | null) {
  switch (bg.kind) {
    case 'transparent':
      return;
    case 'solid':
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, width, height);
      return;
    case 'gradient':
      ctx.fillStyle = canvasGradient(ctx, backgroundGradient(bg), width, height);
      ctx.fillRect(0, 0, width, height);
      return;
    case 'image': {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, width, height);
      if (media && media.width > 0 && media.height > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();
        if (bg.blur > 0) {
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(blurredCover(media.key, media, width, height, bg.blur), 0, 0, width, height);
        } else {
          const r = coverRect(media.width, media.height, width, height);
          ctx.drawImage(media.source, r.x, r.y, r.width, r.height);
        }
        ctx.restore();
      }
      if (bg.dim > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, bg.dim)})`;
        ctx.fillRect(0, 0, width, height);
      }
    }
  }
}

/** The editor's stand-in for transparency: a light checkerboard. */
export function paintCheckerboard(ctx: Context2D, width: number, height: number, cell: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e4e4e7';
  ctx.beginPath();
  for (let y = 0, row = 0; y < height; y += cell, row++) {
    for (let x = (row % 2) * cell; x < width; x += cell * 2) ctx.rect(x, y, Math.min(cell, width - x), Math.min(cell, height - y));
  }
  ctx.fill();
}
