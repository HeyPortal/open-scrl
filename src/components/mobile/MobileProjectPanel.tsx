import { Check, ChevronLeft } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { FORMATS } from '@/lib/format';
import { goToProjects } from './editorActions';

/** Rename the project, pick its canvas format, or head back to the project list. */
export function MobileProjectPanel() {
  const docName = useEditor((s) => s.doc.name);
  const setDocName = useEditor((s) => s.setDocName);
  const format = useEditor((s) => s.doc.format);
  const setFormat = useEditor((s) => s.setFormat);

  return (
    <div className="space-y-5 px-4 pb-4 pt-1">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-dim">Project name</span>
        <input
          className="h-12 w-full rounded-xl border border-transparent bg-bg-inset px-3.5 font-medium text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="words"
          placeholder="Untitled"
        />
      </label>

      <div role="radiogroup" aria-label="Canvas format">
        <span className="mb-1.5 block text-[12px] font-medium text-ink-dim">Canvas format</span>
        <div className="grid grid-cols-2 gap-2">
          {FORMATS.map((f) => {
            const selected = f.name === format.name;
            const ratio = f.width / f.height;
            // Draw each format's proportions inside a fixed 28px box.
            const w = ratio >= 1 ? 28 : Math.round(28 * ratio);
            const h = ratio >= 1 ? Math.round(28 / ratio) : 28;
            return (
              <button
                key={f.name}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setFormat(f)}
                className={`relative flex min-h-[60px] items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors duration-150 ${
                  selected ? 'bg-accent-soft ring-accent' : 'bg-bg-inset ring-transparent active:bg-bg-hover'
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <span className={`block rounded-[3px] ${selected ? 'bg-accent' : 'bg-ink-faint/70'}`} style={{ width: w, height: h }} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{f.name}</span>
                  <span className="block text-[11px] tabular-nums text-ink-faint">{f.width} × {f.height}</span>
                </span>
                {selected && <Check size={16} className="shrink-0 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={goToProjects}
        className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-bg-inset text-[14px] font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors active:bg-bg-hover"
      >
        <ChevronLeft size={18} aria-hidden /> Back to projects
      </button>
    </div>
  );
}
