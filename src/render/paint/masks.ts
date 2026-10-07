import type { ImageMask } from '@/types';

/** The path-building subset shared by `CanvasRenderingContext2D` and `Path2D`. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
}

export const IMAGE_MASKS: { id: ImageMask; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'arch', label: 'Arch' },
  { id: 'blob', label: 'Blob' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'star', label: 'Star' },
  { id: 'heart', label: 'Heart' },
];

/** Masks whose corners `cornerRadius` rounds. */
export const maskUsesCornerRadius = (mask: ImageMask | undefined) => !mask || mask === 'rect' || mask === 'hexagon' || mask === 'star';

// Cubic Bézier circle constant. The Mac renderer uses the same geometry so masks match exactly.
const K = 0.5522847498;

type Point = readonly [number, number];

/** A closed polygon with every corner rounded by `radius` (clamped to half the shorter edge). */
function roundedPolygon(sink: PathSink, points: Point[], radius: number) {
  const n = points.length;
  if (radius <= 0) {
    sink.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < n; i++) sink.lineTo(points[i][0], points[i][1]);
    sink.closePath();
    return;
  }
  const edge = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  let shortest = Infinity;
  for (let i = 0; i < n; i++) shortest = Math.min(shortest, edge(points[i], points[(i + 1) % n]));
  const r = Math.min(radius, shortest / 2);
  const last = points[n - 1], first = points[0];
  sink.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const corner = points[i], next = points[(i + 1) % n];
    sink.arcTo(corner[0], corner[1], next[0], next[1], r);
  }
  sink.closePath();
}

function ellipse(sink: PathSink, cx: number, cy: number, rx: number, ry: number) {
  sink.moveTo(cx + rx, cy);
  sink.bezierCurveTo(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry);
  sink.bezierCurveTo(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy);
  sink.bezierCurveTo(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry);
  sink.bezierCurveTo(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy);
  sink.closePath();
}

// A hand-tuned organic outline, as a closed Catmull–Rom spline through points in a unit box.
const BLOB: Point[] = [
  [0.52, 0.03], [0.83, 0.1], [0.98, 0.42], [0.9, 0.78], [0.6, 0.97], [0.24, 0.9], [0.03, 0.62], [0.12, 0.2],
];

function blob(sink: PathSink, w: number, h: number) {
  const p = (i: number): Point => {
    const q = BLOB[(i + BLOB.length) % BLOB.length];
    return [q[0] * w, q[1] * h];
  };
  sink.moveTo(...p(0));
  for (let i = 0; i < BLOB.length; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    sink.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
  sink.closePath();
}

function star(sink: PathSink, w: number, h: number, radius: number) {
  // A five-pointed star stretched so its points touch every edge of the box.
  const top = 1, bottom = Math.cos(Math.PI / 5), side = Math.sin((2 * Math.PI) / 5);
  const inner = 0.5;
  const points: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 1 : inner;
    const x = r * Math.cos(angle), y = r * Math.sin(angle);
    points.push([((x + side) / (2 * side)) * w, ((y + top) / (top + bottom)) * h]);
  }
  roundedPolygon(sink, points, radius);
}

function heart(sink: PathSink, w: number, h: number) {
  const P = (x: number, y: number): Point => [x * w, y * h];
  sink.moveTo(...P(0.5, 0.24));
  sink.bezierCurveTo(...P(0.5, 0.05), ...P(0.3, -0.02), ...P(0.14, 0.04));
  sink.bezierCurveTo(...P(-0.02, 0.1), ...P(-0.03, 0.38), ...P(0.1, 0.55));
  sink.bezierCurveTo(...P(0.22, 0.72), ...P(0.4, 0.84), ...P(0.5, 1));
  sink.bezierCurveTo(...P(0.6, 0.84), ...P(0.78, 0.72), ...P(0.9, 0.55));
  sink.bezierCurveTo(...P(1.03, 0.38), ...P(1.02, 0.1), ...P(0.86, 0.04));
  sink.bezierCurveTo(...P(0.7, -0.02), ...P(0.5, 0.05), ...P(0.5, 0.24));
  sink.closePath();
}

/** Traces the outline of `mask` filling a `w`×`h` box whose top-left is the origin. */
export function traceMask(sink: PathSink, mask: ImageMask | undefined, w: number, h: number, cornerRadius = 0) {
  switch (mask ?? 'rect') {
    case 'ellipse':
      ellipse(sink, w / 2, h / 2, w / 2, h / 2);
      return;
    case 'arch': {
      // Straight sides and bottom, with a half-ellipse on top.
      const rx = w / 2, ry = Math.min(w / 2, h);
      sink.moveTo(0, h);
      sink.lineTo(0, ry);
      sink.bezierCurveTo(0, ry - ry * K, rx - rx * K, 0, rx, 0);
      sink.bezierCurveTo(rx + rx * K, 0, w, ry - ry * K, w, ry);
      sink.lineTo(w, h);
      sink.closePath();
      return;
    }
    case 'blob':
      blob(sink, w, h);
      return;
    case 'hexagon':
      roundedPolygon(sink, [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]], cornerRadius);
      return;
    case 'star':
      star(sink, w, h, cornerRadius);
      return;
    case 'heart':
      heart(sink, w, h);
      return;
    case 'rect':
    default:
      roundedPolygon(sink, [[0, 0], [w, 0], [w, h], [0, h]], Math.max(0, Math.min(cornerRadius, w / 2, h / 2)));
  }
}

export function maskPath(mask: ImageMask | undefined, w: number, h: number, cornerRadius = 0) {
  const path = new Path2D();
  traceMask(path, mask, w, h, cornerRadius);
  return path;
}
