import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { ToastViewport } from './components/ToastViewport';
import { useEditor } from './store/editor';
import { useAssets } from './store/assets';
import { PersistenceController } from './editor/persistenceController';
import { useEditorSession } from './editor/sessionStore';

const EditorShell=lazy(()=>import('./app/EditorShell'));

export default function App(){
  const ready=useEditor((s)=>s.ready);const activeProjectId=useEditor((s)=>s.activeProjectId);const revision=useEditor((s)=>s.doc.revision);const load=useEditor((s)=>s.loadFromDisk);const save=useEditor((s)=>s.saveToDisk);const loadAssets=useAssets((s)=>s.loadForProject);const clearAssets=useAssets((s)=>s.clearProject);const controller=useRef<PersistenceController|null>(null);
  const saveError = useEditor((s) => s.saveError);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [retryingSave, setRetryingSave] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void load().then(() => { if (!cancelled) setLoadError(false); }, () => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [load, loadAttempt]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    if (activeProjectId) {
      void loadAssets(activeProjectId).then(
        () => { if (!cancelled) setMediaError(null); },
        () => { if (!cancelled) setMediaError(activeProjectId); },
      );
    } else clearAssets();
    return () => { cancelled = true; };
  }, [activeProjectId, clearAssets, loadAssets, ready, mediaAttempt]);
  useEffect(()=>{controller.current=new PersistenceController(save, 750, () => { /* saveToDisk exposes failures through saveError */ });return()=>controller.current?.dispose();},[save]);
  useEffect(()=>{if(ready&&activeProjectId)controller.current?.markDirty();},[activeProjectId,ready,revision]);
  useEffect(()=>{const flush=()=>{void controller.current?.flush().catch(() => undefined);};const hidden=()=>{if(document.visibilityState==='hidden')flush();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',flush);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',flush);};},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const target=e.target as HTMLElement|null;const inField=target?.tagName==='INPUT'||target?.tagName==='TEXTAREA'||target?.isContentEditable;const meta=e.metaKey||e.ctrlKey;if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)useEditor.getState().redo();else useEditor.getState().undo();return;}if(meta&&e.key.toLowerCase()==='y'){e.preventDefault();useEditor.getState().redo();return;}if(inField)return;const selected=useEditorSession.getState().selectedLayerId;if(!selected)return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();useEditor.getState().deleteLayer(selected);}if(meta&&e.key.toLowerCase()==='d'){e.preventDefault();useEditor.getState().duplicateLayer(selected);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  if (!ready) return <div className="h-full w-full flex flex-col gap-4 items-center justify-center text-ink-dim">
    {loadError ? <><p role="alert">Your projects could not be loaded. Your saved data has not been changed.</p><button className="ctrl-btn ctrl-btn-primary shrink-0 disabled:opacity-50" onClick={() => { setLoadError(false); setLoadAttempt((n) => n + 1); }}>Retry loading</button></> : 'Loading…'}
  </div>;
  const retrySave = async () => {
    setRetryingSave(true);
    try { await controller.current?.flush(); } catch { /* saveError remains visible */ }
    finally { setRetryingSave(false); }
  };
  return <>
    {saveError && <div role="alert" className="absolute top-12 inset-x-0 z-50 flex items-center justify-center gap-3 bg-bg-panel border-b border-line p-3 text-sm">
      <span>{saveError}</span><button className="ctrl-btn ctrl-btn-primary shrink-0 disabled:opacity-50" disabled={retryingSave} onClick={() => void retrySave()}>{retryingSave ? 'Saving…' : 'Retry saving'}</button>
    </div>}
    {mediaError && mediaError === activeProjectId && <div role="alert" className="absolute bottom-0 inset-x-0 z-50 flex items-center justify-center gap-3 bg-bg-panel border-t border-line p-3 text-sm">
      <span>Your media library could not be loaded.</span><button className="ctrl-btn ctrl-btn-primary shrink-0 disabled:opacity-50" onClick={() => { setMediaError(null); setMediaAttempt((n) => n + 1); }}>Retry media</button>
    </div>}
    {activeProjectId?<Suspense fallback={<div className="h-full w-full flex items-center justify-center text-ink-dim">Opening editor…</div>}><EditorShell/></Suspense>:<LandingPage/>}<ToastViewport/></>;
}
