import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { Canvas } from '@/components/canvas/Canvas';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { PhotosPanel } from '@/components/panels/PhotosPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { ShapesPanel } from '@/components/panels/ShapesPanel';
import { BackgroundPanel } from '@/components/panels/BackgroundPanel';
import { LayersPanel } from '@/components/LayersPanel';
import { ContextMenuHost, useContextMenu } from '@/components/Menu';
import { EditorOverlays } from '@/components/Overlays';
import { PhonePreview } from '@/components/preview/PhonePreview';
import { handleEditorKey } from '@/app/actions';
import { isLikelyMediaFile } from '@/lib/assets';
import { useAssets } from '@/store/assets';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { BottomSheet, type SheetDetent } from './BottomSheet';
import { MobileDock, isDockTab } from './MobileDock';
import { MobileExportPanel } from './MobileExportPanel';
import { MobileInspector } from './MobileInspector';
import { MobileProjectPanel } from './MobileProjectPanel';
import { MobileSelectionBar } from './MobileSelectionBar';
import { MobileSlideStrip } from './MobileSlideStrip';
import { MobileTopBar } from './MobileTopBar';
import './mobile.css';

type Sheet = null | 'photos' | 'grids' | 'text' | 'shapes' | 'canvas' | 'layers' | 'inspect' | 'export' | 'project';

const SHEET_TITLES: Record<Exclude<Sheet, null | 'inspect'>, string> = {
  photos: 'Photos',
  grids: 'Grids',
  text: 'Text',
  shapes: 'Shapes',
  canvas: 'Canvas',
  layers: 'Layers',
  export: 'Export',
  project: 'Project',
};

/** Title for the inspector sheet: the layer's kind, or how many are selected. */
function useInspectTitle(ids: string[]) {
  return useEditor((s) => {
    if (ids.length !== 1) return `${ids.length} layers`;
    const kind = s.doc.layers[ids[0]]?.kind;
    return kind === 'image' ? 'Photo' : kind === 'text' ? 'Text' : kind === 'shape' ? 'Shape' : 'Layer';
  });
}

function SlideCounter() {
  const selected = useEditorSession((s) => s.selectedSlideId);
  const position = useEditor((s) => Math.max(0, s.doc.slideOrder.indexOf(selected)));
  const count = useEditor((s) => s.doc.slideOrder.length);
  return (
    <div
      role="status"
      aria-label={`Slide ${position + 1} of ${count}`}
      className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
    >
      <span className="rounded-full bg-black/55 px-3 py-1 text-[12px] font-semibold tabular-nums text-white backdrop-blur">
        {position + 1} / {count}
      </span>
    </div>
  );
}

/** Mobile editor: top bar, canvas, slide strip, tool dock and bottom sheets. */
export default function MobileEditorShell() {
  const importFiles = useAssets((s) => s.importFiles);
  const previewOpen = useEditorView((s) => s.previewOpen);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  const hasSelection = selectedIds.length > 0;
  const inspectTitle = useInspectTitle(selectedIds);

  const [openSheet, setOpenSheet] = useState<Sheet>(null);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const [multiSelect, setMultiSelect] = useState(false);
  // The inspector has nothing to show once the selection is gone.
  const sheet: Sheet = openSheet === 'inspect' && !hasSelection ? null : openSheet;

  useEffect(() => {
    if (openSheet === 'inspect' && !hasSelection) setOpenSheet(null);
  }, [openSheet, hasSelection]);

  const open = (next: Exclude<Sheet, null>) => {
    if (next !== sheet) setDetent('half');
    if (next !== 'layers') setMultiSelect(false);
    setOpenSheet(next);
  };
  const close = () => {
    setMultiSelect(false);
    setOpenSheet(null);
  };

  // Stage measurement, as in the desktop shell.
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const measure = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    setSize((old) => (old.width === next.width && old.height === next.height ? old : next));
  }, []);
  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const schedule = () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [measure]);

  // Hardware keyboards (iPad, Bluetooth) get the same shortcuts as desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useEditorSession.getState().overlay || useEditorView.getState().previewOpen || useContextMenu.getState().menu) return;
      handleEditorKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toolSheet = isDockTab(sheet);
  const title = sheet === 'inspect' ? inspectTitle : sheet ? SHEET_TITLES[sheet] : '';

  let body: ReactNode = null;
  if (sheet === 'photos') body = <PhotosPanel layout="sheet" />;
  else if (sheet === 'grids') body = <TemplatesPanel layout="sheet" />;
  else if (sheet === 'text') body = <TextPanel layout="sheet" />;
  else if (sheet === 'shapes') body = <ShapesPanel layout="sheet" />;
  else if (sheet === 'canvas') body = <BackgroundPanel layout="sheet" />;
  else if (sheet === 'layers') body = <LayersPanel layout="sheet" additive={multiSelect} onEditLayer={() => open('inspect')} />;
  else if (sheet === 'inspect') body = <MobileInspector onReplacePhoto={() => open('photos')} />;
  else if (sheet === 'export') body = <MobileExportPanel onDone={close} />;
  else if (sheet === 'project') body = <MobileProjectPanel />;

  const layersAction = sheet === 'layers' ? (
    <button
      type="button"
      aria-pressed={multiSelect}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => setMultiSelect((on) => !on)}
      className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${
        multiSelect ? 'bg-accent text-white' : 'bg-bg-inset text-ink-dim active:bg-bg-hover'
      }`}
    >
      <ListChecks size={16} aria-hidden /> Select
    </button>
  ) : undefined;

  return (
    <div
      className="mobile-root"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={async (e) => {
        if (e.defaultPrevented) return;
        const files = Array.from(e.dataTransfer.files).filter(isLikelyMediaFile);
        if (!files.length) return;
        e.preventDefault();
        await importFiles(files);
      }}
    >
      <MobileTopBar onOpenProject={() => open('project')} onOpenExport={() => open('export')} />

      <div className="mobile-main">
        <div className="mobile-canvas-col">
          <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <Canvas width={size.width} height={size.height} variant="mobile" />
            {/* Short stages (landscape) have no room below the slide for the counter. */}
            {sheet === null && size.height >= 480 && <SlideCounter />}
          </div>
          <MobileSlideStrip visible={sheet === null} />
        </div>

        {sheet && (
          <div className="mobile-sheet-slot">
            <BottomSheet title={title} detent={detent} onDetentChange={setDetent} onClose={close} headerAction={layersAction}>
              {body}
            </BottomSheet>
          </div>
        )}
      </div>

      {!toolSheet && hasSelection ? (
        <MobileSelectionBar onEdit={() => open('inspect')} onReplacePhoto={() => open('photos')} />
      ) : (
        <MobileDock active={toolSheet ? sheet : null} onSelect={(tab) => (tab === sheet ? close() : open(tab))} />
      )}

      <ContextMenuHost />
      <EditorOverlays />
      {previewOpen && <PhonePreview />}
    </div>
  );
}
