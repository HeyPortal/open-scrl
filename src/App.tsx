import { lazy, Suspense, useEffect, useRef } from 'react';
import { LandingPage } from './components/LandingPage';
import { ToastViewport } from './components/ToastViewport';
import { useEditor } from './store/editor';
import { useAssets } from './store/assets';
import { PersistenceController } from './editor/persistenceController';
import { useEditorSession } from './editor/sessionStore';

const EditorShell=lazy(()=>import('./app/EditorShell'));

export default function App(){
  const ready=useEditor((s)=>s.ready);const activeProjectId=useEditor((s)=>s.activeProjectId);const revision=useEditor((s)=>s.doc.revision);const load=useEditor((s)=>s.loadFromDisk);const save=useEditor((s)=>s.saveToDisk);const loadAssets=useAssets((s)=>s.loadForProject);const clearAssets=useAssets((s)=>s.clearProject);const controller=useRef<PersistenceController|null>(null);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!ready)return;if(activeProjectId)void loadAssets(activeProjectId);else clearAssets();},[activeProjectId,clearAssets,loadAssets,ready]);
  useEffect(()=>{controller.current=new PersistenceController(save);return()=>controller.current?.dispose();},[save]);
  useEffect(()=>{if(ready&&activeProjectId)controller.current?.markDirty();},[activeProjectId,ready,revision]);
  useEffect(()=>{const flush=()=>{void controller.current?.flush();};const hidden=()=>{if(document.visibilityState==='hidden')flush();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',flush);return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',flush);};},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const target=e.target as HTMLElement|null;const inField=target?.tagName==='INPUT'||target?.tagName==='TEXTAREA'||target?.isContentEditable;const meta=e.metaKey||e.ctrlKey;if(meta&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)useEditor.getState().redo();else useEditor.getState().undo();return;}if(meta&&e.key.toLowerCase()==='y'){e.preventDefault();useEditor.getState().redo();return;}if(inField)return;const selected=useEditorSession.getState().selectedLayerId;if(!selected)return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();useEditor.getState().deleteLayer(selected);}if(meta&&e.key.toLowerCase()==='d'){e.preventDefault();useEditor.getState().duplicateLayer(selected);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  if(!ready)return <div className="h-full w-full flex items-center justify-center text-ink-dim">Loading…</div>;
  return <>{activeProjectId?<Suspense fallback={<div className="h-full w-full flex items-center justify-center text-ink-dim">Opening editor…</div>}><EditorShell/></Suspense>:<LandingPage/>}<ToastViewport/></>;
}
