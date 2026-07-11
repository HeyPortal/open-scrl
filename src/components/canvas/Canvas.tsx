import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer as KLayer, Line, Rect, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import type { Layer as DocLayer, Slide } from '@/types';
import { getSlideLayers } from '@/core/document/selectors';
import { compileScene } from '@/core/scene/compileScene';
import { snapBox, type SnapGuide } from '@/lib/snap';
import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { TextEditor } from './TextEditor';

const SNAP_THRESHOLD_PX = 6;
const PADDING = 12;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const BUFFER_SLIDES = 1;
Konva.pixelRatio = 1;

export function Canvas({ width, height }: { width: number; height: number }) {
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const selectedId = useEditorSession((s) => s.selectedLayerId);
  const active = useEditor((s) => selectedId ? s.doc.layers[selectedId] : undefined);
  const zoom = useEditorSession((s) => s.zoom);
  const setZoom = useEditorSession((s) => s.setZoom);
  const selectSlide = useEditorSession((s) => s.selectSlide);
  const selectLayer = useEditorSession((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setLeftPanel = useEditorSession((s) => s.setLeftPanel);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const roots = useRef<Konva.Group[]>([]);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerNodes = useRef(new Map<string, Konva.Node>());
  const scrollPosition = useRef({ left: 0, top: 0 });
  const raf = useRef<number | null>(null);
  const touch = useRef<{ x:number; y:number; distance:number; zoom:number; left:number; top:number } | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [guideOffsetX, setGuideOffsetX] = useState(0);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const fmt = doc.format;

  const fitZoom = useMemo(() => !width || !height ? .5 : Math.max(MIN_ZOOM, Math.min((width-PADDING*2)/fmt.width,(height-PADDING*2)/fmt.height)), [width,height,fmt.width,fmt.height]);
  const deckWidth = doc.slideOrder.length * fmt.width;
  const spacerWidth = Math.max(width, deckWidth * zoom + PADDING * 2);
  const spacerHeight = Math.max(height, fmt.height * zoom + PADDING * 2);
  const centeredY = Math.max(PADDING, Math.round((height - fmt.height * zoom) / 2));

  const syncTransform = useCallback(() => {
    const { left, top } = scrollPosition.current;
    for (const root of roots.current) {
      root.position({ x: PADDING - left, y: centeredY - top });
      root.scale({ x: zoom, y: zoom });
      root.getLayer()?.batchDraw();
    }
  }, [centeredY, zoom]);

  const updateVisible = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const left = Math.max(0, (el.scrollLeft - PADDING) / zoom);
    const right = Math.max(0, (el.scrollLeft + el.clientWidth - PADDING) / zoom);
    const start = Math.max(0, Math.floor(left / fmt.width) - BUFFER_SLIDES);
    const end = Math.min(doc.slideOrder.length - 1, Math.floor(right / fmt.width) + BUFFER_SLIDES);
    setVisibleRange((old) => old.start === start && old.end === end ? old : { start, end });
  }, [doc.slideOrder.length, fmt.width, zoom]);

  const scheduleScrollSync = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    scrollPosition.current = { left: el.scrollLeft, top: el.scrollTop };
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => { raf.current = null; syncTransform(); updateVisible(); });
  }, [syncTransform, updateVisible]);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  useLayoutEffect(() => { setZoom(fitZoom); }, [fitZoom, setZoom]);
  useLayoutEffect(() => { syncTransform(); updateVisible(); }, [syncTransform, updateVisible]);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const index = doc.slideOrder.indexOf(selectedSlideId); if (index < 0) return;
    const center = PADDING + (index + .5) * fmt.width * zoom;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: 'auto' });
    scheduleScrollSync();
  }, [doc.slideOrder, fmt.width, scheduleScrollSync, selectedSlideId, zoom]);

  useEffect(() => {
    const tr = transformerRef.current; if (!tr) return;
    const node = selectedId ? layerNodes.current.get(selectedId) : undefined;
    tr.nodes(node && !active?.locked ? [node] : []); tr.getLayer()?.batchDraw();
  }, [active?.locked, selectedId, visibleRange]);

  const visibleSlides = useMemo(() => doc.slideOrder.slice(visibleRange.start, visibleRange.end + 1).map((slideId, offset) => ({ slideId, slide: doc.slides[slideId], index: visibleRange.start + offset })), [doc, visibleRange]);
  const visibleItems = useMemo(() => compileScene(doc, { x: visibleRange.start * fmt.width, y: 0, width: Math.max(1, visibleRange.end - visibleRange.start + 1) * fmt.width, height: fmt.height }), [doc, fmt.height, fmt.width, visibleRange]);

  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    const el = scrollRef.current; if (!el) return;
    event.evt.preventDefault();
    if (!event.evt.ctrlKey && !event.evt.metaKey) {
      el.scrollBy({ left: event.evt.shiftKey ? event.evt.deltaY : event.evt.deltaX, top: event.evt.shiftKey ? 0 : event.evt.deltaY }); scheduleScrollSync(); return;
    }
    const rect = el.getBoundingClientRect(); const pointerX = event.evt.clientX - rect.left; const pointerY = event.evt.clientY - rect.top;
    const contentX = (el.scrollLeft + pointerX - PADDING) / zoom; const contentY = (el.scrollTop + pointerY - centeredY) / zoom;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(-event.evt.deltaY * .00115)));
    setZoom(next);
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, PADDING + contentX * next - pointerX); el.scrollTop = Math.max(0, centeredY + contentY * next - pointerY); scheduleScrollSync(); });
  };

  const selectPageAtPointer = () => {
    const pointer=stageRef.current?.getPointerPosition();if(!pointer)return;
    const globalX=(pointer.x-PADDING+scrollPosition.current.left)/zoom;const index=Math.max(0,Math.min(doc.slideOrder.length-1,Math.floor(globalX/fmt.width)));const slideId=doc.slideOrder[index];if(slideId){selectSlide(slideId);selectLayer(null);}
  };
  const onTouchStart=(event:Konva.KonvaEventObject<TouchEvent>)=>{const touches=event.evt.touches;const el=scrollRef.current;if(!el)return;if(touches.length===1&&event.target!==event.target.getStage())return;const x=[...touches].reduce((n,p)=>n+p.clientX,0)/touches.length;const y=[...touches].reduce((n,p)=>n+p.clientY,0)/touches.length;const distance=touches.length>1?Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY):0;touch.current={x,y,distance,zoom,left:el.scrollLeft,top:el.scrollTop};};
  const onTouchMove=(event:Konva.KonvaEventObject<TouchEvent>)=>{const start=touch.current;const el=scrollRef.current;const touches=event.evt.touches;if(!start||!el||!touches.length)return;event.evt.preventDefault();const x=[...touches].reduce((n,p)=>n+p.clientX,0)/touches.length;const y=[...touches].reduce((n,p)=>n+p.clientY,0)/touches.length;if(touches.length>1&&start.distance>0){const distance=Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);setZoom(Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,start.zoom*distance/start.distance)));}el.scrollLeft=start.left-(x-start.x);el.scrollTop=start.top-(y-start.y);scheduleScrollSync();};

  const slideModel = (slideId: string): Slide => ({ id: slideId, background: doc.slides[slideId].background, layers: getSlideLayers(doc, slideId) });
  const pageX = (slideId: string) => doc.slideOrder.indexOf(slideId) * fmt.width;
  const localMoving = (node: Konva.Node, layer: DocLayer, transformed = false) => {
    const scaleX = transformed ? node.scaleX() : 1; const scaleY = transformed ? node.scaleY() : 1;
    const uniform = layer.kind === 'image' && transformed ? Math.max(Math.abs(scaleX), Math.abs(scaleY)) : null;
    const width = Math.max(8, layer.width * (uniform ?? scaleX)); const height = Math.max(8, layer.height * (uniform ?? scaleY));
    return { x: node.x() - width/2, y: node.y() - height/2, width, height };
  };
  const snap = (slide: Slide, layer: DocLayer, moving: {x:number;y:number;width:number;height:number}) => snapBox(moving, slide.layers.filter((l)=>l.id!==layer.id), fmt, SNAP_THRESHOLD_PX/zoom);

  const renderNode = (slideId: string, layer: DocLayer) => {
    const slide = slideModel(slideId); const offset = pageX(slideId);
    const onSelect = (e: Konva.KonvaEventObject<MouseEvent|TouchEvent>) => { e.cancelBubble=true; if(selectedSlideId!==slideId)selectSlide(slideId);selectLayer(layer.id);if(layer.kind==='image'&&!layer.assetId)setLeftPanel('photos'); };
    const onDragStart = () => { selectSlide(slideId); selectLayer(layer.id); };
    const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => { if(layer.locked||layer.kind==='image')return;const result=snap(slide,layer,localMoving(e.target,layer));e.target.position({x:result.x+layer.width/2,y:result.y+layer.height/2});setGuideOffsetX(offset);setGuides(result.guides); };
    const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => { setGuides([]);if(layer.locked)return;const result=snap(slide,layer,localMoving(e.target,layer));updateLayer(layer.id,{x:result.x,y:result.y}); };
    const onTransform = (e: Konva.KonvaEventObject<Event>) => { if(layer.locked)return;const moving=localMoving(e.target,layer,true);const result=snap(slide,layer,moving);e.target.position({x:result.x+moving.width/2,y:result.y+moving.height/2});setGuideOffsetX(offset);setGuides(result.guides); };
    const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => { if(layer.locked)return;const node=e.target;const moving=localMoving(node,layer,true);const result=snap(slide,layer,moving);node.scale({x:1,y:1});updateLayer(layer.id,{x:result.x,y:result.y,width:moving.width,height:moving.height,rotation:node.rotation()});setGuides([]); };
    const ref = (node: Konva.Node|null) => { if(node)layerNodes.current.set(layer.id,node);else layerNodes.current.delete(layer.id); };
    const props={onSelect,onDragStart,onDragMove,onDragEnd,onTransform,onTransformEnd};
    return <Group key={layer.id} x={offset}>{layer.kind==='image'?<ImageNode {...props} layer={layer} selected={selectedId===layer.id} groupRef={ref}/>:layer.kind==='shape'?<ShapeNode {...props} layer={layer} groupRef={ref}/>:<TextNode {...props} layer={layer} onDblClick={()=>setEditingTextId(layer.id)} nodeRef={ref}/>}</Group>;
  };

  const rootRef = (index: number) => (node: Konva.Group|null) => { if(node) roots.current[index]=node; };
  return <div className="relative h-full w-full overflow-hidden bg-bg select-none">
    <div ref={scrollRef} onScroll={scheduleScrollSync} className="absolute inset-0 overflow-auto scrollbar-thin"><div style={{width:spacerWidth,height:spacerHeight}} /></div>
    <div className="absolute inset-0 pointer-events-auto overflow-hidden">
      <Stage ref={stageRef} width={Math.max(1,width)} height={Math.max(1,height)} onWheel={onWheel} onMouseDown={(e)=>{if(e.target===e.target.getStage())selectPageAtPointer();}} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={()=>{if(touch.current)selectPageAtPointer();touch.current=null;}}>
        <KLayer listening={false}><Group ref={rootRef(0)}>{visibleSlides.map(({slide,index})=>{const x=index*fmt.width;return <Group key={slide.id} x={x}><Rect width={fmt.width} height={fmt.height} fill={slide.background.kind==='solid'?slide.background.color:'#fff'}/>{slide.background.kind==='gradient'&&<Rect width={fmt.width} height={fmt.height} fillLinearGradientStartPoint={{x:0,y:0}} fillLinearGradientEndPoint={{x:fmt.width*Math.cos(slide.background.angle*Math.PI/180),y:fmt.height*Math.sin(slide.background.angle*Math.PI/180)}} fillLinearGradientColorStops={[0,slide.background.from,1,slide.background.to]}/>}<Rect width={fmt.width} height={fmt.height} stroke={slide.id===selectedSlideId?'#7c5cff':'#2b2b35'} strokeWidth={(slide.id===selectedSlideId?3:1)/zoom}/></Group>;})}</Group></KLayer>
        <KLayer><Group ref={rootRef(1)}>{visibleItems.map((item)=>renderNode(item.slideId,item.layer))}<Transformer ref={transformerRef} rotateEnabled anchorSize={10} anchorStroke="#7c5cff" anchorFill="#0b0b0f" borderStroke="#7c5cff" borderDash={[4,4]} keepRatio={active?.kind==='image'} ignoreStroke /></Group></KLayer>
        <KLayer listening={false}><Group ref={rootRef(2)}>{guides.map((g,i)=>g.orientation==='v'?<Line key={i} points={[guideOffsetX+g.position,g.start,guideOffsetX+g.position,g.end]} stroke="#ff3b8a" strokeWidth={1/zoom}/>:<Line key={i} points={[guideOffsetX+g.start,g.position,guideOffsetX+g.end,g.position]} stroke="#ff3b8a" strokeWidth={1/zoom}/>)}</Group></KLayer>
      </Stage>
    </div>
    {editingTextId&&active?.kind==='text'&&stageRef.current&&(
      <TextEditor layer={active} stage={stageRef.current} offsetX={pageX(doc.slideOrder.find((sid)=>doc.slides[sid].layerOrder.includes(active.id))??selectedSlideId)} scale={zoom} viewportOffset={{x:PADDING-scrollPosition.current.left,y:centeredY-scrollPosition.current.top}} onClose={()=>setEditingTextId(null)}/>
    )}
    <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-bg-rail/90 border border-line rounded-md px-1 py-1 text-[11px] text-ink-dim"><button title="Zoom out" className="icon-btn !h-6 !w-6" onClick={()=>setZoom(Math.max(MIN_ZOOM,zoom/1.2))}>−</button><button title="Fit to screen" className="px-2 py-0.5" onClick={()=>setZoom(fitZoom)}>{Math.round(zoom*100)}%</button><button title="Zoom in" className="icon-btn !h-6 !w-6" onClick={()=>setZoom(Math.min(MAX_ZOOM,zoom*1.2))}>+</button><button className="ctrl-btn !py-1 !px-2" onClick={()=>setZoom(fitZoom)}>Fit</button></div>
  </div>;
}
