import type Konva from 'konva';
import type { Layer } from '@/types';
import { shapePath } from '@/render/paint/layers';
import type { Point } from './touchMath';

/** Small layers remain reachable with a finger, matching the canvas hit areas. */
const MIN_TARGET = 32;

function contains(shape: Konva.Shape, point: Point, padX = 0, padY = padX) {
  const local = shape.getAbsoluteTransform().copy().invert().point(point);
  return local.x >= -padX && local.x <= shape.width() + padX && local.y >= -padY && local.y <= shape.height() + padY;
}

/**
 * Mobile selection follows the geometry being drawn, without reading the bitmap hit canvas.
 * A stale or unreliable pixel readback can otherwise choose a different layer or miss it
 * entirely. Returning the actual Shape keeps Konva's tap, drag and Transformer events intact.
 */
export function createMobileHitTest(stage: Konva.Stage, readLayer: (id: string) => Layer | undefined) {
  let context: CanvasRenderingContext2D | null = null;
  const paths = new WeakMap<Layer, Path2D>();
  return (point: Point | null | undefined): Konva.Shape | null => {
    // A cancellation without changed touches has no pointer position.
    if (!point || point.x < 0 || point.y < 0 || point.x > stage.width() || point.y > stage.height()) return null;

    // Handles are above every document layer. Hidden and disabled handles must not catch taps.
    for (const transformer of [...stage.find<Konva.Transformer>('Transformer')].reverse()) {
      if (!transformer.isVisible() || !transformer.isListening() || !transformer.nodes().length) continue;
      for (const anchor of [...transformer.find<Konva.Rect>('._anchor')].reverse()) {
        if (!anchor.isVisible() || !anchor.isListening()) continue;
        const stroke = anchor.hitStrokeWidth();
        if (contains(anchor, point, (stroke === 'auto' ? anchor.strokeWidth() : stroke) / 2)) return anchor;
      }
    }

    // Konva's traversal preserves draw order; the last visible layer wins an overlap.
    for (const node of [...stage.find<Konva.Group>('.layer')].reverse()) {
      const layer = readLayer(node.id());
      const shape = node.findOne<Konva.Shape>('Shape');
      if (!layer || !shape || !shape.isVisible() || !shape.isListening()) continue;
      const scale = shape.getAbsoluteScale();
      const padX = Math.max(0, (MIN_TARGET / Math.abs(scale.x) - shape.width()) / 2);
      const padY = Math.max(0, (MIN_TARGET / Math.abs(scale.y) - shape.height()) / 2);
      if (!contains(shape, point, padX, padY)) continue;
      if (layer.kind === 'shape' && padX === 0 && padY === 0) {
        // Preserve click-through at an ellipse's or rounded rectangle's empty corners.
        if (!context) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          context = canvas.getContext('2d');
        }
        let path = paths.get(layer);
        if (!path) { path = shapePath(layer); paths.set(layer, path); }
        const local = shape.getAbsoluteTransform().copy().invert().point(point);
        if (!context?.isPointInPath(path, local.x, local.y)) continue;
      }
      return shape;
    }
    return null;
  };
}
