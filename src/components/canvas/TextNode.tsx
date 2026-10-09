import { Group, Shape } from 'react-konva';
import type Konva from 'konva';
import type { TextLayer } from '@/types';
import { paintLayerShadow } from '@/render/paint/layers';
import { paintTextContent } from '@/render/paint/text';
import { SelectionOutline } from './SelectionOutline';

interface Props {
  layer: TextLayer;
  /** Hide the painted text while it's being edited in place. */
  editing?: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onClick: () => void;
  outline?: boolean;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: () => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onDblClick: () => void;
  nodeRef: (n: Konva.Group | null) => void;
  /** Mobile canvas: selects on tap or drag, not on touchstart, so a pinch never changes the selection. */
  touch?: boolean;
  /** Extra reach of the hit area on each side, in canvas units, so thin layers stay tappable. */
  hitPad?: { x: number; y: number };
}

export function TextNode({ layer, editing, onSelect, onClick, outline, onDragStart, onDragMove, onDragEnd, onTransform, onTransformEnd, onDblClick, nodeRef, touch, hitPad }: Props) {
  return (
    <Group
      ref={nodeRef}
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
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        sceneFunc={(context) => {
          if (editing) return;
          const ctx = context._context;
          paintLayerShadow(ctx, layer);
          paintTextContent(ctx, layer);
        }}
        hitFunc={(context, shape) => {
          context.beginPath();
          context.rect(-(hitPad?.x ?? 0), -(hitPad?.y ?? 0), layer.width + (hitPad?.x ?? 0) * 2, layer.height + (hitPad?.y ?? 0) * 2);
          context.closePath();
          context.fillStrokeShape(shape);
        }}
      />
      <SelectionOutline width={layer.width} height={layer.height} show={outline && !editing} touch={touch} />
    </Group>
  );
}
