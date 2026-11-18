import type { Layer } from '@/types';

export interface SnapGuide {
  orientation: 'v' | 'h';
  position: number;
  start: number;
  end: number;
}

/**
 * A gap between two neighbouring boxes that equals another gap on the slide.
 * `axis: 'x'` is a horizontal gap from `start` to `end` drawn at y = `position`;
 * `axis: 'y'` is a vertical gap drawn at x = `position`. Slide-local coordinates.
 */
export interface GapMarker {
  axis: 'x' | 'y';
  start: number;
  end: number;
  position: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  gaps: GapMarker[];
}

export interface SnapOptions {
  /**
   * Resizing: only this edge of each listed axis moves, and unlisted axes don't snap.
   * The returned x/y still translate the box; the caller derives the new size from them.
   */
  edges?: { x?: 'start' | 'end'; y?: 'start' | 'end' };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function lines(b: Box) {
  return {
    v: [b.x, b.x + b.width / 2, b.x + b.width],
    h: [b.y, b.y + b.height / 2, b.y + b.height],
  };
}

const edgeLines = (all: number[], edge?: 'start' | 'end') => edge === 'start' ? [all[0]] : edge === 'end' ? [all[2]] : all;

export function snapBox(
  moving: Box,
  others: Layer[],
  canvas: { width: number; height: number },
  threshold: number,
  options: SnapOptions = {},
): SnapResult {
  const { edges } = options;
  const snapX = !edges || edges.x !== undefined;
  const snapY = !edges || edges.y !== undefined;
  const allLines = lines(moving);
  const movingLines = { v: snapX ? edgeLines(allLines.v, edges?.x) : [], h: snapY ? edgeLines(allLines.h, edges?.y) : [] };

  const targetsV: { value: number; from: Box }[] = [];
  const targetsH: { value: number; from: Box }[] = [];

  const canvasBox: Box = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const cl = lines(canvasBox);
  cl.v.forEach((v) => targetsV.push({ value: v, from: canvasBox }));
  cl.h.forEach((v) => targetsH.push({ value: v, from: canvasBox }));

  const targets = others.filter(snapTarget);
  for (const layer of targets) {
    const ll = lines(layer);
    ll.v.forEach((v) => targetsV.push({ value: v, from: layer }));
    ll.h.forEach((v) => targetsH.push({ value: v, from: layer }));
  }

  let dx = 0;
  let dxBest = Infinity;
  let dxFrom: Box | null = null;
  let dxAxisMoving = 0;
  for (const t of targetsV) {
    for (const m of movingLines.v) {
      const d = t.value - m;
      if (Math.abs(d) < dxBest) {
        dxBest = Math.abs(d);
        dx = d;
        dxFrom = t.from;
        dxAxisMoving = m;
      }
    }
  }

  let dy = 0;
  let dyBest = Infinity;
  let dyFrom: Box | null = null;
  let dyAxisMoving = 0;
  for (const t of targetsH) {
    for (const m of movingLines.h) {
      const d = t.value - m;
      if (Math.abs(d) < dyBest) {
        dyBest = Math.abs(d);
        dy = d;
        dyFrom = t.from;
        dyAxisMoving = m;
      }
    }
  }

  // Equal spacing competes with alignment on each axis; the nearer snap wins, and alignment wins ties.
  const boxes = targets.map((layer) => clipToSlide(layer, canvas)).filter((b): b is Box => !!b);
  const movingCross = clipToSlide(moving, canvas);
  const spansX = snapX ? boxes.map((b) => toSpan(b, 'x')) : [], spansY = snapY ? boxes.map((b) => toSpan(b, 'y')) : [];
  const gapsX = slideGaps(spansX), gapsY = slideGaps(spansY);
  const gapX = snapX && movingCross ? bestGapSnap(toSpan(moving, 'x', movingCross), spansX, gapsX, edges?.x, threshold) : null;
  const gapY = snapY && movingCross ? bestGapSnap(toSpan(moving, 'y', movingCross), spansY, gapsY, edges?.y, threshold) : null;
  const alignX = dxBest <= threshold && !!dxFrom, alignY = dyBest <= threshold && !!dyFrom;
  const useGapX = !!gapX && (!alignX || Math.abs(gapX.delta) < dxBest - 1e-9);
  const useGapY = !!gapY && (!alignY || Math.abs(gapY.delta) < dyBest - 1e-9);
  const finalDx = useGapX ? gapX!.delta : alignX ? dx : 0;
  const finalDy = useGapY ? gapY!.delta : alignY ? dy : 0;
  // An alignment line is still shown when the equal-gap position happens to satisfy it too.
  const showX = alignX && Math.abs(dx - finalDx) < 1e-6;
  const showY = alignY && Math.abs(dy - finalDy) < 1e-6;

  const guides: SnapGuide[] = [];
  const outX = moving.x + finalDx;
  const outY = moving.y + finalDy;

  if (showX && dxFrom) {
    const snappedV = dxAxisMoving + dx;
    const start = Math.min(moving.y + finalDy, dxFrom.y);
    const end = Math.max(moving.y + finalDy + moving.height, dxFrom.y + dxFrom.height);
    guides.push({ orientation: 'v', position: snappedV, start, end });
  }
  if (showY && dyFrom) {
    const snappedH = dyAxisMoving + dy;
    const start = Math.min(outX, dyFrom.x);
    const end = Math.max(outX + moving.width, dyFrom.x + dyFrom.width);
    guides.push({ orientation: 'h', position: snappedH, start, end });
  }

  // Markers describe the final box, whichever snap produced it.
  const gaps: GapMarker[] = [];
  const settled = resizedBox(moving, finalDx, finalDy, edges);
  const settledCross = clipToSlide(settled, canvas);
  if (settledCross) {
    if (snapX) for (const g of equalGaps(toSpan(settled, 'x', settledCross), spansX, gapsX)) gaps.push({ axis: 'x', ...g });
    if (snapY) for (const g of equalGaps(toSpan(settled, 'y', settledCross), spansY, gapsY)) gaps.push({ axis: 'y', ...g });
  }

  return { x: outX, y: outY, guides, gaps };
}

// Locked layers cannot move, but remain useful alignment targets.
const snapTarget = (layer: Layer) => layer.visible && !(layer.rotation && layer.rotation % 360 !== 0);

/** The box after snapping: translated, or with only the resized edge moved. */
function resizedBox(b: Box, dx: number, dy: number, edges: SnapOptions['edges']): Box {
  const x = edges?.x === 'end' ? b.x : b.x + dx;
  const width = edges?.x === 'end' ? b.width + dx : edges?.x === 'start' ? b.width - dx : b.width;
  const y = edges?.y === 'end' ? b.y : b.y + dy;
  const height = edges?.y === 'end' ? b.height + dy : edges?.y === 'start' ? b.height - dy : b.height;
  return { x, y, width, height };
}

// ---- Equal spacing ---------------------------------------------------------------------------

/** Gaps within half a document pixel count as equal; anything under a pixel is touching, not a gap. */
const EQUAL_EPSILON = 0.5;
const MIN_GAP = 1;

/** A box seen along one axis: `a0..a1` along it, `c0..c1` across it. */
interface Span { a0: number; a1: number; c0: number; c1: number }
interface Gap { start: number; end: number; position: number; c0: number; c1: number }

/** Only the part of a box on the slide counts, so a layer over a seam is measured by its on-slide portion. */
function clipToSlide(b: Box, canvas: { width: number; height: number }): Box | null {
  const x0 = Math.max(0, b.x), x1 = Math.min(canvas.width, b.x + b.width);
  const y0 = Math.max(0, b.y), y1 = Math.min(canvas.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** `cross` supplies the across-axis extent, which for the moving box is its on-slide part. */
function toSpan(b: Box, axis: 'x' | 'y', cross: Box = b): Span {
  return axis === 'x'
    ? { a0: b.x, a1: b.x + b.width, c0: cross.y, c1: cross.y + cross.height }
    : { a0: b.y, a1: b.y + b.height, c0: cross.x, c1: cross.x + cross.width };
}

const crossOverlap = (a: { c0: number; c1: number }, b: { c0: number; c1: number }) => Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0);

/** Gaps between neighbouring boxes: they overlap across the axis and nothing sits between them. */
function slideGaps(spans: Span[]): Gap[] {
  const gaps: Gap[] = [];
  for (const a of spans) {
    for (const b of spans) {
      if (a === b || b.a0 - a.a1 < MIN_GAP) continue;
      const c0 = Math.max(a.c0, b.c0), c1 = Math.min(a.c1, b.c1);
      if (c1 <= c0) continue;
      if (spans.some((c) => c !== a && c !== b && c.a1 > a.a1 && c.a0 < b.a0 && c.c1 > c0 && c.c0 < c1)) continue;
      gaps.push({ start: a.a1, end: b.a0, position: (c0 + c1) / 2, c0, c1 });
    }
  }
  return gaps;
}

/** The moving box's own gaps to its nearest neighbours before and after it on this axis. */
function ownGaps(m: Span, spans: Span[]): Gap[] {
  let before: Span | null = null, after: Span | null = null;
  for (const s of spans) {
    if (crossOverlap(s, m) <= 0) continue;
    if (s.a1 <= m.a0 + EQUAL_EPSILON && (!before || s.a1 > before.a1)) before = s;
    if (s.a0 >= m.a1 - EQUAL_EPSILON && (!after || s.a0 < after.a0)) after = s;
  }
  const gap = (lo: number, hi: number, s: Span): Gap => {
    const c0 = Math.max(s.c0, m.c0), c1 = Math.min(s.c1, m.c1);
    return { start: lo, end: hi, position: (c0 + c1) / 2, c0, c1 };
  };
  const own: Gap[] = [];
  if (before && m.a0 - before.a1 >= MIN_GAP) own.push(gap(before.a1, m.a0, before));
  if (after && after.a0 - m.a1 >= MIN_GAP) own.push(gap(m.a1, after.a0, after));
  return own;
}

const size = (g: Gap) => g.end - g.start;

/** The moving box's gaps that equal another gap, plus every gap they equal. Empty when nothing matches. */
function equalGaps(m: Span, spans: Span[], slide: Gap[]): Omit<GapMarker, 'axis'>[] {
  const own = ownGaps(m, spans);
  if (!own.length) return [];
  // A gap the moving box now sits inside no longer exists on the slide.
  const existing = slide.filter((g) => !(m.a1 > g.start && m.a0 < g.end && m.c1 > g.c0 && m.c0 < g.c1));
  const out = new Set<Gap>();
  for (const o of own) {
    const same = [...own, ...existing].filter((g) => g !== o && Math.abs(size(g) - size(o)) <= EQUAL_EPSILON);
    if (!same.length) continue;
    out.add(o);
    same.forEach((g) => out.add(g));
  }
  return [...out].map(({ start, end, position }) => ({ start, end, position }));
}

/**
 * The smallest move (within threshold) that makes one of the moving box's gaps equal another
 * gap on the slide, including centring it between two neighbours. `edge` limits the move to one
 * side while resizing.
 */
function bestGapSnap(m: Span, spans: Span[], slide: Gap[], edge: 'start' | 'end' | undefined, threshold: number): { delta: number } | null {
  const neighbours = spans.filter((s) => crossOverlap(s, m) > 0);
  if (!neighbours.length) return null;
  const sizes = slide.map(size);
  // While resizing, the side that stays put offers its own gap to match on the other side.
  if (edge) sizes.push(...ownGaps(m, spans).filter((g) => edge === 'end' ? g.end <= m.a0 + EQUAL_EPSILON : g.start >= m.a1 - EQUAL_EPSILON).map(size));
  const values = [...new Set(sizes)];
  const deltas: number[] = [];
  for (const n of neighbours) {
    for (const g of values) {
      if (edge !== 'end') deltas.push(n.a1 + g - m.a0); // the gap after `n` equals g
      if (edge !== 'start') deltas.push(n.a0 - g - m.a1); // the gap before `n` equals g
    }
    if (edge) continue;
    // Centred between n and a neighbour after it: both gaps become equal.
    for (const r of neighbours) if (r.a0 - n.a1 - (m.a1 - m.a0) >= 2 * MIN_GAP) deltas.push((n.a1 + r.a0 - (m.a1 - m.a0)) / 2 - m.a0);
  }
  // Nearest first; a candidate counts only if the moved box really has an equal gap there.
  for (const d of deltas.filter((d) => Math.abs(d) <= threshold).sort((a, b) => Math.abs(a) - Math.abs(b))) {
    const moved = edge === 'end' ? { ...m, a1: m.a1 + d } : edge === 'start' ? { ...m, a0: m.a0 + d } : { ...m, a0: m.a0 + d, a1: m.a1 + d };
    if (moved.a1 - moved.a0 > 0 && equalGaps(moved, spans, slide).length) return { delta: d };
  }
  return null;
}
