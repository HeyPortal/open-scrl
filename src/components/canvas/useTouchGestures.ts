import { useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import Konva from 'konva';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { editorActivity } from '@/editor/activity';
import { findLayerSlideId } from '@/core/document/selectors';
import { createMobileHitTest } from './mobileHitTest';
import {
  angleBetween, clamp, contentPointAt, distance, easeOutCubic, layerTwoFinger, midpoint, pickSettleSlide, pinchView, pointInLayer,
  sampleVelocity, scaleLimits, shortestTurn, slideIndexAtCentre, slideScrollLeft, snapZoom,
  type LayerFrame, type LayerPinch, type PinchStart, type Point, type Sample, type Scroll, type ViewGeometry,
} from './touchMath';

/** Finger travel before a touch on empty canvas counts as a pan instead of a tap. */
const SLOP = 8;
const TAP_MS = 500;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE = 40;
/** Browsers echo a tap as mouse events shortly after touchend. */
const TOUCH_ECHO_MS = 700;
/** How far outside a layer a two-finger gesture may start and still transform it. */
const LAYER_MARGIN_PX = 28;
const MIN_LAYER_SIZE = 8;
const SETTLE_MS = 220;

/** What the canvas shows right now, read on every gesture event. */
export interface GestureView {
  zoom: number;
  /** Stage position of the deck origin: what is drawn. */
  offset: Point;
  geometry: ViewGeometry;
  fitZoom: number;
  limits: { min: number; max: number };
  slideWidth: number;
  slideOrder: string[];
}

/** The canvas side of the gestures: it owns zoom, scroll and the Konva nodes. */
export interface GestureHost {
  view(): GestureView;
  /** Zooms and scrolls in one step and records the zoom as chosen by the user. */
  applyView(zoom: number, scroll: Scroll): void;
  scrollTo(left: number, top: number): void;
  /** Back to the fit zoom, with the selected slide centred. */
  resetZoom(): void;
  /** True while the user's pinch zoom, rather than the fit zoom, is in effect. */
  isCustomZoom(): boolean;
  /** Selects a slide (clearing the layer selection) without re-centring a zoomed view on it. */
  selectSlideQuiet(slideId: string): void;
  layerNode(layerId: string): Konva.Node | undefined;
  pageX(slideId: string): number;
  /** Marks the layer drag in progress as cancelled, so its end discards the move instead of committing it. */
  cancelDrag(): void;
}

type Mode = 'idle' | 'konva' | 'candidate' | 'pan' | 'pinch' | 'xform' | 'ignore' | 'dead';

interface TransformSession {
  id: string;
  node: Konva.Node;
  page: number;
  frame: LayerFrame;
  start: [Point, Point];
  limits: { minScale: number; maxScale: number };
  turn: number;
  prevAngle: number;
  latest: LayerPinch | null;
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ends any Konva layer drag in progress; the dragged layers commit where they are. */
function cancelKonvaDrags() {
  for (const element of [...Konva.DD._dragElements.values()]) element.node.stopDrag();
}

function blurTextFields() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable)) active.blur();
}

/**
 * Touch gestures for the mobile canvas, handled on the stage's container in the capture phase
 * so multi-touch never reaches Konva (which would select whatever is under the second finger):
 *
 * - one finger on empty canvas (or a locked layer) pans; a short tap on empty canvas selects the
 *   slide under it and clears the layer selection; a double tap while zoomed returns to fit;
 * - two fingers pinch-zoom around their midpoint while panning with it, or, when they start on
 *   the selected unlocked layer, scale + rotate + move that layer as a single undo step;
 * - a swipe at the fit zoom settles on the nearest slide (or the next one for a flick).
 *
 * One finger on a layer is left to Konva: tap selects, drag moves with snapping.
 */
