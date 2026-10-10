import type { ImageLayer } from '@/types';

type FramedPhoto = ImageLayer & { frameStyle?: 'polaroid' | 'paper' | 'film' | 'postcard' };

export function photoWindow(layer: Pick<FramedPhoto, 'width' | 'height' | 'strokeWidth' | 'frameStyle'>) {
  const w = layer.width, h = layer.height;
  if (!layer.frameStyle || !(layer.strokeWidth && layer.strokeWidth > 0)) return { x: 0, y: 0, width: w, height: h };
  // Clamp extreme user-set widths so the photo always retains a usable opening.
  const border = Math.min(layer.strokeWidth, w * .22, h / (layer.frameStyle === 'polaroid' ? 6 : 4));
  const bottom = layer.frameStyle === 'polaroid' ? border * 3.2 : border;
  return { x: border, y: border, width: Math.max(1, w - border * 2), height: Math.max(1, h - border - bottom) };
}

/** Position the inset photo about the outer frame's rotation center, including HDR export. */
export function photoPlacement(layer: FramedPhoto, slideX: number) {
  const rect = photoWindow(layer);
  const dx = rect.x + rect.width / 2 - layer.width / 2;
  const dy = rect.y + rect.height / 2 - layer.height / 2;
  const angle = layer.rotation * Math.PI / 180;
  return { x: slideX + layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - rect.width / 2, y: layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) - rect.height / 2, width: rect.width, height: rect.height };
}
