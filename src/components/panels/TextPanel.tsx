import { useEditor } from '@/store/editor';
import { Plus } from 'lucide-react';
import { useEditorSession } from '@/editor/sessionStore';
import { PanelHeader } from '../ui';

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
  const selectedLayerId = useEditorSession((s) => s.selectedLayerId);
  const selectedLayer = useEditor((s) => selectedLayerId ? s.doc.layers[selectedLayerId] : undefined);

  const apply = (preset: (typeof PRESETS)[number]) => {
    const sel = (() => {
      return selectedLayerId && selectedLayer?.kind === 'text' ? selectedLayer : null;
    })();
    if (sel) {
      updateLayer(sel.id, { text: preset.text, fontSize: preset.size, fontWeight: preset.weight });
    } else {
      addText(preset.text);
      setTimeout(() => {
        const id = useEditorSession.getState().selectedLayerId;
        if (id) updateLayer(id, { fontSize: preset.size, fontWeight: preset.weight });
      }, 0);
    }
  };

  const editing = selectedLayerId && selectedLayer?.kind === 'text';

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Text" />
      <div className="px-3 pb-3">
        <button className="btn btn-primary w-full" onClick={() => addText()}>
          <Plus size={16} aria-hidden /> Add text box
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 pb-2 pt-3">
        <h3 className="section-title">Styles</h3>
        <span className={`text-[11px] ${editing ? 'font-medium text-accent' : 'text-ink-faint'}`}>{editing ? 'Applies to selected text' : 'Click to add'}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-auto px-3 pb-4 scrollbar-thin">
        {PRESETS.map((p) => (
          <button key={p.name} onClick={() => apply(p)} className="tile px-3.5 py-3 text-left">
            <div className="truncate leading-tight text-ink" style={{ fontSize: Math.max(13, Math.min(p.size / 5, 30)), fontWeight: p.weight }}>
              {p.text.split('\n')[0]}
            </div>
            <div className="mt-1 text-[11px] text-ink-faint">{p.name} · {p.size}px</div>
          </button>
        ))}
      </div>
      <p className="mt-auto border-t border-line px-3 py-3 text-[11px] leading-relaxed text-ink-faint">Tip: double-click text on the canvas to edit it in place.</p>
    </div>
  );
}
