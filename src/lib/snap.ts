import type { Layer } from '@/types';

export interface SnapGuide {
  orientation: 'v' | 'h';
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
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

export function snapBox(
  moving: Box,
  others: Layer[],
  canvas: { width: number; height: number },
  threshold: number,
): SnapResult {
  const movingLines = lines(moving);

  const targetsV: { value: number; from: Box }[] = [];
  const targetsH: { value: number; from: Box }[] = [];

  const canvasBox: Box = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const cl = lines(canvasBox);
  cl.v.forEach((v) => targetsV.push({ value: v, from: canvasBox }));
  cl.h.forEach((v) => targetsH.push({ value: v, from: canvasBox }));

  for (const layer of others) {
    if (!layer.visible || layer.locked) continue;
    if (layer.rotation && layer.rotation % 360 !== 0) continue;
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

  const guides: SnapGuide[] = [];
  let outX = moving.x;
  let outY = moving.y;

  if (dxBest <= threshold && dxFrom) {
    outX = moving.x + dx;
    const snappedV = dxAxisMoving + dx;
    const start = Math.min(moving.y + dy * (dyBest <= threshold ? 1 : 0), dxFrom.y);
    const end = Math.max(
      moving.y + (dyBest <= threshold ? dy : 0) + moving.height,
      dxFrom.y + dxFrom.height,
    );
    guides.push({ orientation: 'v', position: snappedV, start, end });
  }
  if (dyBest <= threshold && dyFrom) {
    outY = moving.y + dy;
    const snappedH = dyAxisMoving + dy;
    const start = Math.min(outX, dyFrom.x);
    const end = Math.max(outX + moving.width, dyFrom.x + dyFrom.width);
    guides.push({ orientation: 'h', position: snappedH, start, end });
  }

  return { x: outX, y: outY, guides };
}
