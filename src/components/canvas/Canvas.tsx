import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Group, Layer as KLayer, Line, Rect, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import { MAX_ZOOM, MIN_ZOOM, useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { editorActivity } from '@/editor/activity';
import { clickWouldNarrow, enterGroup, narrowTo, pickLayer } from '@/editor/selectionActions';
import { useToasts } from '@/store/toasts';
import { useContextMenu } from '@/components/Menu';
import { layerMenu } from '@/app/menus';
import { isMac } from '@/app/actions';
import type { Bounds, Layer as DocLayer, Slide } from '@/types';
import { expandToGroups, findLayerSlideId, getSlideLayers, selectionSlideId } from '@/core/document/selectors';
import { rotatedBounds, scaleLayer, unionBounds } from '@/core/document/geometry';
import { intersects } from '@/core/document/coordinates';
import { compileScene } from '@/core/scene/compileScene';
import { findCrossedSlideSeams } from '@/core/scene/slideSeams';
import { getCanvasScrollIntent } from '@/core/scene/scrollIntent';
import { snapBox, type SnapGuide } from '@/lib/snap';
import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { ShapeNode } from './ShapeNode';
import { TextEditor } from './TextEditor';
import { MobileTextEditor } from './MobileTextEditor';
import { SlideHeaders } from './SlideHeaders';
import { SlideBackground } from './SlideBackground';
import { SELECTION_COLOR } from './SelectionOutline';
import { contentPointAt, scrollForAnchor, zoomLimits, type ViewGeometry } from './touchMath';
import { useTouchGestures, type GestureHost } from './useTouchGestures';
import { addPhotosAt, describeFill, dragCarriesAsset, dragCarriesFiles, locateDrop, readDroppedAssetId, readDroppedFiles, type DropLocation } from './mediaDrop';

const SNAP_THRESHOLD_PX = 6;
const DESKTOP_PADDING = 32;
/** The mobile stage is narrow: a 4:5 slide should nearly fill its width. */
const MOBILE_PADDING = 16;
/** Finger travel before a touch drag starts, so a tap never nudges a layer. */
const TOUCH_DRAG_DISTANCE = 6;
/** Layers thinner than this on screen get a bigger hit area on mobile. */
const TOUCH_TARGET_PX = 32;
/** Desktop zoom limits. A constant, so the zoom effect never re-runs just because the deck changed. */
const DESKTOP_ZOOM_RANGE = { min: MIN_ZOOM, max: MAX_ZOOM };
const MOBILE_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** Extra room under the strip in wide mode for the selected-slide marker. */
const WIDE_PADDING = 56;
const BUFFER_SLIDES = 0;
const MIN_LAYER_SIZE = 8;
const EDITOR_PIXEL_RATIO = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
Konva.pixelRatio = EDITOR_PIXEL_RATIO;
// A few pixels of slack so a click on a selected layer isn't mistaken for a tiny drag.
Konva.dragDistance = 3;

/** The browser must leave touches on the canvas to us: no page pan, pinch-zoom or callout. */
const TOUCH_SURFACE = { touchAction: 'none', WebkitTouchCallout: 'none' } as const;
/** Larger hit area for the mobile Transformer's handles: an 18px handle plus 13px each side is 44px. */
const touchAnchor = (anchor: Konva.Rect) => { anchor.hitStrokeWidth(26); };

type PointerEvt = MouseEvent | TouchEvent;
/** Shift, or ⌘ on a Mac and Ctrl elsewhere, adds to or removes from the selection. */
const isAdditive = (evt: PointerEvt) => evt.shiftKey || (isMac ? evt.metaKey : evt.ctrlKey);
const normalizeAngle = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const centerOf = (l: DocLayer) => ({ x: l.x + l.width / 2, y: l.y + l.height / 2 });

interface DragSession {
  anchorId: string;
  ids: string[];
  starts: Map<string, { x: number; y: number }>;
  union: Bounds;
  others: DocLayer[];
  offset: number;
  proxyStart: { x: number; y: number } | null;
  /** The drag began by selecting this layer (mobile), so the selection box appears only after the first render. */
  fresh: boolean;
  /** The touch was cancelled: drop the move instead of committing it. */
  cancelled: boolean;
  dx: number;
  dy: number;
}

interface GroupTransform {
  layers: Map<string, DocLayer>;
  from: Bounds;
  offset: number;
}

export function Canvas({ width, height, variant = 'desktop' }: { width: number; height: number; /** Touch-first behaviour for the mobile editor. */ variant?: 'desktop' | 'mobile' }) {
  const mobile = variant === 'mobile';
  const PADDING = mobile ? MOBILE_PADDING : DESKTOP_PADDING;
  const doc = useEditor((s) => s.doc);
  const activeProjectId = useEditor((s) => s.activeProjectId);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slideFocusRequest = useEditorSession((s) => s.slideFocusRequest);
  const selectedId = useEditorSession((s) => s.selectedLayerId);
  const selectedIds = useEditorSession((s) => s.selectedLayerIds);
  const active = useEditor((s) => selectedId ? s.doc.layers[selectedId] : undefined);
  const zoom = useEditorSession((s) => s.zoom);
  const setZoom = useEditorSession((s) => s.setZoom);
  const selectSlide = useEditorSession((s) => s.selectSlide);
  const selectLayer = useEditorSession((s) => s.selectLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setLeftPanel = useEditorSession((s) => s.setLeftPanel);
  const wideMode = useEditorView((s) => s.wideMode);
  const assets = useAssets((s) => s.assets);

  const openContextMenu = useContextMenu((s) => s.open);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const proxyRef = useRef<Konva.Rect>(null);
  const layerNodes = useRef(new Map<string, Konva.Node>());
  const scrollPosition = useRef({ left: 0, top: 0 });
  const raf = useRef<number | null>(null);
  const pendingFocusDraw = useRef<{ x: number; y: number } | null>(null);
  const touch = useRef<{ x:number; y:number; distance:number; zoom:number; left:number; top:number } | null>(null);
  // Mobile: the zoom the user pinched to (null = following the fit zoom), a scroll to apply once that zoom has rendered, and the last slide focus handled.
  const userZoom = useRef<number | null>(null);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const focusKey = useRef('');
  const lastSize = useRef({ width, height });
  const gestureHost = useRef<GestureHost | null>(null);
  const drag = useRef<DragSession | null>(null);
  const groupTransform = useRef<GroupTransform | null>(null);
  const pendingNarrow = useRef<string | null>(null);
  type CanvasActivity = `drag:${string}` | 'transform' | 'touch' | 'marquee';
  const activity = useRef(new Map<CanvasActivity, () => void>());
  const cancelling = useRef(false);
  const cancelGestures = useRef<(() => void) | null>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const beginActivity = useCallback((kind: CanvasActivity) => {
    if (!activity.current.has(kind)) activity.current.set(kind, editorActivity.begin());
  }, []);
  const endActivity = useCallback((kind: CanvasActivity) => {
    const release = activity.current.get(kind);
    activity.current.delete(kind);
    release?.();
  }, []);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
  const [viewportOffset, setViewportOffset] = useState({ x: PADDING, y: PADDING });
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [guideOffsetX, setGuideOffsetX] = useState(0);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [resizeSeams, setResizeSeams] = useState<{ x: number; y: number; height: number }[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  // What a media drag would land on right now; hovering never changes the selection.
  const [dropHover, setDropHover] = useState<{ slideId: string; layerId: string | null } | null>(null);
  // Live view transform for window listeners: clicking a slide can scroll the canvas mid-gesture.
  const viewRef = useRef({ offset: viewportOffset, zoom });
  useLayoutEffect(() => { viewRef.current = { offset: viewportOffset, zoom }; }, [viewportOffset, zoom]);
  const fmt = doc.format;
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  useLayoutEffect(() => {
    cancelling.current = false;
    const cancel = () => {
      cancelling.current = true;
      drag.current = null; groupTransform.current = null; touch.current = null;
      marqueeCleanup.current?.(); marqueeCleanup.current = null;
      // Stopping Konva emits end events; cancelled sessions must not commit.
      transformerRef.current?.stopTransform();
      const current = useEditor.getState().doc;
      for (const [id, node] of layerNodes.current) {
        node.stopDrag();
        const layer = current.layers[id];
        if (layer) node.setAttrs({ ...centerOf(layer), rotation: layer.rotation, scaleX: 1, scaleY: 1 });
      }
      const ids = useEditorSession.getState().selectedLayerIds.filter((id) => current.layers[id]);
      const bounds = unionBounds(ids.map((id) => rotatedBounds(current.layers[id])));
      const slideId = selectionSlideId(current, ids);
      if (bounds && slideId) proxyRef.current?.setAttrs({ x: current.slideOrder.indexOf(slideId) * current.format.width + bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rotation: 0, scaleX: 1, scaleY: 1 });
      transformerRef.current?.forceUpdate();
      for (const release of activity.current.values()) release();
      activity.current.clear();
    };
    const blur = () => { cancel(); cancelling.current = false; setGuides([]); setResizeSeams([]); setMarquee(null); };
    cancelGestures.current = blur;
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); cancelGestures.current = null; cancel(); };
  }, [activeProjectId]);

  const deckWidth = doc.slideOrder.length * fmt.width;
  const fitZoom = useMemo(() => !width || !height ? .5 : Math.max(MIN_ZOOM, Math.min((width-PADDING*2)/fmt.width,(height-PADDING*2)/fmt.height)), [width,height,fmt.width,fmt.height,PADDING]);
  const wideZoom = useMemo(() => !width || !height ? .5 : Math.max(MIN_ZOOM, Math.min(fitZoom, (width-PADDING*2)/deckWidth, (height-WIDE_PADDING*2)/fmt.height)), [PADDING, deckWidth, fitZoom, fmt.height, height, width]);
  const spacerHeight = Math.max(height, fmt.height * zoom + PADDING * 2);
  const centeredY = Math.max(PADDING, Math.round((height - fmt.height * zoom) / 2));
  // Center the deck horizontally when it is narrower than the viewport. On mobile one slide is what gets centred, so the first and last slides can be too.
  const centreWidth = mobile && !wideMode ? Math.min(deckWidth, fmt.width) : deckWidth;
  const originXFor = useCallback((z: number) => Math.max(PADDING, Math.round((width - centreWidth * z) / 2)), [PADDING, centreWidth, width]);
  const originX = originXFor(zoom);
  const spacerWidth = Math.max(width, deckWidth * zoom + (mobile ? originX : PADDING) * 2);

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
  // Wide mode keeps the whole carousel in view as slides are added or the window resizes.
  const targetZoom = wideMode ? wideZoom : fitZoom;
  // Mobile: a zoom the user pinched to survives re-fits (the sheet opening or closing resizes the stage).
  const zoomRange = useMemo(() => mobile ? zoomLimits(fitZoom, wideZoom, MIN_ZOOM, MAX_ZOOM) : DESKTOP_ZOOM_RANGE, [mobile, fitZoom, wideZoom]);
  const isCustomZoom = useCallback(() => mobile && userZoom.current !== null && Math.abs(userZoom.current - useEditorSession.getState().zoom) < 1e-4, [mobile]);
  useLayoutEffect(() => {
    setFitZoom(targetZoom);
    if (isCustomZoom()) { const kept = Math.max(zoomRange.min, Math.min(zoomRange.max, useEditorSession.getState().zoom)); userZoom.current = kept; setZoom(kept); } else setZoom(targetZoom);
  }, [isCustomZoom, setFitZoom, setZoom, targetZoom, zoomRange]);
  // Mobile: scroll that was computed for a new zoom lands only once the scroller has resized for it.
  useLayoutEffect(() => {
    const el = scrollRef.current; const pending = pendingScroll.current; if (!el || !pending) return;
    pendingScroll.current = null; el.scrollLeft = pending.left; el.scrollTop = pending.top;
    scrollPosition.current = { left: el.scrollLeft, top: el.scrollTop };
  }, [zoom]);
  // Mobile: when the stage is resized under a zoomed view, keep the same point at the centre.
  useLayoutEffect(() => {
    const before = lastSize.current; lastSize.current = { width, height };
    const el = scrollRef.current; if (!mobile || !el || !isCustomZoom() || (before.width === width && before.height === height)) return;
    const was: ViewGeometry = { width: before.width, height: before.height, deckWidth, centreWidth, slideHeight: fmt.height, padding: PADDING };
    const centre = contentPointAt(was, zoom, scrollPosition.current, { x: before.width / 2, y: before.height / 2 });
    const next = scrollForAnchor({ ...was, width, height }, zoom, centre, { x: width / 2, y: height / 2 });
    el.scrollLeft = next.left; el.scrollTop = next.top;
    scrollPosition.current = { left: el.scrollLeft, top: el.scrollTop };
  }, [PADDING, centreWidth, deckWidth, fmt.height, height, isCustomZoom, mobile, width, zoom]);
  useLayoutEffect(() => {
    const position = scrollPosition.current;
    setViewportOffset({ x: originX - position.left, y: centeredY - position.top });
    updateVisible();
  }, [centeredY, originX, updateVisible, zoom]);

  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const index = doc.slideOrder.indexOf(selectedSlideId); if (index < 0) return;
    // Mobile: a pinched view only re-centres when the focused slide changes, not while zooming or resizing.
    const key = `${selectedSlideId}:${slideFocusRequest}:${index}`;
    if (mobile && isCustomZoom() && focusKey.current === key) return;
    focusKey.current = key;
    const center = originX + (index + .5) * fmt.width * zoom;
    el.scrollTo({ left: Math.max(0, center - el.clientWidth / 2), behavior: 'auto' });
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    const position = { left: el.scrollLeft, top: el.scrollTop };
    scrollPosition.current = position;
    const nextOffset = { x: originX - position.left, y: centeredY - position.top };
    pendingFocusDraw.current = nextOffset;
    setViewportOffset(nextOffset);
    updateVisible();
  }, [centeredY, doc.slideOrder, fmt.width, isCustomZoom, mobile, originX, selectedSlideId, slideFocusRequest, updateVisible, zoom]);

  useLayoutEffect(() => {
    const pending = pendingFocusDraw.current;
    if (!pending || pending.x !== viewportOffset.x || pending.y !== viewportOffset.y) return;
    stageRef.current?.draw();
    pendingFocusDraw.current = null;
  }, [viewportOffset, visibleRange]);

  const pageX = useCallback((slideId: string) => doc.slideOrder.indexOf(slideId) * fmt.width, [doc.slideOrder, fmt.width]);

  // Mobile touch gestures live in useTouchGestures; this is the part of the canvas they drive.
  useLayoutEffect(() => {
    gestureHost.current = !mobile ? null : {
      view: () => ({ zoom: useEditorSession.getState().zoom, offset: viewRef.current.offset, geometry: { width, height, deckWidth, centreWidth, slideHeight: fmt.height, padding: PADDING }, fitZoom: targetZoom, limits: zoomRange, slideWidth: fmt.width, slideOrder: doc.slideOrder }),
      applyView: (next, scroll) => {
        const el = scrollRef.current; if (!el) return;
        userZoom.current = next;
        if (Math.abs(next - useEditorSession.getState().zoom) < 1e-9) { el.scrollLeft = scroll.left; el.scrollTop = scroll.top; scheduleScrollSync(); }
        else { pendingScroll.current = scroll; setZoom(next); }
      },
      scrollTo: (left, top) => { const el = scrollRef.current; if (!el) return; el.scrollLeft = left; el.scrollTop = top; scheduleScrollSync(); },
      resetZoom: () => {
        userZoom.current = null;
        const session = useEditorSession.getState(); const el = scrollRef.current; const index = doc.slideOrder.indexOf(session.selectedSlideId);
        if (Math.abs(session.zoom - targetZoom) > 1e-9) setZoom(targetZoom);
        else if (el && index >= 0) el.scrollTo({ left: Math.max(0, originX + (index + .5) * fmt.width * zoom - el.clientWidth / 2) });
      },
      isCustomZoom,
      selectSlideQuiet: (slideId) => { focusKey.current = `${slideId}:${slideFocusRequest}:${doc.slideOrder.indexOf(slideId)}`; selectSlide(slideId); },
      layerNode: (id) => layerNodes.current.get(id),
      pageX,
      cancelDrag: () => { if (drag.current) drag.current.cancelled = true; },
    };
  });
  const touchGestures = useTouchGestures(mobile, stageRef, scrollRef, gestureHost);

  /** A selection of more than one layer (several layers, or a group) is handled as one box. */
  const selectionBox = useMemo(() => {
    const ids = selectedIds.filter((id) => doc.layers[id]);
    if (ids.length < 2) return null;
    const slideId = selectionSlideId(doc, ids);
    const bounds = unionBounds(ids.map((id) => rotatedBounds(doc.layers[id])));
    if (!slideId || !bounds) return null;
    return { slideId, bounds, locked: ids.every((id) => doc.layers[id].locked) };
  }, [doc, selectedIds]);
  const selectedSet = useMemo(() => new Set(selectionBox ? selectedIds : []), [selectedIds, selectionBox]);

  useEffect(() => {
    const tr = transformerRef.current; if (!tr) return;
    let nodes: Konva.Node[] = [];
    if (selectionBox) {
      if (!selectionBox.locked && proxyRef.current) nodes = [proxyRef.current];
    } else {
      const node = selectedId ? layerNodes.current.get(selectedId) : undefined;
      if (node && !active?.locked) nodes = [node];
    }
    const previous = tr.nodes();
    if (tr.isTransforming() && (!nodes.length || previous.length !== nodes.length || previous.some((node, index) => node !== nodes[index]))) cancelGestures.current?.();
    tr.nodes(nodes); tr.getLayer()?.batchDraw();
  }, [active?.locked, selectedId, selectionBox, visibleRange]);

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
    if (mobile) userZoom.current = next;
    setZoom(next);
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, originXFor(next) + contentX * next - pointerX); el.scrollTop = Math.max(0, centeredY + contentY * next - pointerY); scheduleScrollSync(); });
  };

  const slideIndexAt = (stageX: number) => Math.max(0, Math.min(doc.slideOrder.length - 1, Math.floor(((stageX - viewportOffset.x) / zoom) / fmt.width)));
  const selectPageAtPointer = () => {
    const pointer=stageRef.current?.getPointerPosition();if(!pointer)return;
    const slideId=doc.slideOrder[slideIndexAt(pointer.x)];if(slideId){selectSlide(slideId);selectLayer(null);}
  };

  /** Drag on empty canvas to select every unlocked layer the box touches, on the slide it starts on. */
  const startMarquee = (evt: MouseEvent) => {
    const stage = stageRef.current; if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    const sx = evt.clientX - rect.left, sy = evt.clientY - rect.top;
    const index = slideIndexAt(sx);
    const slideId = doc.slideOrder[index]; if (!slideId) return;
    const additive = isAdditive(evt);
    const session = useEditorSession.getState();
    const base = additive && selectionSlideId(doc, session.selectedLayerIds) === slideId ? session.selectedLayerIds : [];
    if (!additive || session.selectedSlideId !== slideId) { selectSlide(slideId); selectLayer(null); }
    // Track the box in deck coordinates so it stays anchored if the canvas scrolls.
    const start = { x: (sx - viewportOffset.x) / zoom, y: (sy - viewportOffset.y) / zoom };
    beginActivity('marquee');
    let dragging = false;
    const move = (ev: MouseEvent) => {
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      if (!dragging && Math.hypot(x - sx, y - sy) < 4) return;
      dragging = true;
      const { offset, zoom: scale } = viewRef.current;
      const end = { x: (x - offset.x) / scale, y: (y - offset.y) / scale };
      const area = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      setMarquee({ x: offset.x + area.x * scale, y: offset.y + area.y * scale, width: area.width * scale, height: area.height * scale });
      const local = { ...area, x: area.x - index * fmt.width };
      const d = useEditor.getState().doc;
      const hits = getSlideLayers(d, slideId).filter((l) => l.visible && !l.locked && intersects(rotatedBounds(l), local)).map((l) => l.id);
      const next = expandToGroups(d, [...base, ...hits]);
      const current = useEditorSession.getState().selectedLayerIds;
      if (next.length !== current.length || next.some((id, i) => id !== current[i])) useEditorSession.getState().selectLayers(next);
    };
    const clean = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); marqueeCleanup.current = null; endActivity('marquee'); };
    const up = () => { clean(); setMarquee(null); };
    marqueeCleanup.current = clean;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onTouchStart=(event:Konva.KonvaEventObject<TouchEvent>)=>{const touches=event.evt.touches;const el=scrollRef.current;if(!el)return;if(touches.length===1&&event.target!==event.target.getStage())return;beginActivity('touch');const x=[...touches].reduce((n,p)=>n+p.clientX,0)/touches.length;const y=[...touches].reduce((n,p)=>n+p.clientY,0)/touches.length;const distance=touches.length>1?Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY):0;touch.current={x,y,distance,zoom,left:el.scrollLeft,top:el.scrollTop};};
  const onTouchMove=(event:Konva.KonvaEventObject<TouchEvent>)=>{const start=touch.current;const el=scrollRef.current;const touches=event.evt.touches;if(!start||!el||!touches.length)return;event.evt.preventDefault();const x=[...touches].reduce((n,p)=>n+p.clientX,0)/touches.length;const y=[...touches].reduce((n,p)=>n+p.clientY,0)/touches.length;if(touches.length>1&&start.distance>0){const distance=Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);setZoom(Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,start.zoom*distance/start.distance)));}el.scrollLeft=start.left-(x-start.x);el.scrollTop=start.top-(y-start.y);scheduleScrollSync();};

  const clearDropHover = useCallback(() => setDropHover(null), []);
  useEffect(() => {
    // A cancelled drag (Esc, drop elsewhere) must not leave the highlight behind.
    window.addEventListener('dragend', clearDropHover);
    window.addEventListener('drop', clearDropHover);
    return () => { window.removeEventListener('dragend', clearDropHover); window.removeEventListener('drop', clearDropHover); };
  }, [clearDropHover]);

  /** Hit-tests in document coordinates from the live scroll position, so it holds while the canvas scrolls or zooms. */
  const locateDragPoint = (clientX: number, clientY: number) => {
    const el = scrollRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    return locateDrop(useEditor.getState().doc, { x: (el.scrollLeft + clientX - rect.left - originX) / zoom, y: (el.scrollTop + clientY - rect.top - centeredY) / zoom });
  };
  const onMediaDragOver = (event: React.DragEvent) => {
    const asset = dragCarriesAsset(event.dataTransfer);
    if (!asset && !dragCarriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    const location = locateDragPoint(event.clientX, event.clientY);
    // Files can still be imported from anywhere; a thumbnail needs a slide to land on.
    event.dataTransfer.dropEffect = location || !asset ? 'copy' : 'none';
    const next = location ? { slideId: location.slideId, layerId: location.frame?.id ?? null } : null;
    setDropHover((old) => old?.slideId === next?.slideId && old?.layerId === next?.layerId ? old : next);
  };
  const onMediaDragLeave = (event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearDropHover();
  };
  const dropAsset = (assetId: string, location: DropLocation | null) => {
    const { assets: known, projectId } = useAssets.getState();
    const asset = projectId === useEditor.getState().activeProjectId ? known.find((a) => a.id === assetId) : undefined;
    if (!asset) { useToasts.getState().addToast('That media is no longer in this project.', 'warning'); return; }
    if (!location) return;
    const { frame } = location;
    if (!frame) { addPhotosAt(location.slideId, location.point, [asset]); return; }
    // Dropping a photo on the frame that already shows it changes nothing, so keep its crop.
    if (frame.assetId === asset.id || useEditor.getState().assignPhoto(frame.id, asset.id)) pickLayer(frame.id, false);
  };
  const dropFiles = async (files: File[], location: DropLocation | null) => {
    const projectId = useEditor.getState().activeProjectId;
    const imported = await useAssets.getState().importFiles(files, { reuseExisting: true });
    const editor = useEditor.getState();
    // Everything is imported once here; a project switch mid-import only keeps the files.
    if (!imported.length || editor.activeProjectId !== projectId || !location) return;
    const toast = useToasts.getState().addToast;
    const frame = editor.doc.layers[location.frame?.id ?? ''];
    if (location.frame) {
      if (frame?.kind !== 'image') return;
      const placed = editor.assignPhotos(frame.id, imported.map((a) => a.id));
      if (placed > 0) pickLayer(frame.id, false);
      toast(describeFill(placed, imported.length), placed > 0 ? 'success' : 'warning');
      return;
    }
    if (!editor.doc.slides[location.slideId]) return;
    addPhotosAt(location.slideId, location.point, imported);
  };
  const onMediaDrop = (event: React.DragEvent) => {
    const assetId = readDroppedAssetId(event.dataTransfer);
    const files = assetId ? [] : readDroppedFiles(event.dataTransfer);
    if (!assetId && !files.length) return;
    // Claim the drop so the shell's import fallback doesn't import the same files again.
    event.preventDefault(); event.stopPropagation();
    clearDropHover();
    const location = locateDragPoint(event.clientX, event.clientY);
    if (assetId) dropAsset(assetId, location);
    else void dropFiles(files, location);
  };

  const slideModel = (slideId: string): Slide => ({ id: slideId, background: doc.slides[slideId].background, layers: getSlideLayers(doc, slideId) });
  const localMoving = (node: Konva.Node, layer: DocLayer, transformed = false) => {
    const scaleX = transformed ? node.scaleX() : 1; const scaleY = transformed ? node.scaleY() : 1;
    const uniform = layer.kind === 'image' && transformed ? Math.max(Math.abs(scaleX), Math.abs(scaleY)) : null;
    const width = Math.max(MIN_LAYER_SIZE, layer.width * (uniform ?? scaleX)); const height = Math.max(MIN_LAYER_SIZE, layer.height * (uniform ?? scaleY));
    return { x: node.x() - width/2, y: node.y() - height/2, width, height };
  };
  const snap = (slide: Slide, layer: DocLayer, moving: {x:number;y:number;width:number;height:number}) => snapBox(moving, slide.layers.filter((l)=>l.id!==layer.id), fmt, SNAP_THRESHOLD_PX/zoom);

  // Scaling or rotating a multi-layer selection: the transformer drives an invisible box, and
  // every selected layer follows it. The document changes once, when the gesture ends.
  const onGroupTransformStart = () => {
    const proxy = proxyRef.current;
    if (!proxy || !selectionBox || transformerRef.current?.nodes()[0] !== proxy) return;
    const ids = selectedIds.filter((id) => doc.layers[id] && !doc.layers[id].locked);
    groupTransform.current = { layers: new Map(ids.map((id) => [id, doc.layers[id]])), from: selectionBox.bounds, offset: pageX(selectionBox.slideId) };
  };
  const applyGroupTransform = (commit: boolean) => {
    const st = groupTransform.current; const proxy = proxyRef.current;
    if (!st || !proxy) return;
    const rotation = proxy.rotation();
    if (Math.abs(rotation) > 0.001) {
      const cx = st.from.x + st.from.width / 2, cy = st.from.y + st.from.height / 2;
      const rad = rotation * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
      const patches: { id: string; patch: Partial<DocLayer> }[] = [];
      for (const [id, l] of st.layers) {
        const c = centerOf(l); const rx = c.x - cx, ry = c.y - cy;
        const center = { x: cx + rx * cos - ry * sin, y: cy + rx * sin + ry * cos };
        if (commit) patches.push({ id, patch: { x: center.x - l.width / 2, y: center.y - l.height / 2, rotation: normalizeAngle(l.rotation + rotation) } });
        else { const node = layerNodes.current.get(id); node?.position(center); node?.rotation(l.rotation + rotation); }
      }
      if (commit) useEditor.getState().updateLayers(patches);
      return;
    }
    const to = { x: proxy.x() - st.offset, y: proxy.y(), width: Math.max(MIN_LAYER_SIZE, proxy.width() * proxy.scaleX()), height: Math.max(MIN_LAYER_SIZE, proxy.height() * proxy.scaleY()) };
    if (commit) { useEditor.getState().resizeLayers([...st.layers.keys()], st.from, to); return; }
    for (const [id, l] of st.layers) {
      const next = scaleLayer(l, st.from, to); const node = layerNodes.current.get(id);
      node?.position(centerOf(next));
      node?.scale({ x: l.width ? next.width / l.width : 1, y: l.height ? next.height / l.height : 1 });
    }
  };
  const onGroupTransformEnd = () => {
    const st = groupTransform.current; const proxy = proxyRef.current;
    if (!st || !proxy) {
      // A detached single node cannot emit the later node transformend event.
      if (!transformerRef.current?.nodes().length || cancelling.current) endActivity('transform');
      return;
    }
    try {
      applyGroupTransform(true);
      // Snap the nodes and the box to the committed document; React only re-applies changed props.
      const next = useEditor.getState().doc;
      for (const id of st.layers.keys()) {
        const l = next.layers[id]; const node = layerNodes.current.get(id);
        if (l && node) node.setAttrs({ ...centerOf(l), rotation: l.rotation, scaleX: 1, scaleY: 1 });
      }
      const bounds = unionBounds(selectedIds.filter((id) => next.layers[id]).map((id) => rotatedBounds(next.layers[id])));
      proxy.setAttrs({ rotation: 0, scaleX: 1, scaleY: 1, ...(bounds ? { x: st.offset + bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : {}) });
      transformerRef.current?.forceUpdate();
    } finally { groupTransform.current = null; endActivity('transform'); }
  };

  const renderNode = (slideId: string, layer: DocLayer) => {
    const slide = slideModel(slideId); const offset = pageX(slideId);
    const onSelect = (e: Konva.KonvaEventObject<PointerEvt>) => {
      e.cancelBubble = true;
      if (mobile && e.type === 'tap' && clickWouldNarrow(layer.id)) { narrowTo(layer.id); return; }
      const additive = isAdditive(e.evt);
      pendingNarrow.current = !additive && 'button' in e.evt && e.evt.button === 0 && clickWouldNarrow(layer.id) ? layer.id : null;
      pickLayer(layer.id, additive);
      if (!additive && layer.kind === 'image' && !layer.assetId) setLeftPanel('photos');
    };
    // A click (no drag) on a layer inside a larger selection narrows the selection to it.
    const onClick = () => { if (pendingNarrow.current === layer.id) narrowTo(layer.id); pendingNarrow.current = null; };
    const onDblClick = () => {
      if (layer.kind === 'text') { enterGroup(layer.id); if (mobile) flushSync(() => setEditingTextId(layer.id)); else setEditingTextId(layer.id); }
      else if (layer.groupId) enterGroup(layer.id);
    };
    const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
      pendingNarrow.current = null;
      let fresh = false;
      if (mobile && !useEditorSession.getState().selectedLayerIds.includes(layer.id)) {
        // Touch selects on tap or when a drag starts, never on touchstart (which would hijack a pinch).
        // Picking a layer on another slide re-centres the view, so that one only selects.
        const sameSlide = findLayerSlideId(useEditor.getState().doc, layer.id) === useEditorSession.getState().selectedSlideId;
        pickLayer(layer.id, false); fresh = true;
        if (!sameSlide) { e.target.stopDrag(); return; }
      }
      const d = useEditor.getState().doc; const ids = useEditorSession.getState().selectedLayerIds;
      if (!ids.includes(layer.id)) { e.target.stopDrag(); return; }
      const movable = ids.filter((id) => d.layers[id] && !d.layers[id].locked);
      const union = unionBounds(movable.map((id) => rotatedBounds(d.layers[id])));
      if (!union) { e.target.stopDrag(); return; }
      beginActivity(`drag:${layer.id}`);
      const selected = new Set(ids);
      drag.current = {
        anchorId: layer.id, ids: movable, union, offset, dx: 0, dy: 0,
        starts: new Map(movable.map((id) => [id, centerOf(d.layers[id])])),
        others: getSlideLayers(d, slideId).filter((l) => !selected.has(l.id)),
        proxyStart: !fresh && selectionBox && proxyRef.current ? proxyRef.current.position() : null, fresh, cancelled: false,
      };
    };
    const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
      const st = drag.current; if (!st) return;
      // A drag that started by selecting the layer: its selection box exists from the first render after that.
      if (st.fresh && !st.proxyStart && proxyRef.current) st.proxyStart = proxyRef.current.position();
      const start = st.starts.get(st.anchorId)!;
      const moving = { ...st.union, x: st.union.x + e.target.x() - start.x, y: st.union.y + e.target.y() - start.y };
      const result = snapBox(moving, st.others, fmt, SNAP_THRESHOLD_PX / zoom);
      st.dx = result.x - st.union.x; st.dy = result.y - st.union.y;
      for (const id of st.ids) { const from = st.starts.get(id)!; layerNodes.current.get(id)?.position({ x: from.x + st.dx, y: from.y + st.dy }); }
      if (st.proxyStart) proxyRef.current?.position({ x: st.proxyStart.x + st.dx, y: st.proxyStart.y + st.dy });
      setGuideOffsetX(st.offset); setGuides(result.guides);
    };
    const onDragEnd = () => {
      const st = drag.current;
      if (st?.anchorId === layer.id) { drag.current = null; setGuides([]); }
      try {
        if (st?.anchorId === layer.id && st.cancelled) {
          for (const id of st.ids) { const from = st.starts.get(id)!; const node = layerNodes.current.get(id); node?.position(from); node?.getLayer()?.batchDraw(); }
          if (st.proxyStart) proxyRef.current?.position(st.proxyStart);
          return;
        }
        if (!st || st.anchorId !== layer.id || cancelling.current || (Math.abs(st.dx) < 1e-6 && Math.abs(st.dy) < 1e-6)) return;
        useEditor.getState().moveLayers(st.ids, st.dx, st.dy);
      } finally { endActivity(`drag:${layer.id}`); }
    };
    const onTransform = (e: Konva.KonvaEventObject<Event>) => { if(layer.locked)return;const moving=localMoving(e.target,layer,true);const result=snap(slide,layer,moving);e.target.position({x:result.x+moving.width/2,y:result.y+moving.height/2});setGuideOffsetX(offset);setGuides(result.guides);if(layer.kind==='image'){const seams=findCrossedSlideSeams({x:offset+result.x,y:result.y,width:moving.width,height:moving.height},fmt.width,doc.slideOrder.length);setResizeSeams(seams.map((x)=>({x,y:result.y,height:moving.height})));}else setResizeSeams([]); };
    const onTransformEnd = (e: Konva.KonvaEventObject<Event>) => { try { setResizeSeams([]);if(layer.locked||cancelling.current)return;const node=e.target;const moving=localMoving(node,layer,true);const result=snap(slide,layer,moving);node.scale({x:1,y:1});updateLayer(layer.id,{x:result.x,y:result.y,width:moving.width,height:moving.height,rotation:node.rotation()});setGuides([]); } finally { endActivity('transform'); } };
    const ref = (node: Konva.Node|null) => { if(node)layerNodes.current.set(layer.id,node);else layerNodes.current.delete(layer.id); };
    const outline = selectedSet.has(layer.id);
    const hitPad=mobile?{x:Math.max(0,(TOUCH_TARGET_PX/zoom-layer.width)/2),y:Math.max(0,(TOUCH_TARGET_PX/zoom-layer.height)/2)}:undefined;
    const props={onSelect,onClick,onDragStart,onDragMove,onDragEnd,onTransform,onTransformEnd,outline,touch:mobile,hitPad};
    return <Group key={layer.id} x={offset}>{layer.kind==='image'?<ImageNode {...props} onDblClick={onDblClick} layer={layer} asset={layer.assetId ? assetsById.get(layer.assetId) : undefined} activeSlide={selectedSlideId===slideId} selected={selectedId===layer.id} groupRef={ref} renderScale={zoom*EDITOR_PIXEL_RATIO} pixel={1/zoom}/>:layer.kind==='shape'?<ShapeNode {...props} onDblClick={onDblClick} layer={layer} groupRef={ref}/>:<TextNode {...props} layer={layer} editing={editingTextId===layer.id} onDblClick={onDblClick} nodeRef={ref}/>}</Group>;
  };

  const stripStart = visibleRange.start * fmt.width;
  const stripWidth = (visibleRange.end - visibleRange.start + 1) * fmt.width;
  const selectedIndex = doc.slideOrder.indexOf(selectedSlideId);
  const multi = !!selectionBox;
  const dropLayer = dropHover?.layerId ? doc.layers[dropHover.layerId] : undefined;
  const dropIndex = dropHover ? doc.slideOrder.indexOf(dropHover.slideId) : -1;

  return <div ref={workspaceRef} className="workspace relative h-full w-full overflow-hidden select-none" style={mobile?TOUCH_SURFACE:undefined} onDragEnter={onMediaDragOver} onDragOver={onMediaDragOver} onDragLeave={onMediaDragLeave} onDrop={onMediaDrop}>
    <div ref={scrollRef} data-testid="canvas-scroll" onScroll={scheduleScrollSync} className="absolute inset-0 overflow-auto scrollbar-thin"><div style={{width:spacerWidth,height:spacerHeight}} /></div>
    <div className="absolute inset-0 pointer-events-auto overflow-hidden" style={mobile?TOUCH_SURFACE:undefined}>
      <Stage ref={stageRef} width={Math.max(1,width)} height={Math.max(1,height)} {...(mobile?{dragDistance:TOUCH_DRAG_DISTANCE}:{})} onWheel={onWheel} onContextMenu={(e)=>{e.evt.preventDefault();openContextMenu(e.evt.clientX,e.evt.clientY,layerMenu(),'Canvas actions');}} onMouseDown={(e)=>{if(e.target!==e.target.getStage()||(mobile&&touchGestures.recentTouch()))return;if(e.evt.button===0)startMarquee(e.evt);else selectPageAtPointer();}} onTouchStart={mobile?undefined:onTouchStart} onTouchMove={mobile?undefined:onTouchMove} onTouchEnd={mobile?undefined:(e)=>{if(touch.current)selectPageAtPointer();touch.current=null;if(!e.evt.touches.length)endActivity('touch');}} onTouchCancel={mobile?undefined:()=>{touch.current=null;endActivity('touch');}}>
        <KLayer listening={false}><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>
          {/* One shadow under the whole strip, so neighboring slides don't shade each other at the seams. */}
          <Rect x={stripStart} width={stripWidth} height={fmt.height} fill="#ffffff" shadowColor="#000000" shadowOpacity={0.55} shadowBlur={32/zoom} shadowOffsetY={8/zoom}/>
          {visibleSlides.map(({slide,index})=>{const x=index*fmt.width;const bgAsset=slide.background.kind==='image'&&slide.background.assetId?assetsById.get(slide.background.assetId):undefined;const selected=slide.id===selectedSlideId;return <Group key={slide.id} x={x}><SlideBackground background={slide.background} asset={bgAsset} width={fmt.width} height={fmt.height} zoom={zoom}/>{!wideMode&&<Rect width={fmt.width} height={fmt.height} stroke={selected?SELECTION_COLOR:'#2a2a31'} strokeWidth={(selected?3:1)/zoom}/>}</Group>;})}
        </Group></KLayer>
        <KLayer><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>
          {visibleItems.map((item)=>renderNode(item.slideId,item.layer))}
          {selectionBox&&<Rect ref={proxyRef} x={pageX(selectionBox.slideId)+selectionBox.bounds.x} y={selectionBox.bounds.y} width={selectionBox.bounds.width} height={selectionBox.bounds.height} listening={false}/>}
          <Transformer ref={transformerRef} rotateEnabled anchorSize={mobile?18:10} anchorCornerRadius={mobile?9:3} anchorStroke={SELECTION_COLOR} anchorFill="#ffffff" borderStroke={SELECTION_COLOR} borderStrokeWidth={mobile?2.5:1.5} borderDash={multi?[4,3]:undefined} {...(mobile?{visible:!editingTextId,anchorStrokeWidth:2,rotateAnchorOffset:32,anchorStyleFunc:touchAnchor}:{})} keepRatio={multi||active?.kind==='image'} flipEnabled={!multi} ignoreStroke
            enabledAnchors={!multi&&active?.kind==='text'&&!active.autoFit?['middle-left','middle-right']:mobile&&!multi&&active?.kind==='image'?MOBILE_ANCHORS:undefined}
            boundBoxFunc={(oldBox,newBox)=>multi&&(Math.abs(newBox.width)<MIN_LAYER_SIZE*zoom||Math.abs(newBox.height)<MIN_LAYER_SIZE*zoom)?oldBox:newBox}
            onTransformStart={()=>{beginActivity('transform');onGroupTransformStart();}} onTransform={()=>applyGroupTransform(false)} onTransformEnd={onGroupTransformEnd}/>
        </Group></KLayer>
        <KLayer listening={false}><Group x={viewportOffset.x} y={viewportOffset.y} scaleX={zoom} scaleY={zoom}>
          {wideMode&&visibleSlides.slice(1).map(({index})=><Line key={`seam-${index}`} points={[index*fmt.width,0,index*fmt.width,fmt.height]} stroke="#ffffff" opacity={0.45} strokeWidth={1/zoom} dash={[6/zoom,5/zoom]}/>)}
          {wideMode&&selectedIndex>=visibleRange.start&&selectedIndex<=visibleRange.end&&<Rect x={selectedIndex*fmt.width} y={fmt.height+8/zoom} width={fmt.width} height={3/zoom} cornerRadius={1.5/zoom} fill={SELECTION_COLOR}/>}
          {resizeSeams.map((seam)=><Group key={`seam-${seam.x}`}><Rect x={seam.x-6/zoom} y={seam.y} width={12/zoom} height={seam.height} fill="#ff3b8a" opacity={0.2}/><Line points={[seam.x,seam.y,seam.x,seam.y+seam.height]} stroke="#ff3b8a" strokeWidth={3/zoom} dash={[10/zoom,6/zoom]}/></Group>)}
          {dropHover&&dropIndex>=0&&(dropLayer
            ?<Rect x={dropIndex*fmt.width+dropLayer.x+dropLayer.width/2} y={dropLayer.y+dropLayer.height/2} offsetX={dropLayer.width/2} offsetY={dropLayer.height/2} width={dropLayer.width} height={dropLayer.height} rotation={dropLayer.rotation} stroke={SELECTION_COLOR} strokeWidth={4/zoom} fill="rgba(124,92,255,0.22)"/>
            :<Rect x={dropIndex*fmt.width} width={fmt.width} height={fmt.height} stroke={SELECTION_COLOR} strokeWidth={3/zoom} dash={[12/zoom,8/zoom]} fill="rgba(124,92,255,0.06)"/>)}
          {guides.map((g,i)=>g.orientation==='v'?<Line key={i} points={[guideOffsetX+g.position,g.start,guideOffsetX+g.position,g.end]} stroke="#ff3b8a" strokeWidth={1/zoom}/>:<Line key={i} points={[guideOffsetX+g.start,g.position,guideOffsetX+g.end,g.position]} stroke="#ff3b8a" strokeWidth={1/zoom}/>)}
        </Group></KLayer>
      </Stage>
    </div>
    {marquee&&<div className="pointer-events-none absolute rounded-[2px] border border-accent" style={{left:marquee.x,top:marquee.y,width:marquee.width,height:marquee.height,background:'rgba(124,92,255,0.12)'}} data-testid="marquee"/>}
    {!mobile&&<SlideHeaders containerRef={workspaceRef} slides={visibleSlides} count={doc.slideOrder.length} selectedSlideId={selectedSlideId} offset={viewportOffset} slideWidth={fmt.width*zoom} slideHeight={fmt.height*zoom} numbersOnly={wideMode}/>}
    {editingTextId&&active?.kind==='text'&&stageRef.current&&(
      mobile
        ?<MobileTextEditor key={`${activeProjectId}:${active.id}`} layer={active} stage={stageRef.current} offsetX={pageX(doc.slideOrder.find((sid)=>doc.slides[sid].layerOrder.includes(active.id))??selectedSlideId)} scale={zoom} viewportOffset={{x:originX-scrollPosition.current.left,y:centeredY-scrollPosition.current.top}} onClose={()=>setEditingTextId(null)}/>
        :<TextEditor key={`${activeProjectId}:${active.id}`} layer={active} stage={stageRef.current} offsetX={pageX(doc.slideOrder.find((sid)=>doc.slides[sid].layerOrder.includes(active.id))??selectedSlideId)} scale={zoom} viewportOffset={{x:originX-scrollPosition.current.left,y:centeredY-scrollPosition.current.top}} onClose={()=>setEditingTextId(null)}/>
    )}
  </div>;
}
