import { Ellipse, Group, Rect } from 'react-konva';
import type Konva from 'konva';
import type { ShapeLayer } from '@/types';

interface Props {
  layer: ShapeLayer;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  groupRef: (n: Konva.Group | null) => void;
}

export function ShapeNode({
  layer,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransform,
  onTransformEnd,
  groupRef,
}: Props) {
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;

  return (
    <Group
      ref={groupRef}
      id={layer.id}
      name="layer"
      x={cx}
      y={cy}
      offsetX={layer.width / 2}
      offsetY={layer.height / 2}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      draggable={!layer.locked}
      onMouseDown={onSelect}
      onTouchStart={onSelect}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    >
      {layer.shape === 'rect' ? (
        <Rect
          width={layer.width}
          height={layer.height}
          cornerRadius={layer.cornerRadius}
          fill={layer.fill}
          stroke={layer.strokeWidth > 0 ? layer.stroke : undefined}
          strokeWidth={layer.strokeWidth}
        />
      ) : (
        <Ellipse
          x={layer.width / 2}
          y={layer.height / 2}
          radiusX={layer.width / 2}
          radiusY={layer.height / 2}
          fill={layer.fill}
          stroke={layer.strokeWidth > 0 ? layer.stroke : undefined}
          strokeWidth={layer.strokeWidth}
        />
      )}
    </Group>
  );
}
