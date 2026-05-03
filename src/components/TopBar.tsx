import { useState } from 'react';
import {
  Download,
  FileImage,
  FilePlus2,
  House,
  Redo2,
  Undo2,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { FORMATS } from '@/lib/format';
import { exportAllAsZip, exportSlide } from '@/lib/export';

export function TopBar() {
  const docName = useEditor((s) => s.doc.name);
  const setDocName = useEditor((s) => s.setDocName);
  const format = useEditor((s) => s.doc.format);
  const setFormat = useEditor((s) => s.setFormat);
  const newProject = useEditor((s) => s.newProject);
  const closeProject = useEditor((s) => s.closeProject);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditor((s) => s.selectedSlideId);

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string>('');

  const exportCurrent = async () => {
    setExporting(true);
    try {
      const idx = doc.slides.findIndex((s) => s.id === selectedSlideId);
      await exportSlide(doc, Math.max(0, idx));
    } finally {
      setExporting(false);
    }
  };

  const exportZip = async () => {
    setExporting(true);
    try {
      await exportAllAsZip(doc, { format: 'png' }, (i, t) => setProgress(`${i}/${t}`));
    } finally {
      setExporting(false);
      setProgress('');
    }
  };

  return (
    <div className="h-12 bg-bg-rail border-b border-line flex items-center px-3 gap-2">
      <div className="flex items-center gap-2 mr-2">
        <div className="h-7 w-7 rounded-md bg-accent flex items-center justify-center">
          <FileImage size={16} className="text-white" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Open-SCRL</span>
      </div>

      <div className="h-6 w-px bg-line mx-1" />

      <button
        className="icon-btn"
        title="Projects"
        onClick={() => {
          void closeProject();
        }}
      >
        <House size={16} />
      </button>
      <button
        className="icon-btn"
        title="New project"
        onClick={() => {
          if (confirm('Start a new project? Current work is autosaved separately.')) void newProject();
        }}
      >
        <FilePlus2 size={16} />
      </button>
      <button
        className="icon-btn disabled:opacity-30 disabled:hover:bg-transparent"
        disabled={past.length === 0}
        onClick={undo}
        title="Undo (⌘Z)"
      >
        <Undo2 size={16} />
      </button>
      <button
        className="icon-btn disabled:opacity-30 disabled:hover:bg-transparent"
        disabled={future.length === 0}
        onClick={redo}
        title="Redo (⌘⇧Z)"
      >
        <Redo2 size={16} />
      </button>

      <div className="h-6 w-px bg-line mx-1" />

      <input
        className="input max-w-56"
        value={docName}
        onChange={(e) => setDocName(e.target.value)}
      />

      <select
        className="input max-w-44"
        value={format.name}
        onChange={(e) => {
          const f = FORMATS.find((x) => x.name === e.target.value);
          if (f) setFormat(f);
        }}
        title="Canvas format"
      >
        {FORMATS.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name} · {f.width}×{f.height}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      {progress && <span className="text-xs text-ink-dim">Exporting {progress}</span>}

      <button className="ctrl-btn" disabled={exporting} onClick={exportCurrent}>
        <Download size={14} /> Slide PNG
      </button>
      <button
        className="ctrl-btn ctrl-btn-primary"
        disabled={exporting}
        onClick={exportZip}
      >
        <Download size={14} /> Export Post
      </button>
    </div>
  );
}
