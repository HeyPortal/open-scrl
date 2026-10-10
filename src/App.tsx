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
const MobileEditorShell=lazy(()=>import('./app/MobileEditorShell'));
const MobileHome=lazy(()=>import('./app/MobileHome'));

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
  if (!ready) return <div className="studio-loading">
    <div className="studio-loading-mark"><LayoutGrid size={22} strokeWidth={2} aria-hidden /></div>
    <p className="heading-lg text-ink">Open-SCRL</p>
    {loadError ? <div className="studio-loading-error"><p role="alert" className="text-sm leading-relaxed text-ink">Your projects could not be loaded. Your saved data has not been changed.</p><button className="btn btn-primary h-9 px-4 text-[13px]" onClick={() => { setLoadError(false); setLoadAttempt((n) => n + 1); }}>Retry loading</button></div> : <span className="flex items-center gap-2 text-sm text-ink-dim"><Loader2 size={16} className="animate-spin" aria-hidden />Loading…</span>}
  </div>;
  const retrySave = async () => {
    setRetryingSave(true);
    try { await controller.current?.flush(); } catch { /* saveError remains visible */ }
    finally { setRetryingSave(false); }
  };
  return <>
    {(saveError || (mediaError && mediaError === activeProjectId) || mobile) && <div className={`studio-notices${mobile ? ' studio-notices-mobile' : ''}`}>
      {saveError && <div role="alert" className="studio-banner" data-tone="danger">
        <AlertTriangle size={16} className="shrink-0 text-danger-icon" aria-hidden /><span className="studio-banner-text">{saveError}</span><button className="btn btn-sm studio-banner-action" disabled={retryingSave} onClick={() => void retrySave()}>{retryingSave ? 'Saving…' : 'Retry saving'}</button>
      </div>}
      {mediaError && mediaError === activeProjectId && <div role="alert" className="studio-banner" data-tone="warning">
        <AlertTriangle size={16} className="shrink-0 text-warning" aria-hidden /><span className="studio-banner-text">Your media library could not be loaded.</span><button className="btn btn-sm studio-banner-action" onClick={() => { setMediaError(null); setMediaAttempt((n) => n + 1); }}>Retry media</button>
      </div>}
      {mobile && <ToastViewport inline />}
    </div>}
    <Suspense fallback={<div className="studio-loading studio-loading-inline"><span className="flex items-center gap-2 text-sm text-ink-dim"><Loader2 size={16} className="animate-spin" aria-hidden />{activeProjectId?'Opening editor…':'Loading…'}</span></div>}>{activeProjectId?(mobile?<MobileEditorShell/>:<EditorShell/>):(mobile?<MobileHome/>:<LandingPage/>)}</Suspense>{!mobile && <ToastViewport/>}<PwaUpdatePrompt flush={flushPersistence} mobile={mobile}/></>;
}