export function useTouchGestures(
  enabled: boolean,
  stageRef: RefObject<Konva.Stage | null>,
  scrollRef: RefObject<HTMLDivElement | null>,
  hostRef: MutableRefObject<GestureHost | null>,
) {
  const lastTouch = useRef(0);
  const abortGestures = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const container = stage?.container();
    if (!enabled || !stage || !container) return;

    // The gesture hook and Konva's native handlers must resolve the same live Shape.
    const bitmapHitTest = stage.getIntersection;
    const mobileHitTest = createMobileHitTest(stage, (id) => useEditor.getState().doc.layers[id]);
    stage.getIntersection = mobileHitTest;

    let mode: Mode = 'idle';
    let ids: [number, number] = [-1, -1];
    let panId = -1;
    let moved = false;
    let tapEmpty = false;
    let begin = { x: 0, y: 0, t: 0, scroll: { left: 0, top: 0 }, index: 0 };
    let samples: Sample[] = [];
    let pinch: PinchStart | null = null;
    let transform: TransformSession | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tween = 0;
    // Unfinished canvas work holds back a waiting app update, like the desktop gestures do. It is
    // taken once a touch the canvas itself handles begins and released when every finger is up,
    // the touch is cancelled, or the gestures are torn down. A layer drag or handle resize that
    // Konva runs is tracked by the canvas.
    let releaseActivity: (() => void) | null = null;
    const hold = () => { releaseActivity ??= editorActivity.begin(); };
    const release = () => { const done = releaseActivity; releaseActivity = null; done?.(); };

    const host = () => hostRef.current!;
    const local = (t: Touch): Point => {
      const rect = stage.content.getBoundingClientRect();
      return { x: (t.clientX - rect.left) / (rect.width / stage.content.clientWidth || 1), y: (t.clientY - rect.top) / (rect.height / stage.content.clientHeight || 1) };
    };
    const find = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    const prevent = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    const swallow = (e: Event) => { e.stopPropagation(); prevent(e); };

    const stopTween = () => { if (tween) cancelAnimationFrame(tween); tween = 0; };
    const tweenScroll = (to: number, done: () => void) => {
      const el = scrollRef.current;
      stopTween();
      if (!el) return;
      const from = el.scrollLeft;
      if (Math.abs(to - from) < 1 || prefersReducedMotion()) {
        if (Math.abs(to - from) >= 1) host().scrollTo(to, el.scrollTop);
        done();
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = (now - t0) / SETTLE_MS;
        host().scrollTo(from + (to - from) * easeOutCubic(k), el.scrollTop);
        if (k < 1) tween = requestAnimationFrame(step);
        else { tween = 0; done(); }
      };
      tween = requestAnimationFrame(step);
    };

    // ---- panning ---------------------------------------------------------------------

    const beginPan = (touch: Touch, alreadyMoved: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const p = local(touch);
      const v = host().view();
      panId = touch.identifier;
      moved = alreadyMoved;
      begin = {
        x: p.x, y: p.y, t: performance.now(), scroll: { left: el.scrollLeft, top: el.scrollTop },
        index: slideIndexAtCentre(v.geometry, v.zoom, el.scrollLeft, v.slideWidth, v.slideOrder.length),
      };
      samples = [{ t: begin.t, x: p.x }];
    };

    const panMove = (e: TouchEvent) => {
      const touch = find(e.touches, panId);
      if (!touch) return;
      const p = local(touch);
      if (!moved) {
        if (Math.hypot(p.x - begin.x, p.y - begin.y) < SLOP) return;
        moved = true;
        mode = 'pan';
      }
      prevent(e);
      host().scrollTo(begin.scroll.left - (p.x - begin.x), begin.scroll.top - (p.y - begin.y));
      samples.push({ t: performance.now(), x: p.x });
      if (samples.length > 12) samples.shift();
    };

    /**
     * After a pan or pinch: follow the viewport with the slide selection (unless layers are
     * selected, which pins the selection), return to fit when close to it, and at the fit zoom
     * settle on a slide.
     */
    const settle = (velocity: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const h = host();
      const v = h.view();
      const count = v.slideOrder.length;
      const pinned = useEditorSession.getState().selectedLayerIds.length > 0;
      const selected = useEditorSession.getState().selectedSlideId;
      const centre = slideIndexAtCentre(v.geometry, v.zoom, el.scrollLeft, v.slideWidth, count);
      if (h.isCustomZoom()) {
        if (!pinned && v.slideOrder[centre] && v.slideOrder[centre] !== selected) h.selectSlideQuiet(v.slideOrder[centre]);
        if (snapZoom(v.zoom, v.fitZoom) === v.fitZoom) h.resetZoom();
        return;
      }
      if (pinned) return;
      const target = pickSettleSlide(begin.index, centre, velocity, count);
      const slideId = v.slideOrder[target];
      const select = () => { if (slideId && slideId !== useEditorSession.getState().selectedSlideId) h.selectSlideQuiet(slideId); };
      tweenScroll(slideScrollLeft(v.geometry, v.zoom, target, v.slideWidth), select);
    };

    const handleTap = (x: number, y: number) => {
      const now = performance.now();
      const double = !!lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_DISTANCE;
      lastTap = double ? null : { t: now, x, y };
      const h = host();
      if (double && h.isCustomZoom()) { h.resetZoom(); return; }
      const v = h.view();
      const index = clamp(Math.floor((x - v.offset.x) / v.zoom / v.slideWidth), 0, v.slideOrder.length - 1);
      const slideId = v.slideOrder[index];
      if (slideId) h.selectSlideQuiet(slideId);
    };

    // ---- two fingers: pinch the canvas -----------------------------------------------

    const beginPinch = (a: Touch, b: Touch) => {
      const el = scrollRef.current;
      if (!el) return;
      const v = host().view();
      const pa = local(a);
      const pb = local(b);
      mode = 'pinch';
      ids = [a.identifier, b.identifier];
      pinch = { zoom: v.zoom, distance: distance(pa, pb), content: contentPointAt(v.geometry, v.zoom, { left: el.scrollLeft, top: el.scrollTop }, midpoint(pa, pb)) };
    };

    const pinchMove = (e: TouchEvent) => {
      const a = find(e.touches, ids[0]);
      const b = find(e.touches, ids[1]);
      if (!a || !b || !pinch) return;
      const pa = local(a);
      const pb = local(b);
      const v = host().view();
      const next = pinchView(v.geometry, pinch, midpoint(pa, pb), distance(pa, pb), v.limits);
      host().applyView(next.zoom, next.scroll);
    };

    // ---- two fingers: transform the selected layer -----------------------------------

    const beginTransform = (a: Touch, b: Touch) => {
      const d = useEditor.getState().doc;
      const selection = useEditorSession.getState().selectedLayerIds.filter((id) => d.layers[id]);
      if (selection.length !== 1) return false;
      const layer = d.layers[selection[0]];
      const slideId = findLayerSlideId(d, layer.id);
      const node = host().layerNode(layer.id);
      if (layer.locked || !layer.visible || !slideId || !node) return false;
      const v = host().view();
      const page = host().pageX(slideId);
      const world = (t: Touch): Point => { const p = local(t); return { x: (p.x - v.offset.x) / v.zoom, y: (p.y - v.offset.y) / v.zoom }; };
      const frame: LayerFrame = { cx: page + layer.x + layer.width / 2, cy: layer.y + layer.height / 2, width: layer.width, height: layer.height, rotation: layer.rotation };
      const start: [Point, Point] = [world(a), world(b)];
      if (!pointInLayer(midpoint(start[0], start[1]), frame, LAYER_MARGIN_PX / v.zoom)) return false;
      transform = {
        id: layer.id, node, page, frame, start, turn: 0, prevAngle: angleBetween(start[0], start[1]), latest: null,
        limits: scaleLimits(frame, MIN_LAYER_SIZE, Math.max(v.geometry.deckWidth, v.geometry.slideHeight) * 2),
      };
      mode = 'xform';
      ids = [a.identifier, b.identifier];
      return true;
    };

    const transformMove = (e: TouchEvent) => {
      const s = transform;
      const a = find(e.touches, ids[0]);
      const b = find(e.touches, ids[1]);
      if (!s || !a || !b) return;
      const v = host().view();
      const world = (t: Touch): Point => { const p = local(t); return { x: (p.x - v.offset.x) / v.zoom, y: (p.y - v.offset.y) / v.zoom }; };
      const current: [Point, Point] = [world(a), world(b)];
      const angle = angleBetween(current[0], current[1]);
      s.turn += shortestTurn(s.prevAngle, angle);
      s.prevAngle = angle;
      const result = layerTwoFinger(s.frame, s.start, current, s.turn, s.limits);
      s.latest = result;
      // Preview on the node alone (like the Transformer); the document changes once, on release.
      s.node.setAttrs({ x: result.cx - s.page, y: result.cy, rotation: result.rotation, scaleX: result.scale, scaleY: result.scale });
      s.node.getLayer()?.batchDraw();
    };

    const finishTransform = (commit: boolean) => {
      const s = transform;
      transform = null;
      if (!s) return;
      const result = s.latest;
      const layer = useEditor.getState().doc.layers[s.id];
      if (commit && result && layer) {
        const width = layer.width * result.scale;
        const height = layer.height * result.scale;
        const tx = useEditor.getState().beginTransaction('Transform layer');
        useEditor.getState().resizeLayers([s.id], { x: layer.x, y: layer.y, width: layer.width, height: layer.height }, { x: result.cx - s.page - width / 2, y: result.cy - height / 2, width, height });
        useEditor.getState().updateLayers([{ id: s.id, patch: { rotation: result.rotation } }]);
        useEditor.getState().commitTransaction(tx);
      }
      // Snap the node to the document; React only re-applies props that changed.
      const next = useEditor.getState().doc.layers[s.id];
      if (next) s.node.setAttrs({ x: next.x + next.width / 2, y: next.y + next.height / 2, rotation: next.rotation, scaleX: 1, scaleY: 1 });
      s.node.getLayer()?.batchDraw();
    };

    // ---- events ----------------------------------------------------------------------

    const reset = () => {
      if (transform) finishTransform(false);
      pinch = null;
      mode = 'idle';
      release();
    };

    // The canvas aborts everything in flight when the window loses focus or the project changes
    // (it stops Konva's own drag and resize itself). Fingers that are still down are ignored
    // until the next touch starts.
    abortGestures.current = () => {
      stopTween();
      reset();
    };

    // Konva's Transformer only listens for touchend, and its drag cleanup
    // requires a matching changed touch. An interrupted stream can leave
    // either active, which suppresses the whole layer's hit canvas.
    const finishNativeGesture = () => {
      let finished = false;
      for (const transformer of stage.find<Konva.Transformer>('Transformer')) {
        if (!transformer.isTransforming()) continue;
        transformer.stopTransform();
        finished = true;
      }
      for (const element of [...Konva.DD._dragElements.values()]) {
        if (element.node.getStage() !== stage) continue;
        element.node.stopDrag();
        finished = true;
      }
      if (finished) stage.draw();
    };

    const onStart = (e: TouchEvent) => {
      lastTouch.current = Date.now();
      stopTween();
      if (e.touches.length === 1) {
        reset();
        // A new first finger also recovers a gesture whose terminal event was
        // lost while the browser or OS interrupted the previous touch.
        finishNativeGesture();
        blurTextFields();
        const touch = e.touches[0];
        const hit = stage.getIntersection(local(touch));
        const layerId = hit?.findAncestor('.layer', true)?.id();
        const layer = layerId ? useEditor.getState().doc.layers[layerId] : undefined;
        tapEmpty = !hit;
        if (hit && !layer?.locked) { mode = 'konva'; return; }
        // Empty canvas, or a locked layer that can only be tapped: the finger pans the view.
        mode = 'candidate';
        hold();
        beginPan(touch, false);
        prevent(e);
        return;
      }
      // Konva never sees additional fingers: it would select whatever they land on.
      swallow(e);
      if (mode === 'pinch' || mode === 'xform' || mode === 'dead' || mode === 'ignore') return;
      if (stage.find<Konva.Transformer>('Transformer').some((t) => t.isTransforming())) { mode = 'ignore'; return; }
      cancelKonvaDrags();
      hold();
      const [a, b] = [e.touches[0], e.touches[1]];
      if (!beginTransform(a, b)) beginPinch(a, b);
    };

    const onMove = (e: TouchEvent) => {
      if (mode === 'candidate' || mode === 'pan') panMove(e);
      else if (mode === 'pinch') { swallow(e); pinchMove(e); }
      else if (mode === 'xform') { swallow(e); transformMove(e); }
      else if (mode === 'dead') swallow(e);
    };

    const handleEnd = (e: TouchEvent) => {
      const remaining = e.touches.length;
      const cancelled = e.type === 'touchcancel';
      // Cancel a move before stopping its native drag so the preview rolls
      // back. A handle resize finishes at its last visible size.
      if (cancelled) { host().cancelDrag(); finishNativeGesture(); }
      if (mode === 'candidate') {
        if (remaining > 0) return;
        mode = 'idle';
        if (!cancelled && tapEmpty && performance.now() - begin.t < TAP_MS) {
          // Handled here, so the echoed mouse events must not start a marquee.
          prevent(e);
          handleTap(begin.x, begin.y);
        }
      } else if (mode === 'pan') {
        e.stopPropagation(); // not a tap on a locked layer
        if (remaining > 0) return;
        mode = 'idle';
        if (!cancelled) settle(sampleVelocity(samples, performance.now()));
      } else if (mode === 'pinch') {
        e.stopPropagation();
        if (remaining >= 2) beginPinch(e.touches[0], e.touches[1]);
        else if (remaining === 1) { mode = 'pan'; beginPan(e.touches[0], true); }
        else { mode = 'idle'; pinch = null; if (!cancelled) settle(0); }
      } else if (mode === 'xform') {
        e.stopPropagation();
        finishTransform(!cancelled);
        mode = remaining > 0 ? 'dead' : 'idle';
      } else if (mode === 'dead') {
        e.stopPropagation();
        if (remaining === 0) mode = 'idle';
      } else if (mode === 'ignore') {
        if (remaining > 0) e.stopPropagation();
        else mode = 'idle';
      } else if (remaining === 0) mode = 'idle';
    };

    // The hold ends after any commit above, so a waiting update sees the finished document.
    const onEnd = (e: TouchEvent) => {
      try { handleEnd(e); } finally { if (e.touches.length === 0) release(); }
    };

    const options = { capture: true, passive: false } as const;
    container.addEventListener('touchstart', onStart, options);
    container.addEventListener('touchmove', onMove, options);
    container.addEventListener('touchend', onEnd, options);
    container.addEventListener('touchcancel', onEnd, options);
    // iOS Safari's own pinch-to-zoom of the page.
    container.addEventListener('gesturestart', prevent);
    container.addEventListener('gesturechange', prevent);
    return () => {
      stopTween();
      reset();
      abortGestures.current = () => undefined;
      container.removeEventListener('touchstart', onStart, options);
      container.removeEventListener('touchmove', onMove, options);
      container.removeEventListener('touchend', onEnd, options);
      container.removeEventListener('touchcancel', onEnd, options);
      container.removeEventListener('gesturestart', prevent);
      container.removeEventListener('gesturechange', prevent);
      if (stage.getIntersection === mobileHitTest) stage.getIntersection = bitmapHitTest;
    };
  }, [enabled, stageRef, scrollRef, hostRef]);

  return {
    recentTouch: () => Date.now() - lastTouch.current < TOUCH_ECHO_MS,
    /** Discards the pinch, pan or layer transform in flight without committing it, and releases its hold on updates. */
    abort: () => abortGestures.current(),
  };
}
