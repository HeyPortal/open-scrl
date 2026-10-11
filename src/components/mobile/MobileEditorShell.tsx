import { EditorShellServices } from '@/app/shells/shared/EditorShellServices';
import { useEditorShellEvents, useStageMeasurement } from '@/app/shells/shared/useEditorShell';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { Canvas } from '@/components/canvas/Canvas';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { PhotosPanel } from '@/components/panels/PhotosPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { ShapesPanel } from '@/components/panels/ShapesPanel';
import { BackgroundPanel } from '@/components/panels/BackgroundPanel';
import { LayersPanel } from '@/components/LayersPanel';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
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
      <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold tabular-nums text-white ring-1 ring-inset ring-white/10">
        {position + 1} / {count}
      </span>
    </div>
  );
}

/** Mobile editor: top bar, canvas, slide strip, tool dock and bottom sheets. */
export default function MobileEditorShell() {
  const dragHandlers = useEditorShellEvents();
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
    if (next !== sheet) setDetent(next === 'export' ? 'full' : 'half');
    if (next !== 'layers') setMultiSelect(false);
    setOpenSheet(next);
  };
  const close = () => {
    setMultiSelect(false);
    setOpenSheet(null);
  };

  const { stageRef, size, measure } = useStageMeasurement();
  // Sheets and the selection bar change the canvas height. Measure before paint
  // so the first tap after closing a sheet uses the visible layer positions.
  useLayoutEffect(measure, [measure, sheet, hasSelection]);

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
      className={`sheet-action relative flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors ${
        multiSelect ? 'bg-accent text-accent-ink' : 'bg-bg-inset text-ink-dim active:bg-bg-hover'
      }`}
    >
      <ListChecks size={16} aria-hidden /> Select
    </button>
  ) : undefined;

  return (
    <div
      className="mobile-root"
      {...dragHandlers}
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

      <EditorShellServices />
    </div>
  );
}
