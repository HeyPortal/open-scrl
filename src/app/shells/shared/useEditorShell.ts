import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useAssets } from '@/store/assets';
import { isLikelyMediaFile } from '@/lib/assets';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useContextMenu } from '@/components/Menu';
import { handleEditorKey } from '@/app/actions';

/** Attach stageRef to the available canvas frame; pass size to the shared Canvas. */
export function useStageMeasurement() {
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const measure = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    setSize((old) => old.width === next.width && old.height === next.height ? old : next);
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
  return { stageRef, size, measure };
}

/** Shared keyboard guards and root file import, for desktop and hardware keyboards on phones. */
export function useEditorShellEvents() {
  const importFiles = useAssets((s) => s.importFiles);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useEditorSession.getState().overlay || useEditorView.getState().previewOpen || useContextMenu.getState().menu) return;
      handleEditorKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return {
    onDragOver: (e: DragEvent<HTMLDivElement>) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); },
    onDrop: async (e: DragEvent<HTMLDivElement>) => {
      if (e.defaultPrevented) return;
      const files = Array.from(e.dataTransfer.files).filter(isLikelyMediaFile);
      if (!files.length) return;
      e.preventDefault();
      await importFiles(files);
    },
  };
}
