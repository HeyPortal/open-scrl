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
}

export function ShapeNode({ layer, onSelect, onClick, onDblClick, outline, onDragStart, onDragMove, onDragEnd, onTransform, onTransformEnd, groupRef }: Props) {
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
      onTouchStart={onSelect}
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
          // Hit-test the visible outline so clicks pass through an ellipse's empty corners.
          context._context.fillStyle = shape.colorKey;
          context._context.fill(shapePath(layer));
        }}
      />
      <SelectionOutline width={layer.width} height={layer.height} show={outline} />
    </Group>
  );
}
