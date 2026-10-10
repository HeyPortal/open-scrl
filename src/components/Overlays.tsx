import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Command, Search, X } from 'lucide-react';
import { useEditorSession } from '@/editor/sessionStore';
import { buildActions, formatBinding, isMac, type Action, type ActionGroup } from '@/app/actions';

const GROUP_ORDER: ActionGroup[] = ['Insert', 'Edit', 'Arrange', 'Slide', 'View', 'Panels', 'Export', 'Project', 'Grids'];

function Dialog({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[1050] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className={`w-full overflow-hidden rounded-xl border border-line-strong bg-bg-overlay shadow-lift ${className}`}>
        {children}
      </div>
    </div>
  );
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, i) => <kbd key={`${key}-${i}`} className="kbd">{key}</kbd>)}
    </span>
  );
}

function matches(action: Action, query: string) {
  if (!query) return action.group !== 'Grids';
  const haystack = `${action.label} ${action.group} ${action.keywords ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((token) => haystack.includes(token));
}

export function CommandPalette() {
  const setOverlay = useEditorSession((s) => s.setOverlay);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const actions = useMemo(() => buildActions().filter((a) => !a.hidden && (!a.enabled || a.enabled())), []);
  const results = useMemo(() => {
    const found = actions.filter((a) => matches(a, query.trim()));
    return found.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }, [actions, query]);
  const close = () => setOverlay(null);
  const run = (action: Action | undefined) => {
    if (!action) return;
    close();
    action.run();
  };

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Dialog label="Command palette" onClose={close} className="max-w-[560px]">
      <div className="flex items-center gap-2.5 border-b border-line px-3.5">
        <Search size={15} className="shrink-0 text-ink-faint" aria-hidden />
        <input
          autoFocus
          className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-0"
          placeholder="Type a command…"
          aria-label="Search commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
        <kbd className="kbd">Esc</kbd>
      </div>
      <div ref={listRef} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto p-1.5 scrollbar-thin">
        {results.length === 0 && <p className="px-3 py-8 text-center text-xs text-ink-faint">No matching commands.</p>}
        {results.map((action, index) => (
          <div key={action.id}>
            {(index === 0 || results[index - 1].group !== action.group) && (
              <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{action.group}</p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              data-index={index}
              data-active={index === active}
              className="menu-item group h-8"
              onMouseMove={() => setActive(index)}
              onClick={() => run(action)}
            >
              <span className="truncate">{action.label}</span>
              {action.keys?.[0] && (
                <span className="ml-auto flex items-center gap-0.5 text-[11px] text-ink-faint group-data-[active=true]:text-white/80">
                  {formatBinding(action.keys[0]).join(' ')}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1"><Keys keys={['↑', '↓']} /> navigate</span>
        <span className="flex items-center gap-1"><Keys keys={['↵']} /> run</span>
        <span className="ml-auto flex items-center gap-1"><Command size={11} aria-hidden /> {isMac ? '⌘K' : 'Ctrl K'} anytime</span>
      </div>
    </Dialog>
  );
}

const EXTRA_SHORTCUTS: { group: ActionGroup; label: string; keys: string[] }[] = [
  { group: 'Edit', label: 'Nudge layer (⇧ for 10 px)', keys: ['←', '↑', '→', '↓'] },
  { group: 'Edit', label: 'Edit text in place', keys: ['Double-click'] },
  { group: 'Edit', label: 'Layer and slide actions', keys: ['Right-click'] },
  { group: 'Slide', label: 'Previous / next slide (nothing selected)', keys: ['←', '→'] },
  { group: 'View', label: 'Command palette', keys: [isMac ? '⌘' : 'Ctrl', 'K'] },
  { group: 'View', label: 'Pan canvas', keys: ['Scroll'] },
  { group: 'View', label: 'Zoom canvas', keys: [isMac ? '⌘' : 'Ctrl', 'Scroll'] },
];

export function ShortcutsDialog() {
  const setOverlay = useEditorSession((s) => s.setOverlay);
  const close = () => setOverlay(null);
  const groups = useMemo(() => {
    const rows = [
      ...buildActions().filter((a) => a.keys?.length && !a.hidden).map((a) => ({ group: a.group, label: a.label, keys: formatBinding(a.keys![0]) })),
      ...EXTRA_SHORTCUTS,
    ];
    return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Dialog label="Keyboard shortcuts" onClose={close} className="max-w-[980px]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="heading-md">Keyboard shortcuts</h2>
        <button className="icon-btn" onClick={close} title="Close" aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <div className="grid max-h-[72vh] gap-x-8 gap-y-5 overflow-y-auto p-4 scrollbar-thin sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ group, rows }) => (
          <section key={group}>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{group}</h3>
            <ul>
              {rows.map((row) => (
                <li key={row.label} className="flex h-7 items-center justify-between gap-3 text-xs text-ink-dim">
                  <span className="truncate">{row.label}</span>
                  <Keys keys={row.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function EditorOverlays() {
  const overlay = useEditorSession((s) => s.overlay);
  if (overlay === 'palette') return <CommandPalette />;
  if (overlay === 'shortcuts') return <ShortcutsDialog />;
  return null;
}
