import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/TopBar';
import { LeftRail } from '@/components/LeftRail';
import { RightPanel } from '@/components/RightPanel';
import { Filmstrip } from '@/components/Filmstrip';
import { Canvas } from '@/components/canvas/Canvas';
import { TemplatesPanel } from '@/components/panels/TemplatesPanel';
import { PhotosPanel } from '@/components/panels/PhotosPanel';
import { TextPanel } from '@/components/panels/TextPanel';
import { ShapesPanel } from '@/components/panels/ShapesPanel';
import { BackgroundPanel } from '@/components/panels/BackgroundPanel';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import { isLikelyImageFile } from '@/lib/assets';
import { useEditorSession } from '@/editor/sessionStore';

function PanelContent() {
  const panel=useEditorSession((s)=>s.leftPanel);
  if(panel==='templates')return <TemplatesPanel/>;if(panel==='photos')return <PhotosPanel/>;if(panel==='text')return <TextPanel/>;if(panel==='shapes')return <ShapesPanel/>;if(panel==='background')return <BackgroundPanel/>;return null;
}

export default function EditorShell(){
  const doc=useEditor((s)=>s.doc);const importFiles=useAssets((s)=>s.importFiles);const stageRef=useRef<HTMLDivElement>(null);const frame=useRef<number|null>(null);const [size,setSize]=useState({width:1,height:1});
  const measure=useCallback(()=>{const rect=stageRef.current?.getBoundingClientRect();if(!rect)return;const next={width:Math.max(1,Math.round(rect.width)),height:Math.max(1,Math.round(rect.height))};setSize((old)=>old.width===next.width&&old.height===next.height?old:next);},[]);
  useLayoutEffect(()=>{const element=stageRef.current;if(!element)return;const schedule=()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(measure);};measure();const observer=new ResizeObserver(schedule);observer.observe(element);return()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);observer.disconnect();};},[measure]);
  return <div className="flex flex-col h-full w-full" onDragOver={(e)=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={async(e)=>{const files=Array.from(e.dataTransfer.files).filter(isLikelyImageFile);if(!files.length)return;e.preventDefault();await importFiles(files);}}>
    <TopBar/><div className="flex flex-1 overflow-hidden min-h-0"><LeftRail/><div className="w-64 shrink-0 bg-bg-panel border-r border-line overflow-hidden"><PanelContent/></div><div ref={stageRef} className="flex-1 min-w-0 overflow-hidden relative"><Canvas width={size.width} height={size.height}/><div className="absolute bottom-2 left-2 text-[10px] text-ink-faint pointer-events-none">{doc.format.width} × {doc.format.height} · {doc.slideOrder.length} slide{doc.slideOrder.length===1?'':'s'}</div></div><RightPanel/></div><Filmstrip/>
  </div>;
}
