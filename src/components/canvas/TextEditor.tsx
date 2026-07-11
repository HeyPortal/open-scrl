import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import type { TextLayer } from '@/types';
import { useEditor } from '@/store/editor';

interface Props {
  layer: TextLayer;
  stage: Konva.Stage;
  offsetX?: number;
  scale?: number;
  viewportOffset?: { x: number; y: number };
  onClose: () => void;
}

export function TextEditor({ layer, stage, offsetX = 0, scale: scaleProp, viewportOffset, onClose }: Props) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const scale = scaleProp ?? stage.scaleX();
  const stageBox = stage.container().getBoundingClientRect();
  const x = stageBox.left + (offsetX + layer.x) * scale + (viewportOffset?.x ?? stage.x());
  const y = stageBox.top + layer.y * scale + (viewportOffset?.y ?? stage.y());
  const w = layer.width * scale;

  return (
    <textarea
      ref={ref}
      defaultValue={layer.text}
      onBlur={(e) => {
        updateLayer(layer.id, { text: e.target.value });
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: w,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize * scale,
        fontWeight: layer.fontWeight,
        fontStyle: layer.italic ? 'italic' : 'normal',
        color: layer.fill,
        textAlign: layer.align,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing * scale,
        background: 'transparent',
        border: '1px dashed #7c5cff',
        outline: 'none',
        resize: 'none',
        padding: 0,
        margin: 0,
        zIndex: 100,
        overflow: 'hidden',
      }}
      rows={Math.max(1, Math.ceil(layer.text.split('\n').length))}
    />
  );
}
