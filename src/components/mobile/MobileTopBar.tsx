import { ChevronDown, ChevronLeft, Loader2, Redo2, Share, Undo2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { goToProjects } from './editorActions';

function SaveDot() {
  const status = useEditorSession((s) => s.saveStatus);
  const saveError = useEditor((s) => s.saveError);
  const label = saveError ? 'Not saved' : status === 'saved' ? 'Saved' : 'Saving';
  const tone = saveError ? 'bg-red-400' : status === 'saved' ? 'bg-transparent' : 'animate-pulse bg-ink-faint';
  return (
    <span role="status" aria-live="polite" className="flex h-2 w-2 shrink-0 items-center justify-center">
      <span className="sr-only">{label}</span>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${tone}`} />
    </span>
  );
}

const barButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-dim transition-colors active:bg-bg-hover active:text-ink disabled:pointer-events-none disabled:opacity-30';

/** Project name, history and export, pinned above the canvas. */
export function MobileTopBar({ onOpenProject, onOpenExport }: { onOpenProject: () => void; onOpenExport: () => void }) {
  const docName = useEditor((s) => s.doc.name);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const exporting = useExport((s) => s.exporting);

  return (
    <header className="mobile-topbar relative z-20 flex shrink-0 items-center border-b border-line bg-bg/85 px-0.5 backdrop-blur">
      <button type="button" className={barButton} aria-label="Projects" onClick={goToProjects}>
        <ChevronLeft size={24} aria-hidden />
      </button>
      <button
        type="button"
        className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full pl-1 pr-1.5 text-left active:bg-bg-hover"
        aria-label={`Project settings: ${docName || 'Untitled'}`}
        onClick={onOpenProject}
      >
        {/* Narrower than 380 px (e.g. 360) the serif name drops to 20 px and the chevron hides, so a
            name like "Florida, mostly" still fits beside undo, redo and Export. */}
        <span className="heading-md min-w-0 truncate text-ink max-[379px]:text-[20px]">{docName || 'Untitled'}</span>
        <SaveDot />
        <ChevronDown size={15} className="shrink-0 text-ink-faint max-[379px]:hidden" aria-hidden />
      </button>
      <button type="button" className={barButton} aria-label="Undo" disabled={past === 0} onClick={undo}>
        <Undo2 size={20} aria-hidden />
      </button>
      {/* The redo target overlaps undo by 4 px; both keep their full 44 px hit box. */}
      <button type="button" className={`${barButton} -ml-1`} aria-label="Redo" disabled={future === 0} onClick={redo}>
        <Redo2 size={20} aria-hidden />
      </button>
      <button type="button" className="flex h-11 shrink-0 items-center px-0.5" aria-label={exporting ? 'Exporting' : 'Export'} onClick={onOpenExport}>
        <span className="flex h-9 items-center gap-1 rounded-full bg-accent pl-2.5 pr-3 text-[15px] font-semibold text-white transition-colors active:bg-accent-hover">
          {exporting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Share size={16} aria-hidden />}
          Export
        </span>
      </button>
    </header>
  );
}
