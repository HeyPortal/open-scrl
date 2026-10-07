import type { Bounds, Format, Layer } from '@/types';

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** Axis-aligned bounds after rotating around the layer's center. */
export function rotatedBounds(layer: Pick<Layer, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Bounds {
  const angle = layer.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const width = Math.abs(layer.width) * cos + Math.abs(layer.height) * sin;
  const height = Math.abs(layer.width) * sin + Math.abs(layer.height) * cos;
  return { x: layer.x + layer.width / 2 - width / 2, y: layer.y + layer.height / 2 - height / 2, width, height };
}

export function unionBounds(bounds: readonly Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  return { x, y, width: Math.max(...bounds.map((b) => b.x + b.width)) - x, height: Math.max(...bounds.map((b) => b.y + b.height)) - y };
}

export function slideSpanFor(media: { width: number; height: number }, format: Pick<Format, 'width' | 'height'>): number {
  const k = (media.width / media.height) / (format.width / format.height);
  return k >= 2.4 ? Math.min(Math.round(k), 20) : 1;
}

/** A degenerate source axis keeps its size and only translates its position. */
export function scaleLayer<T extends Layer>(layer: T, from: Bounds, to: Bounds): T {
  const sx = from.width === 0 ? 1 : to.width / from.width;
  const sy = from.height === 0 ? 1 : to.height / from.height;
  const k = Math.sqrt(Math.abs(sx * sy));
  const next: Layer = { ...layer, x: to.x + (layer.x - from.x) * sx, y: to.y + (layer.y - from.y) * sy, width: layer.width * sx, height: layer.height * sy };
  if (next.strokeWidth !== undefined) next.strokeWidth *= k;
  if (next.kind === 'text') {
    next.fontSize *= k;
    next.letterSpacing *= k;
    if (next.highlight) next.highlight = { ...next.highlight, padding: next.highlight.padding * k, radius: next.highlight.radius * k };
  } else next.cornerRadius *= k;
  if (next.shadow) next.shadow = { ...next.shadow, blur: next.shadow.blur * k, offsetX: next.shadow.offsetX * k, offsetY: next.shadow.offsetY * k };
  return next as T;
}
