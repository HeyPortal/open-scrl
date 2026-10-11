import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditor } from '@/store/editor';
import { ExportPanel } from './ExportPanel';

export function ExportDialog() {
  const projectId = useEditor((s) => s.doc.id);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useEditorSession.getState().setOverlay(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); useEditorSession.getState().setOverlay(null); }
      if (event.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary') ?? [])].filter((element) => element.getClientRects().length > 0 && element.tabIndex >= 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div className="studio-scrim export-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Export" className="studio-dialog export-dialog">
      <div className="studio-dialog-head"><h2 className="heading-md">Export</h2><button className="icon-btn" type="button" aria-label="Close Export" onClick={close}><X size={17} aria-hidden /></button></div>
      <ExportPanel key={projectId} onDone={close} />
    </div>
  </div>;
}
