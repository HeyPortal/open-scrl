import { describe, expect, it } from 'vitest';
import { newDocument } from '@/editor/documentStore';
import type { ShapeLayer } from '@/types';
import { compileScene } from './compileScene';

const shape = (id: string, x: number): ShapeLayer => ({
  id, kind: 'shape', name: id, x, y: 0, width: 50, height: 20,
  rotation: 0, opacity: 1, visible: true, locked: false,
  shape: 'rect', fill: '#000', stroke: '#000', strokeWidth: 0, cornerRadius: 0,
});

describe('scene compilation', () => {
  it('preserves stacking and spanning layers when filtering and reordering slides', () => {
    const doc = newDocument({ name: 'Square', width: 100, height: 100 });
    doc.slideOrder = ['a', 'b'];
    doc.slides = {
      a: { id: 'a', background: { kind: 'solid', color: '#fff' }, layerOrder: ['back', 'hidden', 'missing'] },
      b: { id: 'b', background: { kind: 'solid', color: '#fff' }, layerOrder: ['span', 'outside'] },
    };
    doc.layers = { back: shape('back', 0), hidden: { ...shape('hidden', 0), visible: false }, span: shape('span', -20), outside: shape('outside', 50) };
    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    expect(compileScene(doc, viewport).map(({ id, slideId, bounds }) => [id, slideId, bounds.x])).toEqual([
      ['back', 'a', 0], ['span', 'b', 80],
    ]);
    doc.slideOrder.reverse();
    expect(compileScene(doc, viewport).map(({ id, bounds }) => [id, bounds.x])).toEqual([
      ['span', -20], ['outside', 50],
    ]);
  });
});
