import type { TextLayer } from '@/types';
import { snapBox, type SnapGuide } from '@/lib/snap';

interface Point { x: number; y: number }

/** Resize in the gesture's original local coordinates, so reflow never moves its reference frame. */
export function resizeTextLayer(
  base: TextLayer,
  delta: Point,
  anchor: string,
  centered: boolean,
  snap: { others: Parameters<typeof snapBox>[1]; canvas: { width: number; height: number }; threshold: number },
  measureHeight: (layer: TextLayer) => number | undefined,
): { layer: TextLayer; guides: SnapGuide[] } {
  const hx = anchor.includes('left') ? -1 : anchor.includes('right') ? 1 : 0;
  const hy = base.autoFit ? anchor.includes('top') ? -1 : anchor.includes('bottom') ? 1 : 0 : 0;
  const multiplier = centered ? 2 : 1;
  let width = Math.max(8, base.width + hx * delta.x * multiplier);
  let height = Math.max(8, base.height + hy * delta.y * multiplier);
  const guides: SnapGuide[] = [];

  // Snap only the moving edge. Snapping the entire box would translate the fixed side,
  // and snapping a rotated box against unrotated axes would move it off the pointer.
  if (!centered && base.rotation % 360 === 0) {
    if (hx) {
      const edge = hx < 0 ? base.x + base.width - width : base.x + width;
      const result = snapBox({ x: edge, y: base.y, width: 0, height }, snap.others, snap.canvas, snap.threshold);
      const snappedWidth = hx < 0 ? base.x + base.width - result.x : result.x - base.x;
      if (snappedWidth >= 8) { width = snappedWidth; guides.push(...result.guides.filter((g) => g.orientation === 'v')); }
    }
    if (hy) {
      const edge = hy < 0 ? base.y + base.height - height : base.y + height;
      const result = snapBox({ x: base.x, y: edge, width, height: 0 }, snap.others, snap.canvas, snap.threshold);
      const snappedHeight = hy < 0 ? base.y + base.height - result.y : result.y - base.y;
      if (snappedHeight >= 8) { height = snappedHeight; guides.push(...result.guides.filter((g) => g.orientation === 'h')); }
    }
  }
  if (!base.autoFit) height = measureHeight({ ...base, width }) ?? base.height;
  const left = centered ? (base.width - width) / 2 : hx < 0 ? base.width - width : 0;
  const top = centered ? (base.height - height) / 2 : hy < 0 ? base.height - height : 0;
  const dx = left + (width - base.width) / 2, dy = top + (height - base.height) / 2;
  const angle = base.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    layer: { ...base, width, height, x: base.x + base.width / 2 + dx * cos - dy * sin - width / 2, y: base.y + base.height / 2 + dx * sin + dy * cos - height / 2 },
    guides,
  };
}
