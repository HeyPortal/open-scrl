import { Images, LayoutGrid, Layers, PaintBucket, Shapes, Type, type LucideIcon } from 'lucide-react';

export type DockTab = 'photos' | 'grids' | 'text' | 'shapes' | 'canvas' | 'layers';

const TABS: { id: DockTab; label: string; Icon: LucideIcon }[] = [
  { id: 'photos', label: 'Photos', Icon: Images },
  { id: 'grids', label: 'Grids', Icon: LayoutGrid },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'shapes', label: 'Shapes', Icon: Shapes },
  { id: 'canvas', label: 'Canvas', Icon: PaintBucket },
  { id: 'layers', label: 'Layers', Icon: Layers },
];

export const isDockTab = (value: string | null): value is DockTab => TABS.some((tab) => tab.id === value);

/** Tool tabs along the bottom edge. Each opens the matching sheet; the active one closes it again. */
export function MobileDock({ active, onSelect }: { active: DockTab | null; onSelect: (tab: DockTab) => void }) {
  return (
    <nav
      role="tablist"
      aria-label="Editor tools"
      className="mobile-dock flex shrink-0 items-stretch border-t border-line bg-bg-rail/90 backdrop-blur"
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(id)}
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 ${
              selected ? 'text-ink' : 'text-ink-dim active:text-ink'
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-1/2 top-0 h-[3px] w-7 -translate-x-1/2 rounded-b-full bg-accent transition-opacity duration-150 ${
                selected ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <Icon size={22} strokeWidth={selected ? 2.25 : 1.85} aria-hidden className={selected ? 'text-accent' : undefined} />
            <span className="text-[11px] font-medium leading-none">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
