import { useRef, useState } from 'react';
import { Archive, FolderOpen, Loader2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import { useToasts } from '@/store/toasts';
import { listProjectSummaries } from '@/storage/database';
import { downloadBlob } from '@/export/ExportController';

export function ProjectTransfer({ backup = false }: { backup?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToasts((s) => s.addToast);
  const save = async () => {
    setBusy(true);
    try {
      const doc = useEditor.getState().doc;
      const { createProjectArchive } = await import('@/lib/projectArchive');
      const blob = await createProjectArchive(doc);
      downloadBlob(blob, `${doc.name.replace(/[^a-z0-9-_]+/gi, '_') || 'post'}.openscrl`);
      toast('Project backup downloaded with original photos and edits.', 'success');
    } catch (error) { toast(error instanceof Error ? error.message : 'Backup failed.', 'error'); }
    finally { setBusy(false); }
  };
  const restore = async (file: File) => {
    setBusy(true);
    try {
      await useEditor.getState().saveToDisk();
      const { restoreProjectArchive } = await import('@/lib/projectArchive');
      const doc = await restoreProjectArchive(file);
      useEditor.setState({ projects: await listProjectSummaries() });
      await useEditor.getState().openProject(doc.id);
      await useAssets.getState().loadForProject(doc.id);
      toast('Backup restored as a new project.', 'success');
    } catch (error) { toast(error instanceof Error ? error.message : 'Restore failed.', 'error'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="flex flex-wrap items-center gap-2">
    {backup && <button className="btn btn-secondary" disabled={busy} onClick={() => void save()} title="Download a project backup with original photos and all edits">{busy ? <Loader2 size={14} className="animate-spin"/> : <Archive size={14}/>} Backup project</button>}
    <button className="btn btn-secondary" disabled={busy} onClick={() => input.current?.click()}><FolderOpen size={14}/> Restore backup</button>
    <input ref={input} type="file" accept=".openscrl,.zip" className="hidden" aria-label="Restore project backup" onChange={(e) => { const file = e.target.files?.[0]; if (file) void restore(file); }}/>
  </div>;
}
