import { describe, expect, it } from 'vitest';
import type { TextLayer } from '@/types';
import { resizeTextLayer } from './textResize';

const base: TextLayer = { id: 't', kind: 'text', name: 'Text', x: 100, y: 150, width: 400, height: 60, rotation: 0, opacity: 1, visible: true, locked: false, text: 'GO KNIGHTS', fontFamily: 'Inter', fontSize: 50, fontWeight: 700, italic: false, fill: '#000000', align: 'left', letterSpacing: 0, lineHeight: 1.2 };
const snap = { others: [], canvas: { width: 640, height: 640 }, threshold: 6 };
const measure = (layer: TextLayer) => layer.width < 300 ? 120 : 60;
const corner = (layer: TextLayer, right = false) => {
  const angle = layer.rotation * Math.PI / 180;
  const x = (right ? 1 : -1) * layer.width / 2, y = -layer.height / 2;
  return { x: layer.x + layer.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: layer.y + layer.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
};

describe('text resizing', () => {
  for (const rotation of [0, 37, 90]) for (const side of ['left', 'right']) {
    it(`preserves the opposite top corner and font size at ${rotation} degrees from ${side}`, () => {
      const layer = { ...base, rotation };
      const resized = resizeTextLayer(layer, { x: side === 'left' ? 200 : -200, y: 87 }, `middle-${side}`, false, snap, measure).layer;
      const fixed = corner(layer, side === 'left'), actual = corner(resized, side === 'left');
      expect(actual.x).toBeCloseTo(fixed.x, 8); expect(actual.y).toBeCloseTo(fixed.y, 8);
      expect(resized.width).toBe(200); expect(resized.height).toBe(120);
      expect(resized.fontSize).toBe(base.fontSize);
    });
  }

  it('snaps only the moving edge, keeping the fixed edge and top in place', () => {
    const result = resizeTextLayer({ ...base, width: 530 }, { x: 7, y: 4 }, 'middle-right', false, snap, measure);
    expect(result.layer.x).toBe(100); expect(result.layer.y).toBe(150); expect(result.layer.width).toBe(540);
    expect(result.guides.map((g) => [g.orientation, g.position])).toEqual([['v', 640]]);
  });

  it('clamps at the minimum width without crossing the fixed edge', () => {
    const layer = resizeTextLayer(base, { x: 800, y: 0 }, 'middle-left', false, snap, measure).layer;
    expect(layer.width).toBe(8); expect(layer.x + layer.width).toBe(base.x + base.width);
  });

  it('keeps the center fixed when resizing from the center, including reflow', () => {
    const layer = resizeTextLayer({ ...base, rotation: 37 }, { x: -100, y: 0 }, 'middle-right', true, snap, measure).layer;
    expect(layer.x + layer.width / 2).toBe(base.x + base.width / 2);
    expect(layer.y + layer.height / 2).toBe(base.y + base.height / 2);
    expect(layer.height).toBe(120);
  });

  it('resizes a shrink-to-fit box on both axes without changing its maximum font size', () => {
    const layer = resizeTextLayer({ ...base, autoFit: true }, { x: -200, y: 50 }, 'bottom-right', false, snap, () => { throw new Error('Must keep the explicit height'); }).layer;
    expect(layer.width).toBe(200); expect(layer.height).toBe(110); expect(layer.fontSize).toBe(base.fontSize);
  });
});
