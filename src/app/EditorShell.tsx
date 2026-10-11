import { useEffect, useState } from 'react';
import { Grid3x3, Image, Keyboard, Layers, Palette, Shapes, SlidersHorizontal, Type, X } from 'lucide-react';
import { Canvas } from '@/components/canvas/Canvas';
import { Inspector } from '@/components/Inspector';
import { LayersPanel } from '@/components/LayersPanel';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { PhotosPanel } from '@/components/panels/PhotosPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { ShapesPanel } from '@/components/panels/ShapesPanel';
import { BackgroundPanel } from '@/components/panels/BackgroundPanel';
import { useEditorView } from '@/editor/viewStore';
import { useEditorSession, type LeftPanel } from '@/editor/sessionStore';
import { useEditorShellEvents, useStageMeasurement } from './shells/shared/useEditorShell';
import { EditorShellServices } from './shells/shared/EditorShellServices';
import { StudioCommands, StudioPublish, runStudioAction } from './shells/studio/StudioControls';
import { StudioTimeline } from './shells/studio/StudioTimeline';
import { StudioSelectionToolbar } from './shells/studio/StudioSelectionToolbar';

const TOOLS = [
  { id: 'templates', label: 'Grids', Icon: Grid3x3 },
  { id: 'photos', label: 'Media', Icon: Image },
  { id: 'text', label: 'Text', Icon: Type },
  { id: 'shapes', label: 'Shapes', Icon: Shapes },
  { id: 'background', label: 'Background', Icon: Palette },
] as const;

function StudioPanel({ panel }: { panel: LeftPanel }) {
  if (panel === 'templates') return <TemplatesPanel />;
  if (panel === 'photos') return <PhotosPanel />;
  if (panel === 'text') return <TextPanel />;
  if (panel === 'shapes') return <ShapesPanel />;
  if (panel === 'background') return <BackgroundPanel />;
  return null;
}

export default function EditorShell() {
  const { stageRef, size } = useStageMeasurement();
  const dragHandlers = useEditorShellEvents();
  const panel = useEditorSession((s) => s.leftPanel);
  const panelOpen = useEditorSession((s) => s.leftPanelOpen);
  // The library card animates its width open and closed, so the canvas frame (and its fit) glides
  // instead of jumping. It stays mounted, inert, until its closing animation ends.
  const [panelMounted, setPanelMounted] = useState(panelOpen);
  if (panelOpen && !panelMounted) setPanelMounted(true);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  const [tab, setTab] = useState<'design' | 'layers'>('design');
  const [pinned, setPinned] = useState(false);
  const inspectorOpen = selectedIds.length > 0 || pinned;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || useEditorSession.getState().overlay || useEditorView.getState().previewOpen || document.querySelector('[role="menu"]') || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      useEditorSession.getState().setLeftPanelOpen(false);
      setPinned(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const closeInspector = () => { setPinned(false); useEditorSession.getState().selectLayer(null); };
  return <div className={`studio-shell ${panelOpen ? 'studio-panel-open' : ''} ${inspectorOpen ? 'studio-inspector-open' : ''}`} {...dragHandlers}>
    <div className="studio-top-row"><StudioCommands /><StudioPublish /></div>
    <div className="studio-workspace">
      <nav className="studio-dock studio-glass" aria-label="Tools">
        {TOOLS.map(({ id, label, Icon }) => <button key={id} className={`studio-tool ${panelOpen && panel === id ? 'studio-tool-active' : ''}`} aria-label={label} data-tip={label} aria-pressed={panelOpen && panel === id} onClick={() => { const session = useEditorSession.getState(); if (panelOpen && panel === id) session.setLeftPanelOpen(false); else session.setLeftPanel(id); }}><Icon size={20} strokeWidth={1.75} aria-hidden /></button>)}
        <span className="studio-dock-divider" aria-hidden />
        <button className="studio-tool" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts  ?" onClick={() => runStudioAction('shortcuts')}><Keyboard size={18} aria-hidden /></button>
      </nav>
      {panelMounted && <aside className="studio-left-panel studio-glass" data-state={panelOpen ? 'open' : 'closing'} inert={!panelOpen} aria-hidden={!panelOpen || undefined} aria-label={`${TOOLS.find((tool) => tool.id === panel)?.label ?? 'Tools'} panel`} onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === 'studio-panel-close' && !useEditorSession.getState().leftPanelOpen) setPanelMounted(false); }}>
        <div className="studio-left-panel-inner">
          <div className="studio-panel-heading"><span className="studio-panel-eyebrow">Library</span><button className="icon-btn" aria-label="Hide side panel" title="Hide side panel" onClick={() => useEditorSession.getState().setLeftPanelOpen(false)}><X size={15} aria-hidden /></button></div>
          <div className="studio-panel-content"><StudioPanel panel={panel} /></div>
        </div>
      </aside>}
      <main ref={stageRef} className="studio-stage" aria-label="Canvas workspace"><Canvas width={size.width} height={size.height} /><StudioSelectionToolbar frameRef={stageRef} width={size.width} height={size.height} /></main>
      {inspectorOpen ? <aside className="studio-inspector studio-glass" aria-label="Properties">
        <div className="studio-inspector-tabs" role="tablist" aria-label="Properties">
          <button role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>Design</button>
          <button role="tab" aria-selected={tab === 'layers'} onClick={() => setTab('layers')}>Layers</button>
          <button className="icon-btn ml-auto" aria-label="Close properties" onClick={closeInspector}><X size={15} aria-hidden /></button>
        </div>
        <div className="studio-inspector-content scrollbar-thin" role="tabpanel">{tab === 'design' ? <Inspector onShowLayers={() => setTab('layers')} /> : <LayersPanel onEditLayer={() => setTab('design')} />}</div>
      </aside> : <div className="studio-properties-pill studio-glass"><button className="btn btn-ghost" onClick={() => { setTab('layers'); setPinned(true); }}><Layers size={15} aria-hidden />Layers</button><span className="studio-divider" aria-hidden /><button className="icon-btn" aria-label="Slide design" title="Slide design" onClick={() => { setTab('design'); setPinned(true); }}><SlidersHorizontal size={15} aria-hidden /></button></div>}
    </div>
    <StudioTimeline />
    <EditorShellServices />
  </div>;
}
