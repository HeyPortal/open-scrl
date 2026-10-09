import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LayoutGrid, Loader2 } from 'lucide-react';
import { LandingPage } from './components/LandingPage';
import { ToastViewport } from './components/ToastViewport';
import { useEditor } from './store/editor';
import { useAssets } from './store/assets';
import { PersistenceController } from './editor/persistenceController';
import { useEditorSession } from './editor/sessionStore';
import { PwaUpdatePrompt } from './app/PwaUpdatePrompt';
import { useMobileLayout } from './app/useMobileLayout';

const EditorShell=lazy(()=>import('./app/EditorShell'));
const MobileEditorShell=lazy(()=>import('./components/mobile/MobileEditorShell'));
const MobileHome=lazy(()=>import('./components/mobile/MobileHome'));

export default function App(){
  const ready=useEditor((s)=>s.ready);const activeProjectId=useEditor((s)=>s.activeProjectId);const revision=useEditor((s)=>s.doc.revision);const load=useEditor((s)=>s.loadFromDisk);const save=useEditor((s)=>s.saveToDisk);const loadAssets=useAssets((s)=>s.loadForProject);const clearAssets=useAssets((s)=>s.clearProject);const controller=useRef<PersistenceController|null>(null);
  const saveError = useEditor((s) => s.saveError);
  const mobile = useMobileLayout();
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [retryingSave, setRetryingSave] = useState(false);
  const flushPersistence = useCallback(() => controller.current?.flush() ?? Promise.resolve(), []);
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
  useEffect(()=>{const setStatus=useEditorSession.getState().setSaveStatus;const tracked=async()=>{setStatus('saving');try{await save();}finally{setStatus('saved');}};controller.current=new PersistenceController(tracked, 750, () => { /* saveToDisk exposes failures through saveError */ });return()=>controller.current?.dispose();},[save]);
  useEffect(()=>{if(ready&&activeProjectId){useEditorSession.getState().setSaveStatus('pending');controller.current?.markDirty();}},[activeProjectId,ready,revision]);
  useEffect(()=>{const flush=()=>{void controller.current?.flush().catch(() => undefined);};const hidden=()=>{if(document.visibilityState==='hidden')flush();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',flush);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',flush);};},[]);
  // Editor keyboard shortcuts live in EditorShell (see src/app/actions.ts).
  if (!ready) return <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-ink-dim">
    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-white"><LayoutGrid size={22} strokeWidth={2} aria-hidden /></div>
    {loadError ? <><p role="alert" className="max-w-sm text-center text-sm text-ink">Your projects could not be loaded. Your saved data has not been changed.</p><button className="btn btn-primary" onClick={() => { setLoadError(false); setLoadAttempt((n) => n + 1); }}>Retry loading</button></> : <span className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" aria-hidden />Loading…</span>}
  </div>;
  const retrySave = async () => {
    setRetryingSave(true);
    try { await controller.current?.flush(); } catch { /* saveError remains visible */ }
    finally { setRetryingSave(false); }
  };
  return <>
    {saveError && <div role="alert" className={`fixed left-1/2 ${mobile ? 'top-[calc(env(safe-area-inset-top)+60px)]' : 'top-14'} z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-red-500/40 bg-[#2a1618] py-1.5 pl-3 pr-1.5 text-xs text-red-100 shadow-lift`}>
      <AlertTriangle size={15} className="shrink-0 text-red-400" aria-hidden /><span>{saveError}</span><button className="btn btn-sm shrink-0 bg-red-500 text-white hover:bg-red-400" disabled={retryingSave} onClick={() => void retrySave()}>{retryingSave ? 'Saving…' : 'Retry saving'}</button>
    </div>}
    {mediaError && mediaError === activeProjectId && <div role="alert" className={`fixed ${mobile ? 'top-[calc(env(safe-area-inset-top)+108px)]' : 'bottom-28'} left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-500/40 bg-[#2a2214] py-1.5 pl-3 pr-1.5 text-xs text-amber-100 shadow-lift`}>
      <AlertTriangle size={15} className="shrink-0 text-amber-400" aria-hidden /><span>Your media library could not be loaded.</span><button className="btn btn-sm shrink-0 bg-amber-500 text-black hover:bg-amber-400" onClick={() => { setMediaError(null); setMediaAttempt((n) => n + 1); }}>Retry media</button>
    </div>}
    <Suspense fallback={<div className="flex h-full w-full items-center justify-center gap-2 text-sm text-ink-dim"><Loader2 size={16} className="animate-spin" aria-hidden />{activeProjectId?'Opening editor…':'Loading…'}</div>}>{activeProjectId?(mobile?<MobileEditorShell/>:<EditorShell/>):(mobile?<MobileHome/>:<LandingPage/>)}</Suspense><ToastViewport/><PwaUpdatePrompt flush={flushPersistence}/></>;
}
