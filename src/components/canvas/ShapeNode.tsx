import { Group, Shape } from 'react-konva';
import type Konva from 'konva';
import type { ShapeLayer } from '@/types';
import { paintLayerShadow, paintShapeContent, shapePath } from '@/render/paint/layers';
import { SelectionOutline } from './SelectionOutline';

interface Props {
  layer: ShapeLayer;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: () => void;
  onDblClick: () => void;
  outline?: boolean;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: () => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  groupRef: (n: Konva.Group | null) => void;
  /** Mobile canvas: selects on tap or drag, not on touchstart, so a pinch never changes the selection. */
  touch?: boolean;
  /** Extra reach of the hit area on each side, in canvas units, so thin layers stay tappable. */
  hitPad?: { x: number; y: number };
}

export function ShapeNode({ layer, onSelect, onClick, onDblClick, outline, onDragStart, onDragMove, onDragEnd, onTransform, onTransformEnd, groupRef, touch, hitPad }: Props) {
  return (
    <Group
      ref={groupRef}
      id={layer.id}
      name="layer"
      x={layer.x + layer.width / 2}
      y={layer.y + layer.height / 2}
      offsetX={layer.width / 2}
      offsetY={layer.height / 2}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      draggable={!layer.locked}
      onMouseDown={onSelect}
      onTouchStart={touch ? undefined : onSelect}
      onTap={onSelect}
      onClick={onClick}
      onDblClick={onDblClick}
      onDblTap={onDblClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    >
      <Shape
        width={layer.width}
        height={layer.height}
        perfectDrawEnabled={false}
        sceneFunc={(context) => {
          const ctx = context._context;
          paintLayerShadow(ctx, layer);
          paintShapeContent(ctx, layer);
        }}
        hitFunc={(context, shape) => {
          if (hitPad && (hitPad.x > 0 || hitPad.y > 0)) {
            // A layer too thin to hit with a finger: its whole box, grown to a tappable size.
            context.beginPath();
            context.rect(-hitPad.x, -hitPad.y, layer.width + hitPad.x * 2, layer.height + hitPad.y * 2);
            context.closePath();
            context.fillShape(shape);
            return;
          }
          // Hit-test the visible outline so clicks pass through an ellipse's empty corners.
          context._context.fillStyle = shape.colorKey;
          context._context.fill(shapePath(layer));
        }}
      />
      <SelectionOutline width={layer.width} height={layer.height} show={outline} touch={touch} />
    </Group>
  );
}
