import type { Bounds } from '@/types';

export function findCrossedSlideSeams(
  bounds: Bounds,
  slideWidth: number,
  slideCount: number,
): number[] {
  if (slideWidth <= 0 || slideCount <= 1) return [];
  const left = Math.min(bounds.x, bounds.x + bounds.width);
  const right = Math.max(bounds.x, bounds.x + bounds.width);
  const seams: number[] = [];
  for (let index = 1; index < slideCount; index++) {
    const seam = index * slideWidth;
    if (left < seam && right > seam) seams.push(seam);
  }
  return seams;
}
