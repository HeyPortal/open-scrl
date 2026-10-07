import type { Background, Gradient, GradientStop } from '@/types';

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type GradientBackground = Extract<Background, { kind: 'gradient' }>;

const byOffset = (a: GradientStop, b: GradientStop) => a.offset - b.offset;

/** A gradient background's stops, preferring `stops` over the legacy `from`/`to` pair. */
export function backgroundGradient(bg: GradientBackground): Gradient {
  const stops = bg.stops && bg.stops.length >= 2
    ? [...bg.stops].sort(byOffset)
    : [{ offset: 0, color: bg.from }, { offset: 1, color: bg.to }];
  return { type: bg.type ?? 'linear', angle: bg.angle, stops };
}

/** A gradient background for `gradient`, with `from`/`to` kept in sync for older readers. */
export function gradientBackground(gradient: Gradient): GradientBackground {
  const stops = [...gradient.stops].sort(byOffset);
  return { kind: 'gradient', from: stops[0]?.color ?? '#ffffff', to: stops.at(-1)?.color ?? '#000000', angle: gradient.angle, type: gradient.type, stops };
}

/** End points of CSS `linear-gradient(<angle>deg)` across a box: 0° points up, 90° right. */
export function linearGradientPoints(angle: number, width: number, height: number) {
  const r = angle * Math.PI / 180;
  const dx = Math.sin(r), dy = -Math.cos(r);
  const length = Math.abs(width * Math.sin(r)) + Math.abs(height * Math.cos(r));
  const cx = width / 2, cy = height / 2;
  return { x0: cx - dx * length / 2, y0: cy - dy * length / 2, x1: cx + dx * length / 2, y1: cy + dy * length / 2 };
}

/** Radial gradients are centered circles reaching the farthest corner. */
export const radialGradientRadius = (width: number, height: number) => Math.hypot(width, height) / 2;

export function canvasGradient(ctx: Context2D, gradient: Gradient, width: number, height: number, x = 0, y = 0) {
  let value: CanvasGradient;
  if (gradient.type === 'radial') {
    const cx = x + width / 2, cy = y + height / 2;
    value = ctx.createRadialGradient(cx, cy, 0, cx, cy, radialGradientRadius(width, height));
  } else {
    const p = linearGradientPoints(gradient.angle, width, height);
    value = ctx.createLinearGradient(x + p.x0, y + p.y0, x + p.x1, y + p.y1);
  }
  for (const stop of gradient.stops) value.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
  return value;
}

export function gradientCss(gradient: Gradient) {
  const stops = [...gradient.stops].sort(byOffset).map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`).join(', ');
  return gradient.type === 'radial'
    ? `radial-gradient(circle farthest-corner at center, ${stops})`
    : `linear-gradient(${gradient.angle}deg, ${stops})`;
}
