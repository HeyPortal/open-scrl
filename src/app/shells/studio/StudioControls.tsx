import { Check, ChevronDown, CloudOff, Download, GalleryHorizontal, House, Loader2, Minus, Package, Plus, Redo2, Search, Smartphone, Undo2 } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { buildActions, formatBinding, isMac } from '@/app/actions';
import { DropdownMenu, type MenuEntry } from '@/components/Menu';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useExport } from '@/editor/exportStore';
import { FORMATS } from '@/lib/format';

const PALETTE_KEYS = formatBinding({ key: 'k', mod: true }).join(isMac ? '' : '+');

export function runStudioAction(id: string) {
  const action = buildActions().find((item) => item.id === id);
  if (action && (!action.enabled || action.enabled())) action.run();
}

export function studioActionItems(ids: string[]): MenuEntry[] {
  const actions = new Map(buildActions().map((action) => [action.id, action]));
  return ids.flatMap((id): MenuEntry[] => {
    if (id === '-') return [{ separator: true }];
    const action = actions.get(id);
    return action ? [{ label: action.label, onSelect: action.run, disabled: action.enabled ? !action.enabled() : false, shortcut: action.keys?.[0] ? formatBinding(action.keys[0]) : undefined }] : [];
  });
}

export function StudioCommands() {
  const name = useEditor((s) => s.doc.name);
  const format = useEditor((s) => s.doc.format);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  return <header className="studio-command-island studio-glass" aria-label="Project commands">
    <DropdownMenu label="Main menu" title="Main menu" className="studio-menu-button" items={() => studioActionItems(['go-projects', 'new-project', 'rename-project', '-', 'import-media', 'add-text', 'add-rect', 'add-ellipse', '-', 'palette', 'shortcuts', '-', 'export-carousel', 'export-slide'])}>
      <AppLogo size={24} /><ChevronDown size={11} aria-hidden />
    </DropdownMenu>
    <button className="icon-btn" title="Projects" aria-label="Projects" onClick={() => runStudioAction('go-projects')}><House size={16} aria-hidden /></button>
    <input data-project-name className="input studio-project-name" aria-label="Project name" placeholder="Untitled" value={name} onChange={(e) => useEditor.getState().setDocName(e.target.value)} />
    <select className="input studio-format-chip" aria-label="Canvas format" title="Canvas format" value={format.name} onChange={(e) => { const next = FORMATS.find((f) => f.name === e.target.value); if (next) useEditor.getState().setFormat(next); }}>
      {FORMATS.map((f) => <option key={f.name} value={f.name}>{f.name} · {f.width}×{f.height}</option>)}
    </select>
    <span className="studio-divider" aria-hidden />
    <button className="icon-btn" aria-label="Undo" title="Undo" disabled={!past} onClick={() => runStudioAction('undo')}><Undo2 size={16} aria-hidden /></button>
    <button className="icon-btn" aria-label="Redo" title="Redo" disabled={!future} onClick={() => runStudioAction('redo')}><Redo2 size={16} aria-hidden /></button>
    <span className="studio-divider" aria-hidden />
    <button className="studio-search" aria-label="Command palette" onClick={() => runStudioAction('palette')}><Search size={14} aria-hidden /><span>Search actions…</span><kbd>{PALETTE_KEYS}</kbd></button>
  </header>;
}

export function StudioPublish() {
  const status = useEditorSession((s) => s.saveStatus);
  const saveError = useEditor((s) => s.saveError);
  const exporting = useExport((s) => s.exporting);
  const progress = useExport((s) => s.progress);
  return <div className="studio-publish-island studio-glass" aria-label="Save and export">
    <span className={`studio-save ${saveError ? 'text-danger' : 'text-ink-dim'}`} role="status" title={progress ?? 'Changes autosave in this browser'} aria-live="polite">
      {saveError ? <CloudOff size={14} aria-hidden /> : status !== 'saved' || progress ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} className="text-success" aria-hidden />}
      <span>{saveError ? 'Not saved' : progress ? 'Exporting…' : status === 'saved' ? 'Saved' : 'Saving…'}</span>
    </span>
    <button className="btn btn-ghost" title="Preview on a phone" onClick={() => runStudioAction('preview')}><Smartphone size={16} aria-hidden /><span>Preview</span></button>
    <span className="studio-divider" aria-hidden />
    <button className="btn btn-primary" aria-label="Export Carousel" aria-busy={exporting} onClick={() => runStudioAction('export-carousel')}>{exporting ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Package size={15} aria-hidden />}Export<ChevronDown size={13} aria-hidden /></button>
  </div>;
}

export function StudioViewControls() {
  const zoom = useEditorSession((s) => s.zoom);
  const wide = useEditorView((s) => s.wideMode);
  const exporting = useExport((s) => s.exporting);
  return <div className="studio-view-controls">
    <div className="studio-zoom">
      <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => runStudioAction('zoom-out')}><Minus size={14} aria-hidden /></button>
      <DropdownMenu label="Zoom options" title="Zoom options" className="studio-zoom-value" align="end" items={() => [...studioActionItems(['zoom-fit', 'zoom-100']), { separator: true }, ...[0.5, 1, 2].map((value) => ({ label: `${value * 100}%`, onSelect: () => useEditorSession.getState().setZoom(value) }))]}>{Math.round(zoom * 100)}%<ChevronDown size={11} aria-hidden /></DropdownMenu>
      <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => runStudioAction('zoom-in')}><Plus size={14} aria-hidden /></button>
      <button className="icon-btn studio-fit" aria-label="Zoom to fit" title="Zoom to fit" onClick={() => runStudioAction('zoom-fit')}>Fit</button>
      <button className={`icon-btn ${wide ? 'icon-btn-active' : ''}`} aria-label="Wide view" title="Wide view" aria-pressed={wide} onClick={() => runStudioAction('wide-mode')}><GalleryHorizontal size={17} aria-hidden /></button>
    </div>
    <div className="studio-view-footer"><button className="btn btn-ghost btn-sm" disabled={exporting} onClick={() => runStudioAction('export-slide')} title="Download the selected slide as a PNG"><Download size={13} aria-hidden />Slide PNG</button></div>
  </div>;
}
