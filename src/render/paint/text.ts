import type { Bounds, TextLayer } from '@/types';
import { layoutText } from '@/core/scene/textLayout';
import { canvasGradient } from './gradient';
import type { PathSink } from './masks';

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextLine {
  text: string;
  /** Left edge of the visible text, after alignment. */
  x: number;
  width: number;
  /** Top of the line box (`fontSize × lineHeight` tall). */
  top: number;
  baseline: number;
}

export interface TextLayoutResult {
  /** The size actually used; smaller than `fontSize` when shrink-to-fit is on. */
  fontSize: number;
  lineStep: number;
  lines: TextLine[];
  /** Bounds of the painted text, outline and highlight in layer coordinates. */
  bounds: Bounds;
}

const MIN_FIT_SIZE = 4;
const cache = new Map<string, TextLayoutResult>();
const CACHE_LIMIT = 300;

export const textFont = (layer: Pick<TextLayer, 'italic' | 'fontWeight' | 'fontFamily'>, size: number) =>
  `${layer.italic ? 'italic ' : ''}${layer.fontWeight} ${size}px ${layer.fontFamily}`;

const glyphCount = (text: string) => [...text].length;

function lineWidth(ctx: Context2D, text: string, letterSpacing: number) {
  return ctx.measureText(text).width + Math.max(0, glyphCount(text) - 1) * letterSpacing;
}

function fontMetrics(ctx: Context2D, size: number) {
  const m = ctx.measureText('Hg');
  const ascent = Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : size * 0.8;
  const descent = Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : size * 0.2;
  return { ascent, descent };
}

function wrap(ctx: Context2D, layer: TextLayer, size: number) {
  ctx.font = textFont(layer, size);
  const letterSpacing = layer.letterSpacing * (size / layer.fontSize);
  return layoutText({ text: layer.text, width: layer.width, fontSize: size, lineHeight: layer.lineHeight, letterSpacing }, (t) => ctx.measureText(t).width);
}

/** The largest size ≤ `fontSize` at which every line fits the box's width and all lines fit its height. */
function fitSize(ctx: Context2D, layer: TextLayer) {
  const fits = (size: number) => {
    const lines = wrap(ctx, layer, size);
    if (lines.length * size * layer.lineHeight > layer.height + 0.5) return false;
    const spacing = layer.letterSpacing * (size / layer.fontSize);
    return lines.every((line) => lineWidth(ctx, line.text, spacing) <= layer.width + 0.5);
  };
  if (fits(layer.fontSize)) return layer.fontSize;
  let lo = MIN_FIT_SIZE, hi = layer.fontSize;
  for (let i = 0; i < 12 && hi - lo > 0.25; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 4) / 4;
}

/** Lays out a text layer the same way it's painted. Shrink-to-fit text is centered vertically. */
export function layoutTextLayer(ctx: Context2D, layer: TextLayer): TextLayoutResult {
  const key = [layer.text, layer.fontFamily, layer.fontSize, layer.fontWeight, layer.italic, layer.align, layer.letterSpacing, layer.lineHeight, layer.width, layer.autoFit ? layer.height : '', layer.strokeWidth ?? 0, layer.highlight ? `${layer.highlight.style}/${layer.highlight.padding}` : ''].join('\u0001');
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const size = layer.autoFit ? fitSize(ctx, layer) : layer.fontSize;
  const spacing = layer.letterSpacing * (size / layer.fontSize);
  const raw = wrap(ctx, layer, size);
  const { ascent, descent } = fontMetrics(ctx, size);
  const lineStep = size * layer.lineHeight;
  const textHeight = raw.length * lineStep;
  const offsetY = layer.autoFit ? Math.max(0, (layer.height - textHeight) / 2) : 0;
  const lines = raw.map((line, i): TextLine => {
    const width = lineWidth(ctx, line.text, spacing);
    const x = layer.align === 'center' ? (layer.width - width) / 2 : layer.align === 'right' ? layer.width - width : 0;
    const top = offsetY + i * lineStep;
    return { text: line.text, x, width, top, baseline: top + (lineStep - (ascent + descent)) / 2 + ascent };
  });

  const outline = layer.strokeWidth ?? 0;
  const pad = layer.highlight?.padding ?? 0;
  const xs = lines.filter((l) => l.text).flatMap((l) => [l.x, l.x + l.width]);
  const minX = Math.min(0, ...xs) - outline - pad;
  const maxX = Math.max(layer.width, ...xs) + outline + pad;
  // Glyphs can overshoot their line box (accents, swashes, italics), so leave room above and below.
  const bounds = { x: minX - size * 0.2, y: Math.min(0, offsetY) - outline - pad - size * 0.3, width: 0, height: 0 };
  bounds.width = maxX + size * 0.2 - bounds.x;
  bounds.height = Math.max(layer.height, offsetY + textHeight) + outline + pad + size * 0.3 - bounds.y;

  const result = { fontSize: size, lineStep, lines, bounds };
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return result;
}

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined;

