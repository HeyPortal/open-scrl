/**
 * Pure geometry for the mobile canvas gestures: anchored pinch zoom, two-finger layer
 * transforms and slide settling. No DOM, Konva or store access, so it is unit-testable.
 *
 * Vocabulary: "screen" points are measured from the top-left of the canvas viewport,
 * "content" points are deck coordinates at zoom 1 (all slides side by side), and
 * "scroll" is the position of the native scroller that sits under the Konva stage.
 */

export interface Point { x: number; y: number }
export interface Scroll { left: number; top: number }

export interface ViewGeometry {
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  /** Size of the whole deck at zoom 1. */
  deckWidth: number;
  /** The width centred in the viewport when it is narrower (default: the whole deck). */
  centreWidth?: number;
  slideHeight: number;
  /** Smallest gap kept between the deck and the viewport edge. */
  padding: number;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const angleBetween = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);

/** Screen x where the deck starts: centred when narrower than the viewport, else padded. */
export const originXFor = (g: ViewGeometry, zoom: number) => Math.max(g.padding, Math.round((g.width - (g.centreWidth ?? g.deckWidth) * zoom) / 2));
/** Screen y where the slides start. */
export const originYFor = (g: ViewGeometry, zoom: number) => Math.max(g.padding, Math.round((g.height - g.slideHeight * zoom) / 2));

/** The deck point drawn under a screen point. */
export function contentPointAt(g: ViewGeometry, zoom: number, scroll: Scroll, screen: Point): Point {
  return { x: (scroll.left + screen.x - originXFor(g, zoom)) / zoom, y: (scroll.top + screen.y - originYFor(g, zoom)) / zoom };
}

/** The scroll position that draws a deck point under a screen point. Not clamped to the scroller. */
export function scrollForAnchor(g: ViewGeometry, zoom: number, content: Point, screen: Point): Scroll {
  return { left: originXFor(g, zoom) + content.x * zoom - screen.x, top: originYFor(g, zoom) + content.y * zoom - screen.y };
}

export interface PinchStart {
  zoom: number;
  distance: number;
  /** Deck point that was under the fingers' midpoint when the pinch began. */
  content: Point;
}

/**
 * Zoom and scroll for a pinch in progress. The deck point that started under the midpoint
 * stays under it as the fingers spread and move, so the view zooms around the fingers and
 * pans with them in one motion.
 */
export function pinchView(g: ViewGeometry, start: PinchStart, mid: Point, fingerDistance: number, limits: { min: number; max: number }) {
  const ratio = start.distance > 1 ? fingerDistance / start.distance : 1;
  const zoom = clamp(start.zoom * ratio, limits.min, limits.max);
  return { zoom, scroll: scrollForAnchor(g, zoom, start.content, mid) };
}

/** Returns `fit` when `zoom` is within `tolerance` (relative) of it, so a near-fit pinch settles exactly. */
export function snapZoom(zoom: number, fit: number, tolerance = 0.06) {
  return fit > 0 && Math.abs(zoom / fit - 1) <= tolerance ? fit : zoom;
}

/** Zoom range for pinching: a little past the fit-everything view, and a generous close-up. */
export function zoomLimits(fitZoom: number, wideZoom: number, hardMin: number, hardMax: number) {
  return { min: Math.max(hardMin, Math.min(fitZoom, wideZoom) * 0.7), max: Math.min(hardMax, Math.max(fitZoom * 8, 1)) };
}

// ---------------------------------------------------------------------------------------
// Two-finger layer transform
// ---------------------------------------------------------------------------------------

export interface LayerFrame {
  /** Centre of the layer in deck coordinates. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Degrees. */
  rotation: number;
}

export interface LayerPinch {
  scale: number;
  /** Absolute rotation in degrees, in [-180, 180). */
  rotation: number;
  cx: number;
  cy: number;
}

