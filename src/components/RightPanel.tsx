import { useState } from 'react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';

type Tab = 'design' | 'layers';

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('design');
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const layerCount = useEditor((s) => s.doc.slides[selectedSlideId || s.doc.slideOrder[0]]?.layerOrder.length ?? 0);
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'design', label: 'Design' },
    { id: 'layers', label: 'Layers', badge: layerCount },
  ];
  return (
    <aside className="editor-right-panel flex w-60 shrink-0 flex-col border-l border-line bg-bg-panel xl:w-64">
      <div className="flex h-10 shrink-0 items-end gap-4 border-b border-line px-3" role="tablist" aria-label="Properties">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px flex h-10 items-center gap-1.5 border-b-2 text-xs font-semibold transition-colors ${
              tab === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-dim'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge !== undefined && <span className="rounded bg-bg-inset px-1 text-[10px] font-medium tabular-nums text-ink-dim">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" role="tabpanel">
        {tab === 'design' ? <Inspector onShowLayers={() => setTab('layers')} /> : <LayersPanel onEditLayer={() => setTab('design')} />}
      </div>
    </aside>
  );
}
