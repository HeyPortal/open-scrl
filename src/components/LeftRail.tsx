import { Grid3x3, Image, Keyboard, Palette, PanelLeftClose, PanelLeftOpen, Shapes, Type } from 'lucide-react';
import type { LeftPanel } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { isMac } from '@/app/actions';

const TABS: { id: LeftPanel; label: string; icon: typeof Image }[] = [
  { id: 'templates', label: 'Grids', icon: Grid3x3 },
  { id: 'photos', label: 'Media', icon: Image },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'shapes', label: 'Shapes', icon: Shapes },
  { id: 'background', label: 'Background', icon: Palette },
];

export function LeftRail() {
  const left = useEditorSession((s) => s.leftPanel);
  const open = useEditorSession((s) => s.leftPanelOpen);
  const setLeft = useEditorSession((s) => s.setLeftPanel);
  const setOpen = useEditorSession((s) => s.setLeftPanelOpen);
  const setOverlay = useEditorSession((s) => s.setOverlay);
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-bg-rail py-2" aria-label="Tools">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = open && left === t.id;
        return (
          <button
            key={t.id}
            className={`relative flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              active ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:bg-bg-hover hover:text-ink'
            }`}
            onClick={() => setLeft(t.id)}
            aria-pressed={active}
            aria-label={t.label}
            title={t.label}
          >
            {active && <span className="absolute -left-1.5 top-2 h-5 w-0.5 rounded-full bg-accent" aria-hidden />}
            <Icon size={18} strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <button className="icon-btn h-9 w-9 text-ink-faint" onClick={() => setOverlay('shortcuts')} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard size={17} aria-hidden />
        </button>
        <button
          className="icon-btn h-9 w-9 text-ink-faint"
          onClick={() => setOpen(!open)}
          title={`${open ? 'Hide' : 'Show'} side panel (${isMac ? '⌘' : 'Ctrl'} \\)`}
          aria-label={open ? 'Hide side panel' : 'Show side panel'}
        >
          {open ? <PanelLeftClose size={17} aria-hidden /> : <PanelLeftOpen size={17} aria-hidden />}
        </button>
      </div>
    </nav>
  );
}
