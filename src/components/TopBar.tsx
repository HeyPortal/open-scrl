import {
  Check,
  ChevronDown,
  Circle,
  CloudOff,
  Command,
  Download,
  GalleryHorizontal,
  House,
  ImagePlus,
  Loader2,
  Minus,
  Package,
  Plus,
  Redo2,
  Square,
  Type,
  Undo2,
  Smartphone,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { FORMATS } from '@/lib/format';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { useEditorView } from '@/editor/viewStore';
import { buildActions, formatBinding, type Action } from '@/app/actions';
import { DropdownMenu, type MenuEntry } from './Menu';

function actionItems(ids: (string | '-')[]): MenuEntry[] {
  const byId = new Map(buildActions().map((a) => [a.id, a] as [string, Action]));
  return ids.flatMap((id): MenuEntry[] => {
    if (id === '-') return [{ separator: true }];
    const a = byId.get(id);
    return a ? [{ label: a.label, onSelect: a.run, disabled: a.enabled ? !a.enabled() : false, shortcut: a.keys?.[0] ? formatBinding(a.keys[0]) : undefined }] : [];
  });
}

/** Tooltip text with the action's first shortcut, e.g. "Undo (⌘ Z)". */
function hint(label: string, id: string) {
  const keys = buildActions().find((a) => a.id === id)?.keys?.[0];
  return keys ? `${label} (${formatBinding(keys).join(' ')})` : label;
}

function SaveIndicator() {
  const status = useEditorSession((s) => s.saveStatus);
  const saveError = useEditor((s) => s.saveError);
  if (saveError) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-300" title="Latest changes are not saved">
        <CloudOff size={14} aria-hidden /> <span className="hidden xl:inline">Not saved</span>
      </span>
    );
  }
  const saving = status !== 'saved';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint" aria-live="polite" title="Changes autosave in this browser">
      {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} className="text-emerald-400" aria-hidden />}
      <span className="hidden xl:inline">{saving ? 'Saving…' : 'Saved'}</span>
    </span>
  );
}

function ZoomControl() {
  const zoom = useEditorSession((s) => s.zoom);
  const fitZoom = useEditorSession((s) => s.fitZoom);
  const setZoom = useEditorSession((s) => s.setZoom);
  const wideMode = useEditorView((s) => s.wideMode);
  const setWideMode = useEditorView((s) => s.setWideMode);
  const presets: MenuEntry[] = [
    ...actionItems(['zoom-in', 'zoom-out', '-', 'zoom-fit']).map((item) => 'label' in item && item.label === 'Zoom to fit' ? { ...item, label: wideMode ? 'Fit the whole strip' : 'Fit one slide' } : item),
    { label: 'Wide view', checked: wideMode, shortcut: ['W'], onSelect: () => setWideMode(!wideMode) },
    { separator: true },
    ...[0.5, 1, 2].map((value) => ({ label: `${value * 100}%`, checked: Math.abs(zoom - value) < 0.005, onSelect: () => setZoom(value), shortcut: value === 1 ? ['⇧', '0'] : undefined })),
  ];
  return (
    <div className="flex items-center rounded-md bg-bg-inset">
      <button className="icon-btn" title={hint('Zoom out', 'zoom-out')} aria-label="Zoom out" onClick={() => setZoom(zoom / 1.25)}>
        <Minus size={14} />
      </button>
      <DropdownMenu
        items={presets}
        label="Zoom options"
        align="end"
        title="Zoom options"
        className={`flex h-7 min-w-[52px] items-center justify-center gap-0.5 rounded-md px-1 text-[11px] font-medium tabular-nums hover:bg-bg-hover ${Math.abs(zoom - fitZoom) < 0.005 ? 'text-ink-dim' : 'text-ink'}`}
      >
        {Math.round(zoom * 100)}%
        <ChevronDown size={11} className="text-ink-faint" aria-hidden />
      </DropdownMenu>
      <button className="icon-btn" title={hint('Zoom in', 'zoom-in')} aria-label="Zoom in" onClick={() => setZoom(zoom * 1.25)}>
        <Plus size={14} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-line-strong" aria-hidden />
      <button
        className={`icon-btn ${wideMode ? 'icon-btn-active' : ''}`}
        title={hint(wideMode ? 'Back to one slide' : 'Wide view: the whole carousel as one strip', 'wide-mode')}
        aria-label="Wide view"
        aria-pressed={wideMode}
        onClick={() => setWideMode(!wideMode)}
      >
        <GalleryHorizontal size={15} />
      </button>
    </div>
  );
}

