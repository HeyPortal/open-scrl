import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer as KLayer, Line, Rect, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import { MAX_ZOOM, MIN_ZOOM, useEditorSession } from '@/editor/sessionStore';
import { useContextMenu } from '@/components/Menu';
import { layerMenu } from '@/app/menus';
import type { Layer as DocLayer, Slide } from '@/types';
import { getSlideLayers } from '@/core/document/selectors';
import { compileScene } from '@/core/scene/compileScene';
import { findCrossedSlideSeams } from '@/core/scene/slideSeams';
import { getCanvasScrollIntent } from '@/core/scene/scrollIntent';
import { snapBox, type SnapGuide } from '@/lib/snap';
import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { TextEditor } from './TextEditor';

const SNAP_THRESHOLD_PX = 6;
const PADDING = 32;
const BUFFER_SLIDES = 0;
const EDITOR_PIXEL_RATIO = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
Konva.pixelRatio = EDITOR_PIXEL_RATIO;

export function Canvas({ width, height }: { width: number; height: number }) {
  const doc = useEditor((s) => s.doc);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slideFocusRequest = useEditorSession((s) => s.slideFocusRequest);
  const selectedId = useEditorSession((s) => s.selectedLayerId);
  const active = useEditor((s) => selectedId ? s.doc.layers[selectedId] : undefined);
  const zoom = useEditorSession((s) => s.zoom);
  const setZoom = useEditorSession((s) => s.setZoom);
  const selectSlide = useEditorSession((s) => s.selectSlide);
  const selectLayer = useEditorSession((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setLeftPanel = useEditorSession((s) => s.setLeftPanel);
  const assets = useAssets((s) => s.assets);

  const openContextMenu = useContextMenu((s) => s.open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerNodes = useRef(new Map<string, Konva.Node>());
  const scrollPosition = useRef({ left: 0, top: 0 });
  const raf = useRef<number | null>(null);
  const pendingFocusDraw = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef<{ x:number; y:number; distance:number; zoom:number; left:number; top:number } | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
  const [viewportOffset, setViewportOffset] = useState({ x: PADDING, y: PADDING });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [guideOffsetX, setGuideOffsetX] = useState(0);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [resizeSeams, setResizeSeams] = useState<{ x: number; y: number; height: number }[]>([]);
  const fmt = doc.format;
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const fitZoom = useMemo(() => !width || !height ? .5 : Math.max(MIN_ZOOM, Math.min((width-PADDING*2)/fmt.width,(height-PADDING*2)/fmt.height)), [width,height,fmt.width,fmt.height]);
  const deckWidth = doc.slideOrder.length * fmt.width;
  const spacerWidth = Math.max(width, deckWidth * zoom + PADDING * 2);
  const spacerHeight = Math.max(height, fmt.height * zoom + PADDING * 2);
  const centeredY = Math.max(PADDING, Math.round((height - fmt.height * zoom) / 2));
  // Center the deck horizontally when it is narrower than the viewport.
  const originXFor = useCallback((z: number) => Math.max(PADDING, Math.round((width - deckWidth * z) / 2)), [deckWidth, width]);
  const originX = originXFor(zoom);

  const updateVisible = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    const left = Math.max(0, (el.scrollLeft - originX) / zoom);
    const right = Math.max(0, (el.scrollLeft + el.clientWidth - originX) / zoom);
    const start = Math.max(0, Math.floor(left / fmt.width) - BUFFER_SLIDES);
    const end = Math.min(doc.slideOrder.length - 1, Math.floor(right / fmt.width) + BUFFER_SLIDES);
    setVisibleRange((old) => old.start === start && old.end === end ? old : { start, end });
  }, [doc.slideOrder.length, fmt.width, originX, zoom]);

  const scheduleScrollSync = useCallback(() => {
    const el = scrollRef.current; if (!el) return;
    scrollPosition.current = { left: el.scrollLeft, top: el.scrollTop };
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const position = scrollPosition.current;
      setViewportOffset({ x: originX - position.left, y: centeredY - position.top });
      updateVisible();
    });
  }, [centeredY, originX, updateVisible]);

  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  const setFitZoom = useEditorSession((s) => s.setFitZoom);
  useLayoutEffect(() => { setFitZoom(fitZoom); setZoom(fitZoom); }, [fitZoom, setFitZoom, setZoom]);
  useLayoutEffect(() => {
    const position = scrollPosition.current;
    setViewportOffset({ x: originX - position.left, y: centeredY - position.top });
    updateVisible();
  }, [centeredY, originX, updateVisible, zoom]);

  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const index = doc.slideOrder.indexOf(selectedSlideId); if (index < 0) return;
    const center = originX + (index + .5) * fmt.width * zoom;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: 'auto' });
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    const position = { left: el.scrollLeft, top: el.scrollTop };
    scrollPosition.current = position;
    const nextOffset = { x: originX - position.left, y: centeredY - position.top };
    pendingFocusDraw.current = nextOffset;
    setViewportOffset(nextOffset);
    updateVisible();
  }, [centeredY, doc.slideOrder, fmt.width, originX, selectedSlideId, slideFocusRequest, updateVisible, zoom]);

  useLayoutEffect(() => {
    const pending = pendingFocusDraw.current;
    if (!pending || pending.x !== viewportOffset.x || pending.y !== viewportOffset.y) return;
    stageRef.current?.draw();
    pendingFocusDraw.current = null;
  }, [viewportOffset, visibleRange]);

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
      const intent=getCanvasScrollIntent({deltaX:event.evt.deltaX,deltaY:event.evt.deltaY,canScrollX:deckWidth*zoom+PADDING*2>width+1,canScrollY:fmt.height*zoom+PADDING*2>height+1,shiftKey:event.evt.shiftKey});
      const left=Math.max(0,Math.min(el.scrollWidth-el.clientWidth,el.scrollLeft+intent.left));
      const top=Math.max(0,Math.min(el.scrollHeight-el.clientHeight,el.scrollTop+intent.top));
      el.scrollTo({left,top});scrollPosition.current={left,top};setViewportOffset({x:originX-left,y:centeredY-top});updateVisible();return;
    }
    const rect = el.getBoundingClientRect(); const pointerX = event.evt.clientX - rect.left; const pointerY = event.evt.clientY - rect.top;
    const contentX = (el.scrollLeft + pointerX - originX) / zoom; const contentY = (el.scrollTop + pointerY - centeredY) / zoom;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * Math.exp(-event.evt.deltaY * .00115)));
    setZoom(next);
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, originXFor(next) + contentX * next - pointerX); el.scrollTop = Math.max(0, centeredY + contentY * next - pointerY); scheduleScrollSync(); });
  };

  const selectPageAtPointer = () => {
    const pointer=stageRef.current?.getPointerPosition();if(!pointer)return;
    const globalX=(pointer.x-originX+scrollPosition.current.left)/zoom;const index=Math.max(0,Math.min(doc.slideOrder.length-1,Math.floor(globalX/fmt.width)));const slideId=doc.slideOrder[index];if(slideId){selectSlide(slideId);selectLayer(null);}
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
    const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => { if(layer.locked)return;const result=snap(slide,layer,localMoving(e.target,layer));e.target.position({x:result.x+layer.width/2,y:result.y+layer.height/2});setGuideOffsetX(offset);setGuides(result.guides); };
    const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => { setGuides([]);if(layer.locked)return;const result=snap(slide,layer,localMoving(e.target,layer));updateLayer(layer.id,{x:result.x,y:result.y}); };
    const onTransform = (e: Konva.KonvaEventObject<Event>) => { if(layer.locked)return;const moving=localMoving(e.target,layer,true);const result=snap(slide,layer,moving);e.target.position({x:result.x+moving.width/2,y:result.y+moving.height/2});setGuideOffsetX(offset);setGuides(result.guides);if(layer.kind==='image'){const seams=findCrossedSlideSeams({x:offset+result.x,y:result.y,width:moving.width,height:moving.height},fmt.width,doc.slideOrder.length);setResizeSeams(seams.map((x)=>({x,y:result.y,height:moving.height})));}else setResizeSeams([]); };
    const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => { setResizeSeams([]);if(layer.locked)return;const node=e.target;const moving=localMoving(node,layer,true);const result=snap(slide,layer,moving);node.scale({x:1,y:1});updateLayer(layer.id,{x:result.x,y:result.y,width:moving.width,height:moving.height,rotation:node.rotation()});setGuides([]); };
    const ref = (node: Konva.Node|null) => { if(node)layerNodes.current.set(layer.id,node);else layerNodes.current.delete(layer.id); };
    const props={onSelect,onDragStart,onDragMove,onDragEnd,onTransform,onTransformEnd};
    return <Group key={layer.id} x={offset}>{layer.kind==='image'?<ImageNode {...props} layer={layer} asset={layer.assetId ? assetsById.get(layer.assetId) : undefined} activeSlide={selectedSlideId===slideId} selected={selectedId===layer.id} groupRef={ref} renderScale={zoom*EDITOR_PIXEL_RATIO}/>:layer.kind==='shape'?<ShapeNode {...props} layer={layer} groupRef={ref}/>:<TextNode {...props} layer={layer} onDblClick={()=>setEditingTextId(layer.id)} nodeRef={ref}/>}</Group>;
  };

  return <div className="workspace relative h-full w-full overflow-hidden select-none">
    <div ref={scrollRef} data-testid="canvas-scroll" onScroll={scheduleScrollSync} className="absolute inset-0 overflow-auto scrollbar-thin"><div style={{width:spacerWidth,height:spacerHeight}} /></div>
    <div className="absolute inset-0 pointer-events-auto overflow-hidden">
      <Stage ref={stageRef} width={Math.max(1,width)} height={Math.max(1,height)} onWheel={onWheel} onContextMenu={(e)=>{e.evt.preventDefault();openContextMenu(e.evt.clientX,e.evt.clientY,layerMenu(),'Canvas actions');}} onMouseDown={(e)=>{if(e.target===e.target.getStage())selectPageAtPointer();}} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={()=>{if(touch.current)selectPageAtPointer();touch.current=null;}}>
        <KLayer listening={false}><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>{visibleSlides.map(({slide,index})=>{const x=index*fmt.width;return <Group key={slide.id} x={x}><Rect width={fmt.width} height={fmt.height} fill={slide.background.kind==='solid'?slide.background.color:'#fff'} shadowColor="#000000" shadowOpacity={0.55} shadowBlur={32/zoom} shadowOffsetY={8/zoom}/>{slide.background.kind==='gradient'&&<Rect width={fmt.width} height={fmt.height} fillLinearGradientStartPoint={{x:0,y:0}} fillLinearGradientEndPoint={{x:fmt.width*Math.cos(slide.background.angle*Math.PI/180),y:fmt.height*Math.sin(slide.background.angle*Math.PI/180)}} fillLinearGradientColorStops={[0,slide.background.from,1,slide.background.to]}/>}<Rect width={fmt.width} height={fmt.height} stroke={slide.id===selectedSlideId?'#7c5cff':'#2a2a31'} strokeWidth={(slide.id===selectedSlideId?3:1)/zoom}/></Group>;})}</Group></KLayer>
        <KLayer><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>{visibleItems.map((item)=>renderNode(item.slideId,item.layer))}<Transformer ref={transformerRef} rotateEnabled anchorSize={10} anchorCornerRadius={3} anchorStroke="#7c5cff" anchorFill="#ffffff" borderStroke="#7c5cff" borderStrokeWidth={1.5} keepRatio={active?.kind==='image'} ignoreStroke /></Group></KLayer>
        <KLayer listening={false}><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>{resizeSeams.map((seam)=><Group key={`seam-${seam.x}`}><Rect x={seam.x-6/zoom} y={seam.y} width={12/zoom} height={seam.height} fill="#ff3b8a" opacity={0.2}/><Line points={[seam.x,seam.y,seam.x,seam.y+seam.height]} stroke="#ff3b8a" strokeWidth={3/zoom} dash={[10/zoom,6/zoom]}/></Group>)}{guides.map((g,i)=>g.orientation==='v'?<Line key={i} points={[guideOffsetX+g.position,g.start,guideOffsetX+g.position,g.end]} stroke="#ff3b8a" strokeWidth={1/zoom}/>:<Line key={i} points={[guideOffsetX+g.start,g.position,guideOffsetX+g.end,g.position]} stroke="#ff3b8a" strokeWidth={1/zoom}/>)}</Group></KLayer>
      </Stage>
    </div>
    {editingTextId&&active?.kind==='text'&&stageRef.current&&(
      <TextEditor layer={active} stage={stageRef.current} offsetX={pageX(doc.slideOrder.find((sid)=>doc.slides[sid].layerOrder.includes(active.id))??selectedSlideId)} scale={zoom} viewportOffset={{x:originX-scrollPosition.current.left,y:centeredY-scrollPosition.current.top}} onClose={()=>setEditingTextId(null)}/>
    )}
  </div>;
}