/**
 * Height of the text's lines at its full size, which text boxes without shrink-to-fit keep.
 * Undefined where there's no canvas to measure with (tests).
 */
export function measureTextHeight(layer: TextLayer): number | undefined {
  if (measureContext === undefined) measureContext = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!measureContext) return undefined;
  const lines = wrap(measureContext, layer, layer.fontSize);
  const lineStep = layer.fontSize * layer.lineHeight;
  return Math.max(1, lineStep, lines.length * lineStep);
}

function roundedRect(sink: PathSink, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  sink.moveTo(x + r, y);
  sink.arcTo(x + w, y, x + w, y + h, r);
  sink.arcTo(x + w, y + h, x, y + h, r);
  sink.arcTo(x, y + h, x, y, r);
  sink.arcTo(x, y, x + w, y, r);
  sink.closePath();
}

/**
 * The highlight behind the text. `lines` gives each line its own box; neighboring boxes overlap
 * by the corner radius so their rounded corners don't leave notches where they meet. All boxes are
 * one path filled once, so translucent colors don't darken where boxes overlap.
 */
export function highlightPath(layer: TextLayer, layout: TextLayoutResult) {
  const h = layer.highlight;
  const path = new Path2D();
  if (!h) return path;
  const pad = h.padding, outer = h.padding / 2;
  const visible = layout.lines.filter((l) => l.text.trim());
  if (!visible.length) return path;
  if (h.style === 'box') {
    const left = Math.min(...visible.map((l) => l.x)) - pad;
    const right = Math.max(...visible.map((l) => l.x + l.width)) + pad;
    const top = visible[0].top - outer, bottom = visible.at(-1)!.top + layout.lineStep + outer;
    roundedRect(path, left, top, right - left, bottom - top, h.radius);
    return path;
  }
  layout.lines.forEach((line, i) => {
    if (!line.text.trim()) return;
    const above = layout.lines[i - 1]?.text.trim(), below = layout.lines[i + 1]?.text.trim();
    const top = line.top - (above ? h.radius : outer);
    const bottom = line.top + layout.lineStep + (below ? h.radius : outer);
    roundedRect(path, line.x - pad, top, line.width + pad * 2, bottom - top, h.radius);
  });
  return path;
}

function drawLine(ctx: Context2D, line: TextLine, spacing: number, mode: 'fill' | 'stroke') {
  if (!line.text) return;
  if (spacing === 0) {
    if (mode === 'fill') ctx.fillText(line.text, line.x, line.baseline);
    else ctx.strokeText(line.text, line.x, line.baseline);
    return;
  }
  let cursor = line.x;
  for (const char of line.text) {
    if (mode === 'fill') ctx.fillText(char, cursor, line.baseline);
    else ctx.strokeText(char, cursor, line.baseline);
    cursor += ctx.measureText(char).width + spacing;
  }
}

/** Paints a text layer in its local, unrotated coordinates: highlight, then outline, then fill. */
export function paintTextContent(ctx: Context2D, layer: TextLayer) {
  const layout = layoutTextLayer(ctx, layer);
  const spacing = layer.letterSpacing * (layout.fontSize / layer.fontSize);
  ctx.save();
  if (layer.highlight) {
    ctx.fillStyle = layer.highlight.color;
    ctx.fill(highlightPath(layer, layout));
  }
  ctx.font = textFont(layer, layout.fontSize);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const outline = layer.strokeWidth ?? 0;
  if (outline > 0 && layer.stroke) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = outline * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (const line of layout.lines) drawLine(ctx, line, spacing, 'stroke');
  }
  ctx.fillStyle = layer.fillGradient && layer.fillGradient.stops.length >= 2
    ? canvasGradient(ctx, layer.fillGradient, layer.width, layer.height)
    : layer.fill;
  for (const line of layout.lines) drawLine(ctx, line, spacing, 'fill');
  ctx.restore();
  return layout;
}
