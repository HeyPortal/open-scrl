import { photoWindow } from './photoGeometry';
export { photoWindow, photoPlacement } from './photoGeometry';
import type { ImageLayer } from '@/types';

export type FrameStyle = 'polaroid' | 'paper' | 'film' | 'postcard';
export const FRAME_PRESETS: { id: string; label: string; style?: FrameStyle; scale: number; color: string }[] = [
  { id: 'none', label: 'None', scale: 0, color: '#ffffff' },
  { id: 'thin', label: 'Thin', scale: .012, color: '#ffffff' },
  { id: 'mat', label: 'White mat', scale: .065, color: '#ffffff' },
  { id: 'polaroid', label: 'Polaroid', style: 'polaroid', scale: .06, color: '#fffdf7' },
  { id: 'paper', label: 'Paper', style: 'paper', scale: .055, color: '#f3ebda' },
  { id: 'film', label: 'Film', style: 'film', scale: .06, color: '#181818' },
  { id: 'gallery', label: 'Black mat', scale: .065, color: '#181818' },
  { id: 'postcard', label: 'Postcard', style: 'postcard', scale: .045, color: '#fffdf7' },
];

function paperPath(w: number, h: number) {
  const path = new Path2D();
  const tooth = Math.min(w, h) * .003;
  const steps = 45;
  path.moveTo(tooth, tooth);
  for (let i = 1; i <= steps; i++) path.lineTo(w * i / steps, tooth * (1.4 + Math.sin(i * 2.7)));
  for (let i = 1; i <= steps; i++) path.lineTo(w - tooth * (1.4 + Math.sin(i * 3.1)), h * i / steps);
  for (let i = 1; i <= steps; i++) path.lineTo(w * (1 - i / steps), h - tooth * (1.4 + Math.sin(i * 2.3)));
  for (let i = 1; i <= steps; i++) path.lineTo(tooth * (1.4 + Math.sin(i * 2.9)), h * (1 - i / steps));
  path.closePath(); return path;
}

/** Paint only the frame ring, so HDR photos can be composited underneath it. */
export function paintFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: ImageLayer) {
  if (!layer.frameStyle || !(layer.strokeWidth && layer.strokeWidth > 0)) return;
  const rect = photoWindow(layer);
  const ring = layer.frameStyle === 'paper' ? paperPath(layer.width, layer.height) : new Path2D();
  if (layer.frameStyle !== 'paper') ring.rect(0, 0, layer.width, layer.height);
  ring.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.save(); ctx.clip(ring, 'evenodd');
  ctx.fillStyle = layer.stroke ?? '#ffffff'; ctx.fill(ring, 'evenodd');
  if (layer.frameStyle === 'paper') {
    // Deterministic fine fibers on the paper, independent of preview/export resolution.
    ctx.fillStyle = 'rgba(91,67,37,.09)';
    for (let i = 0; i < 250; i++) {
      const x = ((i * 73.37) % 997) / 997 * layer.width;
      const y = ((i * 159.71) % 991) / 991 * layer.height;
      ctx.fillRect(x, y, Math.max(.6, layer.width * .001), Math.max(.6, layer.height * .002));
    }
  }
  if (layer.frameStyle === 'film') {
    const size = rect.x * .42;
    ctx.fillStyle = '#e5e0d4';
    for (let y = rect.x * .6; y + size < layer.height; y += size * 2.3) {
      ctx.fillRect(rect.x * .28, y, size, size * 1.3);
      ctx.fillRect(layer.width - rect.x * .72, y, size, size * 1.3);
    }
  }
  if (layer.frameStyle === 'postcard') {
    ctx.strokeStyle = 'rgba(70,54,32,.3)'; ctx.lineWidth = Math.max(.7, Math.min(layer.width, layer.height) * .0015);
    ctx.strokeRect(rect.x * .4, rect.y * .4, layer.width - rect.x * .8, layer.height - rect.y * .8);
  }
  ctx.restore();
}
