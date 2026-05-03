import { useEffect, useRef } from 'react';
import { Group, Text as KText } from 'react-konva';
import type Konva from 'konva';
import type { TextLayer } from '@/types';

interface Props {
  layer: TextLayer;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onDblClick: () => void;
  nodeRef: (n: Konva.Group | null) => void;
}

export function TextNode({
  layer,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransform,
  onTransformEnd,
  onDblClick,
  nodeRef,
}: Props) {
  const ref = useRef<Konva.Text | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.height(ref.current.height());
  }, [layer.text, layer.fontSize, layer.fontWeight, layer.lineHeight, layer.letterSpacing]);

  const fontStyle = `${layer.italic ? 'italic ' : ''}${layer.fontWeight}`;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;

  return (
    <Group
      ref={(n) => {
        nodeRef(n);
      }}
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
      <KText
        ref={(n) => {
          ref.current = n;
        }}
        x={0}
        y={0}
        width={layer.width}
        height={layer.height}
        text={layer.text}
        fontFamily={layer.fontFamily}
        fontSize={layer.fontSize}
        fontStyle={fontStyle}
        fill={layer.fill}
        align={layer.align}
        lineHeight={layer.lineHeight}
        letterSpacing={layer.letterSpacing}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
      />
    </Group>
  );
}
