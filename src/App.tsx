import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { LeftRail } from './components/LeftRail';
import { RightPanel } from './components/RightPanel';
import { Filmstrip } from './components/Filmstrip';
import { Canvas } from './components/canvas/Canvas';
import { LandingPage } from './components/LandingPage';
import { TemplatesPanel } from './components/panels/TemplatesPanel';
import { PhotosPanel } from './components/panels/PhotosPanel';
import { TextPanel } from './components/panels/TextPanel';
import { ShapesPanel } from './components/panels/ShapesPanel';
import { BackgroundPanel } from './components/panels/BackgroundPanel';
import { ToastViewport } from './components/ToastViewport';
import { useEditor } from './store/editor';
import { useAssets } from './store/assets';
import { isLikelyImageFile } from './lib/assets';

const AUTOSAVE_DELAY_MS = 750;

function PanelContent() {
  const which = useEditor((s) => s.leftPanel);
  switch (which) {
    case 'templates':
      return <TemplatesPanel />;
    case 'photos':
      return <PhotosPanel />;
    case 'text':
      return <TextPanel />;
    case 'shapes':
      return <ShapesPanel />;
    case 'background':
      return <BackgroundPanel />;
    default:
      return null;
  }
}

export default function App() {
  const ready = useEditor((s) => s.ready);
  const activeProjectId = useEditor((s) => s.activeProjectId);
  const loadFromDisk = useEditor((s) => s.loadFromDisk);
  const saveToDisk = useEditor((s) => s.saveToDisk);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const deleteLayer = useEditor((s) => s.deleteLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const doc = useEditor((s) => s.doc);
  const importFiles = useAssets((s) => s.importFiles);
  const loadAssets = useAssets((s) => s.loadAll);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadFromDisk();
    loadAssets();
  }, [loadFromDisk, loadAssets]);

  useEffect(() => {
    if (!ready || !activeProjectId) return;
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void saveToDisk();
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [activeProjectId, doc.updatedAt, ready, saveToDisk]);

  useEffect(() => {
    if (!ready || !activeProjectId) return;

    const flushSave = () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      void saveToDisk();
    };

    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };

    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('blur', flushSave);
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('beforeunload', flushSave);

    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('blur', flushSave);
      window.removeEventListener('pagehide', flushSave);
      window.removeEventListener('beforeunload', flushSave);
    };
  }, [activeProjectId, ready, saveToDisk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (inField) return;
      const sel = useEditor.getState().selectedLayerId;
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteLayer(sel);
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateLayer(sel);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteLayer, duplicateLayer]);

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const measureStage = useCallback(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    setStageSize((prev) =>
      prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!ready || !activeProjectId) return;
    const el = stageWrapRef.current;
    if (!el) return;

    const scheduleMeasure = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measureStage);
    };

    measureStage();
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    window.addEventListener('resize', scheduleMeasure);
    window.visualViewport?.addEventListener('resize', scheduleMeasure);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      window.visualViewport?.removeEventListener('resize', scheduleMeasure);
    };
  }, [activeProjectId, measureStage, ready]);

  if (!ready) {
    return (
      <div className="h-full w-full flex items-center justify-center text-ink-dim">
        Loading…
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <>
        <LandingPage />
        <ToastViewport />
      </>
    );
  }

  return (
    <div
      className="flex flex-col h-full w-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={async (e) => {
        const files = Array.from(e.dataTransfer.files).filter(isLikelyImageFile);
        if (files.length === 0) return;
        e.preventDefault();
        await importFiles(files);
      }}
    >
      <TopBar />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <LeftRail />
        <div className="w-64 shrink-0 bg-bg-panel border-r border-line overflow-hidden">
          <PanelContent />
        </div>
        <div ref={stageWrapRef} className="flex-1 min-w-0 overflow-hidden relative">
          <Canvas width={stageSize.width} height={stageSize.height} />
          <div className="absolute bottom-2 left-2 text-[10px] text-ink-faint pointer-events-none">
            {doc.format.width} × {doc.format.height} · {doc.slides.length} slide
            {doc.slides.length > 1 ? 's' : ''}
          </div>
        </div>
        <RightPanel />
      </div>
      <Filmstrip />
      <ToastViewport />
    </div>
  );
}