/** Signed shortest turn from angle `from` to angle `to`, in (-PI, PI]. */
export function shortestTurn(from: number, to: number) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Wraps to [-180, 180), like the canvas does when it saves a rotation. */
export const normalizeDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** Snaps to the nearest multiple of `step` degrees when within `tolerance` of it. */
export function snapRotation(degrees: number, step = 45, tolerance = 4) {
  const nearest = Math.round(degrees / step) * step || 0; // `|| 0` turns -0 into 0
  return Math.abs(degrees - nearest) <= tolerance ? nearest : degrees;
}

/** Scale bounds that keep a layer's smaller side at least `minSize` and its larger side at most `maxSize`. */
export function scaleLimits(frame: Pick<LayerFrame, 'width' | 'height'>, minSize: number, maxSize: number) {
  const small = Math.max(1e-6, Math.min(frame.width, frame.height));
  const large = Math.max(1e-6, Math.max(frame.width, frame.height));
  return { minScale: Math.min(1, minSize / small), maxScale: Math.max(1, maxSize / large) };
}

/**
 * Where a layer ends up when two fingers that began at `start` are now at `current`: it
 * scales with the finger spread, turns with the finger angle and follows the midpoint, so
 * the part of the layer under each finger stays under it. `turn` is the finger rotation in
 * radians since the gesture began; the caller accumulates it with `shortestTurn` so that
 * turning past half a revolution doesn't wrap.
 */
export function layerTwoFinger(base: LayerFrame, start: readonly [Point, Point], current: readonly [Point, Point], turn: number, limits: { minScale: number; maxScale: number }): LayerPinch {
  const from = distance(start[0], start[1]);
  const scale = clamp(from > 1e-6 ? distance(current[0], current[1]) / from : 1, limits.minScale, limits.maxScale);
  const m0 = midpoint(start[0], start[1]);
  const m1 = midpoint(current[0], current[1]);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const rx = base.cx - m0.x;
  const ry = base.cy - m0.y;
  return {
    scale,
    rotation: normalizeDegrees(snapRotation(base.rotation + (turn * 180) / Math.PI)),
    cx: m1.x + scale * (rx * cos - ry * sin),
    cy: m1.y + scale * (rx * sin + ry * cos),
  };
}

/** Whether a deck point is inside the (rotated) layer, grown by `margin` deck units on every side. */
export function pointInLayer(point: Point, frame: LayerFrame, margin = 0) {
  const angle = (-frame.rotation * Math.PI) / 180;
  const dx = point.x - frame.cx;
  const dy = point.y - frame.cy;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle);
  const y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= frame.width / 2 + margin && Math.abs(y) <= frame.height / 2 + margin;
}

// ---------------------------------------------------------------------------------------
// Settling on a slide after a swipe
// ---------------------------------------------------------------------------------------

/** Scroll position that centres a slide in the viewport. */
export function slideScrollLeft(g: ViewGeometry, zoom: number, index: number, slideWidth: number) {
  return Math.max(0, originXFor(g, zoom) + (index + 0.5) * slideWidth * zoom - g.width / 2);
}

/** Index of the slide under the viewport centre. */
export function slideIndexAtCentre(g: ViewGeometry, zoom: number, scrollLeft: number, slideWidth: number, count: number) {
  const x = (scrollLeft + g.width / 2 - originXFor(g, zoom)) / zoom;
  return clamp(Math.floor(x / slideWidth), 0, Math.max(0, count - 1));
}

/**
 * Which slide a swipe settles on. A quick flick moves one slide in its direction from where
 * it started; a slow drag lands on whichever slide is nearest the centre.
 * `velocityX` is the finger's velocity in px/ms (negative = swiping left, towards the next slide).
 */
export function pickSettleSlide(startIndex: number, nearestIndex: number, velocityX: number, count: number, flingSpeed = 0.35) {
  const last = Math.max(0, count - 1);
  if (Math.abs(velocityX) >= flingSpeed) return clamp(startIndex + (velocityX < 0 ? 1 : -1), 0, last);
  return clamp(nearestIndex, 0, last);
}

export interface Sample { t: number; x: number }

/** Average horizontal velocity (px/ms) over the last `window` ms of samples. */
export function sampleVelocity(samples: readonly Sample[], now: number, window = 100) {
  const recent = samples.filter((s) => now - s.t <= window);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  return last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
