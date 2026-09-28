import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Check } from 'lucide-react';

export type MenuEntry =
  | { label: string; onSelect: () => void; shortcut?: string[]; icon?: ReactNode; disabled?: boolean; danger?: boolean; checked?: boolean }
  | { separator: true };

export function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="ml-auto flex items-center gap-0.5 pl-4 text-[11px] text-ink-faint group-data-[active=true]:text-white/80">
      {keys.map((key) => <span key={key}>{key}</span>)}
    </span>
  );
}

/** Keyboard-navigable list of menu items. */
export function MenuList({ items, onClose, label }: { items: MenuEntry[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const selectable = items.map((item, index) => ('separator' in item || item.disabled ? -1 : index)).filter((i) => i >= 0);

  useEffect(() => { ref.current?.focus(); }, []);

  const move = (dir: 1 | -1) => {
    if (!selectable.length) return;
    const at = selectable.indexOf(active);
    setActive(selectable[(at + dir + selectable.length) % selectable.length] ?? selectable[0]);
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className="menu outline-none focus-visible:ring-0"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === 'Enter' && active >= 0) {
          e.preventDefault();
          const item = items[active];
          if (!('separator' in item)) { onClose(); item.onSelect(); }
        }
        e.stopPropagation();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) =>
        'separator' in item ? (
          <div key={`sep-${index}`} className="menu-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            data-active={active === index}
            className={`menu-item group ${item.danger ? 'text-red-300 data-[active=true]:!bg-red-500 data-[active=true]:!text-white' : ''}`}
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => { onClose(); item.onSelect(); }}
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-ink-dim group-data-[active=true]:text-white">
              {item.checked ? <Check size={13} aria-hidden /> : item.icon}
            </span>
            <span className="truncate">{item.label}</span>
            {item.shortcut && <Shortcut keys={item.shortcut} />}
          </button>
        ),
      )}
    </div>
  );
}

/** Positions children at a viewport point, flipping to stay on screen. */
function Floating({ x, y, onClose, ignore, children }: { x: number; y: number; onClose: () => void; ignore?: RefObject<HTMLElement | null>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
    });
  }, [x, y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !ignore?.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [ignore, onClose]);
  return createPortal(
    <div ref={ref} className="fixed z-[1100]" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>,
    document.body,
  );
}

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuEntry[]; label: string } | null;
  open: (x: number, y: number, items: MenuEntry[], label?: string) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  open: (x, y, items, label = 'Context menu') => set({ menu: { x, y, items, label } }),
  close: () => set({ menu: null }),
}));

export function ContextMenuHost() {
  const menu = useContextMenu((s) => s.menu);
  const close = useContextMenu((s) => s.close);
  if (!menu) return null;
  return (
    <Floating x={menu.x} y={menu.y} onClose={close}>
      <MenuList items={menu.items} onClose={close} label={menu.label} />
    </Floating>
  );
}

/** A button that toggles a dropdown menu anchored beneath it. */
export function DropdownMenu({
  items,
  label,
  align = 'start',
  className = '',
  title,
  children,
}: {
  items: MenuEntry[] | (() => MenuEntry[]);
  label: string;
  align?: 'start' | 'end';
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = () => setAnchor(null);
  const toggle = () => {
    if (anchor) return close();
    const rect = button.current!.getBoundingClientRect();
    setAnchor({ x: align === 'end' ? rect.right - 220 : rect.left, y: rect.bottom + 4 });
  };
  return (
    <>
      <button ref={button} type="button" className={className} aria-haspopup="menu" aria-expanded={!!anchor} aria-label={label} title={title} onClick={toggle}>
        {children}
      </button>
      {anchor && (
        <Floating x={anchor.x} y={anchor.y} onClose={close} ignore={button}>
          <div className="w-[220px]">
            <MenuList items={typeof items === 'function' ? items() : items} onClose={close} label={label} />
          </div>
        </Floating>
      )}
    </>
  );
}
