import { Rect } from 'react-konva';

export const SELECTION_COLOR = '#7c5cff';

/**
 * Thin outline drawn inside a layer's node, so it follows the node while the selection is
 * dragged or scaled. The stroke stays 1.5 screen pixels at any zoom.
 */
export function SelectionOutline({ width, height, show, touch }: { width: number; height: number; show?: boolean; /** Thicker stroke for fingers. */ touch?: boolean }) {
  if (!show) return null;
  return <Rect width={width} height={height} stroke={SELECTION_COLOR} strokeWidth={touch ? 2.5 : 1.5} strokeScaleEnabled={false} listening={false} perfectDrawEnabled={false} />;
}
