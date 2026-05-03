import { useEditor, selectActiveSlide } from '@/store/editor';

const SOLIDS = [
  '#ffffff',
  '#f5f4f0',
  '#fde68a',
  '#fca5a5',
  '#fb7185',
  '#a78bfa',
  '#7c5cff',
  '#60a5fa',
  '#34d399',
  '#111827',
  '#000000',
];

const GRADIENTS: { from: string; to: string; angle: number }[] = [
  { from: '#fde68a', to: '#fb7185', angle: 135 },
  { from: '#a78bfa', to: '#7c5cff', angle: 135 },
  { from: '#60a5fa', to: '#34d399', angle: 135 },
  { from: '#fca5a5', to: '#a78bfa', angle: 90 },
  { from: '#111827', to: '#7c5cff', angle: 45 },
  { from: '#f5f4f0', to: '#cbd5e1', angle: 180 },
];

export function BackgroundPanel() {
  const setBackground = useEditor((s) => s.setBackground);
  const slide = useEditor(selectActiveSlide);

  return (
    <div className="flex flex-col h-full overflow-auto scrollbar-thin">
      <div className="panel-section">Solid color</div>
      <div className="grid grid-cols-6 gap-2 px-3">
        {SOLIDS.map((c) => (
          <button
            key={c}
            className="aspect-square rounded border border-line hover:ring-2 hover:ring-accent"
            style={{ background: c }}
            onClick={() => setBackground({ kind: 'solid', color: c })}
          />
        ))}
      </div>
      <div className="px-3 mt-3">
        <label className="text-xs text-ink-dim flex items-center gap-2">
          Custom
          <input
            type="color"
            value={slide?.background.kind === 'solid' ? slide.background.color : '#ffffff'}
            onChange={(e) => setBackground({ kind: 'solid', color: e.target.value })}
            className="w-7 h-7 bg-transparent rounded cursor-pointer border border-line"
          />
        </label>
      </div>
      <div className="panel-section mt-2">Gradients</div>
      <div className="grid grid-cols-3 gap-2 px-3 pb-3">
        {GRADIENTS.map((g, i) => (
          <button
            key={i}
            className="aspect-square rounded hover:ring-2 hover:ring-accent"
            style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
            onClick={() => setBackground({ kind: 'gradient', ...g })}
          />
        ))}
      </div>
    </div>
  );
}
