import { useEditor } from '@/store/editor';

const PRESETS = [
  { name: 'Big headline', text: 'BIG IDEA', size: 200, weight: 800 },
  { name: 'Headline', text: 'Your headline', size: 120, weight: 700 },
  { name: 'Subheading', text: 'A subheading', size: 64, weight: 500 },
  { name: 'Body', text: 'Body text\non multiple lines', size: 36, weight: 400 },
  { name: 'Caption', text: 'caption · 2026', size: 24, weight: 400 },
];

export function TextPanel() {
  const addText = useEditor((s) => s.addTextLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const doc = useEditor((s) => s.doc);
  const selectedLayerId = useEditor((s) => s.selectedLayerId);

  const apply = (preset: (typeof PRESETS)[number]) => {
    const sel = (() => {
      if (!selectedLayerId) return null;
      for (const sl of doc.slides) {
        const l = sl.layers.find((x) => x.id === selectedLayerId);
        if (l && l.kind === 'text') return l;
      }
      return null;
    })();
    if (sel) {
      updateLayer(sel.id, { text: preset.text, fontSize: preset.size, fontWeight: preset.weight });
    } else {
      addText(preset.text);
      setTimeout(() => {
        const id = useEditor.getState().selectedLayerId;
        if (id) updateLayer(id, { fontSize: preset.size, fontWeight: preset.weight });
      }, 0);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-section">Text</div>
      <button className="ctrl-btn ctrl-btn-primary mx-3 mb-3 justify-center" onClick={() => addText()}>
        + Add text
      </button>
      <div className="panel-section">Presets</div>
      <div className="flex flex-col gap-1 px-2 pb-3 overflow-auto scrollbar-thin">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => apply(p)}
            className="card text-left px-3 py-2 hover:border-accent"
          >
            <div className="text-[10px] uppercase text-ink-faint tracking-wider">{p.name}</div>
            <div
              className="text-ink truncate"
              style={{ fontSize: Math.min(p.size / 5, 28), fontWeight: p.weight }}
            >
              {p.text.split('\n')[0]}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
