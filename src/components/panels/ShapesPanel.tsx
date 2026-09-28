import type { CSSProperties } from 'react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import type { Format, ShapeLayer } from '@/types';
import { PanelHeader } from '../ui';

interface ShapePreset {
  name: string;
  shape: 'rect' | 'ellipse';
  preview: CSSProperties;
  /** Adjusts the default shape for this preset; omitted for the plain shapes. */
  patch?: (format: Format) => Partial<ShapeLayer>;
}

const PRESETS: ShapePreset[] = [
  { name: 'Rectangle', shape: 'rect', preview: { width: 44, height: 32, borderRadius: 4 } },
  { name: 'Ellipse', shape: 'ellipse', preview: { width: 44, height: 32, borderRadius: 999 } },
  {
    name: 'Rounded',
    shape: 'rect',
    preview: { width: 40, height: 40, borderRadius: 12 },
    patch: (f) => { const size = f.width * 0.5; return { x: (f.width - size) / 2, y: (f.height - size) / 2, width: size, height: size, cornerRadius: size / 5 }; },
  },
  {
    name: 'Circle',
    shape: 'ellipse',
    preview: { width: 40, height: 40, borderRadius: 999 },
    patch: (f) => { const size = f.width * 0.5; return { name: 'Circle', x: (f.width - size) / 2, y: (f.height - size) / 2, width: size, height: size }; },
  },
  {
    name: 'Banner',
    shape: 'rect',
    preview: { width: 52, height: 14, borderRadius: 2 },
    patch: (f) => ({ name: 'Banner', x: 0, y: f.height * 0.78, width: f.width, height: f.height * 0.16, cornerRadius: 0, fill: '#111827' }),
  },
  {
    name: 'Divider',
    shape: 'rect',
    preview: { width: 52, height: 4, borderRadius: 2 },
    patch: (f) => ({ name: 'Divider', x: f.width * 0.2, y: f.height / 2 - 6, width: f.width * 0.6, height: 12, cornerRadius: 6, fill: '#111827' }),
  },
];

export function ShapesPanel() {
  const add = useEditor((s) => s.addShapeLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const commitTransaction = useEditor((s) => s.commitTransaction);
  const format = useEditor((s) => s.doc.format);

  const insert = (preset: ShapePreset) => {
    if (!preset.patch) {
      add(preset.shape);
      return;
    }
    const tx = beginTransaction(`Add ${preset.name.toLowerCase()}`);
    add(preset.shape);
    const id = useEditorSession.getState().selectedLayerId;
    if (id) updateLayer(id, preset.patch(format));
    commitTransaction(tx);
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Shapes" hint="Use shapes as colour blocks, frames, and text backgrounds." />
      <div className="grid grid-cols-2 gap-2 px-3 pb-4">
        {PRESETS.map((preset) => (
          <button key={preset.name} className="tile group flex flex-col items-center gap-2 px-2 pb-2.5 pt-4" onClick={() => insert(preset)}>
            <span className="flex h-12 items-center justify-center">
              <span
                className={`block transition-transform group-hover:scale-110 ${preset.patch?.(format).fill ? 'bg-ink-dim' : 'bg-accent'}`}
                style={preset.preview}
                aria-hidden
              />
            </span>
            <span className="text-xs font-medium text-ink-dim group-hover:text-ink">{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
