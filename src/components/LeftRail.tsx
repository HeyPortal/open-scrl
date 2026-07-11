import { Grid3x3, Image, Palette, Square, Type } from 'lucide-react';
import type { LeftPanel } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';

const TABS: { id: LeftPanel; label: string; icon: typeof Image }[] = [
  { id: 'templates', label: 'Grids', icon: Grid3x3 },
  { id: 'photos', label: 'Photos', icon: Image },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'shapes', label: 'Shapes', icon: Square },
  { id: 'background', label: 'BG', icon: Palette },
];

export function LeftRail() {
  const left = useEditorSession((s) => s.leftPanel);
  const setLeft = useEditorSession((s) => s.setLeftPanel);
  return (
    <div className="w-16 bg-bg-rail border-r border-line flex flex-col">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = left === t.id;
        return (
          <button
            key={t.id}
            className={`rail-btn ${active ? 'rail-btn-active' : ''}`}
            onClick={() => setLeft(t.id)}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