export function TopBar() {
  const docName = useEditor((s) => s.doc.name);
  const setDocName = useEditor((s) => s.setDocName);
  const format = useEditor((s) => s.doc.format);
  const setFormat = useEditor((s) => s.setFormat);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const requestImport = useEditorSession((s) => s.requestImport);
  const setOverlay = useEditorSession((s) => s.setOverlay);
  const exporting = useExport((s) => s.exporting);
  const setPreviewOpen = useEditorView((s) => s.setPreviewOpen);
  const progress = useExport((s) => s.progress);
  const exportCurrentSlide = useExport((s) => s.exportCurrentSlide);
  const exportCarousel = useExport((s) => s.exportCarousel);
  const goProjects = () => buildActions().find((a) => a.id === 'go-projects')?.run();

  return (
    <header className="relative z-20 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-rail px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <DropdownMenu
          label="Main menu"
          title="Main menu"
          className="flex h-8 items-center gap-1 rounded-md px-1.5 hover:bg-bg-hover"
          items={() => actionItems(['go-projects', 'new-project', 'rename-project', '-', 'palette', 'shortcuts', '-', 'export-carousel', 'export-slide'])}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" /><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".55" /><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".55" /><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" /></svg>
          </span>
          <ChevronDown size={12} className="text-ink-faint" aria-hidden />
        </DropdownMenu>
        <button className="btn btn-ghost btn-sm gap-1 px-2 text-ink-dim" title="Projects" onClick={goProjects}>
          <House size={14} className="xl:hidden" aria-hidden />
          <span className="hidden xl:inline">Projects</span>
        </button>
        <span className="text-ink-faint" aria-hidden>/</span>
        <input
          data-project-name
          className="input w-36 min-w-0 bg-transparent font-medium xl:w-48"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          aria-label="Project name"
          placeholder="Untitled"
        />
        <select
          className="input w-auto max-w-[184px] bg-transparent text-ink-dim"
          value={format.name}
          onChange={(e) => {
            const f = FORMATS.find((x) => x.name === e.target.value);
            if (f) setFormat(f);
          }}
          title="Canvas format"
          aria-label="Canvas format"
        >
          {FORMATS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} · {f.width}×{f.height}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-bg-panel p-0.5 ring-1 ring-line">
        <button className="icon-btn" disabled={past === 0} onClick={undo} title={hint('Undo', 'undo')} aria-label="Undo">
          <Undo2 size={15} />
        </button>
        <button className="icon-btn" disabled={future === 0} onClick={redo} title={hint('Redo', 'redo')} aria-label="Redo">
          <Redo2 size={15} />
        </button>
        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
        <button className="icon-btn" onClick={() => addTextLayer()} title={hint('Text', 'add-text')} aria-label="Add text">
          <Type size={15} />
        </button>
        <button className="icon-btn" onClick={() => addShapeLayer('rect')} title={hint('Rectangle', 'add-rect')} aria-label="Add rectangle">
          <Square size={15} />
        </button>
        <button className="icon-btn" onClick={() => addShapeLayer('ellipse')} title={hint('Ellipse', 'add-ellipse')} aria-label="Add ellipse">
          <Circle size={15} />
        </button>
        <button className="icon-btn" onClick={requestImport} title="Import media" aria-label="Import media">
          <ImagePlus size={15} />
        </button>
        <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden />
        <button className="icon-btn" onClick={() => setOverlay('palette')} title={hint('Command palette', 'palette')} aria-label="Command palette">
          <Command size={14} />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <ZoomControl />
        <div className="flex min-w-0 items-center px-1">
          {progress ? (
            <span className="inline-flex max-w-44 items-center gap-1.5 truncate text-[11px] text-ink-dim">
              <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden /> {progress}
            </span>
          ) : (
            <SaveIndicator />
          )}
        </div>
        <button className="btn btn-secondary" onClick={() => setPreviewOpen(true)} title={hint('Preview on a phone', 'preview')}>
          <Smartphone size={14} aria-hidden /> <span className="hidden xl:inline">Preview</span><span className="sr-only xl:hidden">Preview</span>
        </button>
        <button className="btn btn-secondary" disabled={exporting} onClick={() => void exportCurrentSlide()} title="Download the selected slide as a PNG">
          <Download size={14} aria-hidden /> <span className="hidden xl:inline">Slide PNG</span><span className="sr-only xl:hidden">Slide PNG</span>
        </button>
        <button
          className="btn btn-primary"
          disabled={exporting}
          onClick={() => void exportCarousel()}
          title={hint('Export every slide as separate PNG or MP4 files', 'export-carousel')}
        >
          <Package size={14} aria-hidden /> Export Carousel
        </button>
      </div>
    </header>
  );
}
