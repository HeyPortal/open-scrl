import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { LeftRail } from '@/components/LeftRail';
import { RightPanel } from '@/components/RightPanel';
import { Filmstrip } from '@/components/Filmstrip';
import { Canvas } from '@/components/canvas/Canvas';
import { ExportPanel } from '@/components/panels/ExportPanel';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { PhotosPanel } from '@/components/panels/PhotosPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { ShapesPanel } from '@/components/panels/ShapesPanel';
import { BackgroundPanel } from '@/components/panels/BackgroundPanel';
import { useAssets } from '@/store/assets';
import { isLikelyMediaFile } from '@/lib/assets';
import { useEditorSession } from '@/editor/sessionStore';
import { ContextMenuHost, useContextMenu } from '@/components/Menu';
import { EditorOverlays } from '@/components/Overlays';
import { handleEditorKey } from './actions';
import { useEditorView } from '@/editor/viewStore';
import { PhonePreview } from '@/components/preview/PhonePreview';

function PanelContent() {
  const panel=useEditorSession((s)=>s.leftPanel);
  if(panel==='templates')return <TemplatesPanel/>;if(panel==='photos')return <PhotosPanel/>;if(panel==='text')return <TextPanel/>;if(panel==='shapes')return <ShapesPanel/>;if(panel==='background')return <BackgroundPanel/>;if(panel==='export')return <ExportPanel/>;return null;
}

export default function EditorShell(){
  const importFiles=useAssets((s)=>s.importFiles);const stageRef=useRef<HTMLDivElement>(null);const frame=useRef<number|null>(null);const [size,setSize]=useState({width:1,height:1});
  const measure=useCallback(()=>{const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;const next={width:Math.max(1,Math.round(rect.width)),height:Math.max(1,Math.round(rect.height))};setSize((old)=>old.width===next.width&&old.height===next.height?old:next);},[]);
  useLayoutEffect(()=>{const element=stageRef.current;if(!element)return;const schedule=()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(measure);};measure();const observer=new ResizeObserver(schedule);observer.observe(element);return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);observer.disconnect();};},[measure]);
  const panelOpen=useEditorSession((s)=>s.leftPanelOpen);
  const previewOpen=useEditorView((s)=>s.previewOpen);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.defaultPrevented||useEditorSession.getState().overlay||useEditorView.getState().previewOpen||useContextMenu.getState().menu)return;handleEditorKey(e);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  return <div className="flex flex-col h-full w-full" onDragOver={(e)=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={async(e)=>{if(e.defaultPrevented)return;const files=Array.from(e.dataTransfer.files).filter(isLikelyMediaFile);if(!files.length)return;e.preventDefault();await importFiles(files);}}>
    <TopBar/><div className="flex flex-1 overflow-hidden min-h-0"><LeftRail/>{panelOpen&&<aside className="w-60 shrink-0 overflow-hidden border-r border-line bg-bg-panel xl:w-64"><PanelContent/></aside>}<div ref={stageRef} className="relative min-w-0 flex-1 overflow-hidden"><Canvas width={size.width} height={size.height}/></div><RightPanel/></div><Filmstrip/><ContextMenuHost/><EditorOverlays/>{previewOpen&&<PhonePreview/>}
  </div>;
}
