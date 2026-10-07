import { describe, expect, it } from 'vitest';
import type { ImageLayer, ShapeLayer, TextLayer } from '@/types';
import { rotatedBounds, scaleLayer, slideSpanFor, unionBounds } from './geometry';

const shape: ShapeLayer = { id: 'shape', kind: 'shape', name: 'Shape', x: 10, y: 20, width: 100, height: 50, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#000', stroke: '#fff', strokeWidth: 2, cornerRadius: 3 };
const from = { x: 0, y: 10, width: 200, height: 100 };
const to = { x: 20, y: 30, width: 800, height: 100 };

describe('rotatedBounds', () => {
  it('keeps unrotated bounds', () => expect(rotatedBounds(shape)).toEqual({ x: 10, y: 20, width: 100, height: 50 }));
  it('rotates around the center at a quarter turn', () => {
    const b = rotatedBounds({ ...shape, rotation: 90 });
    expect(b.x).toBeCloseTo(35); expect(b.y).toBeCloseTo(-5);
    expect(b.width).toBeCloseTo(50); expect(b.height).toBeCloseTo(100);
  });
  it('handles clockwise and counterclockwise oblique rotations', () => {
    const b = rotatedBounds({ ...shape, rotation: 45 });
    expect(b.width).toBeCloseTo(150 / Math.sqrt(2));
    expect(b.height).toBeCloseTo(150 / Math.sqrt(2));
    expect(b.x + b.width / 2).toBeCloseTo(60);
    expect(b.y + b.height / 2).toBeCloseTo(45);
    expect(rotatedBounds({ ...shape, rotation: -45 })).toEqual(b);
  });
});

describe('unionBounds', () => {
  it('returns null for an empty input', () => expect(unionBounds([])).toBeNull());
  it('unites disjoint bounds with negative coordinates', () => expect(unionBounds([{ x: -20, y: 10, width: 10, height: 30 }, { x: 10, y: -10, width: 40, height: 20 }])).toEqual({ x: -20, y: -10, width: 70, height: 50 }));
  it('includes zero-sized bounds', () => expect(unionBounds([{ x: 4, y: 5, width: 0, height: 0 }])).toEqual({ x: 4, y: 5, width: 0, height: 0 }));
});

describe('slideSpanFor', () => {
  it.each([[2.3999, 1], [2.4, 2], [2.49, 2], [2.5, 3], [3.5, 4], [25, 20], [0.5, 1]])('uses the Mac threshold and rounding for k=%s', (k, expected) => {
    expect(slideSpanFor({ width: k * 200, height: 100 }, { width: 200, height: 100 })).toBe(expected);
  });
  it('accounts for portrait formats', () => expect(slideSpanFor({ width: 120, height: 100 }, { width: 100, height: 200 })).toBe(2));
});

describe('scaleLayer', () => {
  it('maps position and dimensions independently and scales shape lengths geometrically', () => {
    const result = scaleLayer({ ...shape, rotation: 30 }, from, to);
    expect(result).toMatchObject({ x: 60, y: 40, width: 400, height: 50, rotation: 30, strokeWidth: 4, cornerRadius: 6 });
    expect(shape.strokeWidth).toBe(2);
    expect(result).not.toBe(shape);
  });
  it('scales image border, radius, and shadow without changing crop', () => {
    const image: ImageLayer = { ...shape, kind: 'image', assetId: 'photo', cropOffsetX: 12, cropOffsetY: 34, cropScale: 1.5, mask: 'arch', shadow: { color: '#000', opacity: 0.5, blur: 4, offsetX: -5, offsetY: 6 } };
    expect(scaleLayer(image, from, to)).toMatchObject({ cornerRadius: 6, strokeWidth: 4, cropOffsetX: 12, cropOffsetY: 34, cropScale: 1.5, mask: 'arch', shadow: { color: '#000', opacity: 0.5, blur: 8, offsetX: -10, offsetY: 12 } });
    expect(image.shadow?.blur).toBe(4);
  });
  it('scales text lengths while preserving dimensionless styles and gradients', () => {
    const text: TextLayer = { ...shape, kind: 'text', text: 'Hello', fontFamily: 'Inter', fontSize: 20, fontWeight: 700, italic: false, align: 'center', letterSpacing: -2, lineHeight: 1.2, highlight: { style: 'box', color: '#fff', padding: 3, radius: 4 }, fillGradient: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }, autoFit: true };
    const result = scaleLayer(text, from, to);
    expect(result).toMatchObject({ fontSize: 40, letterSpacing: -4, strokeWidth: 4, lineHeight: 1.2, fontWeight: 700, autoFit: true, highlight: { padding: 6, radius: 8 } });
    expect(result.fillGradient).toEqual(text.fillGradient);
    expect(text.highlight?.padding).toBe(3);
  });
  it('preserves absent and null optional styles', () => {
    const image: ImageLayer = { ...shape, kind: 'image', assetId: null, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1, strokeWidth: undefined, shadow: null };
    expect(scaleLayer(image, from, to).strokeWidth).toBeUndefined();
    expect(scaleLayer(image, from, to).shadow).toBeNull();
  });
  it('uses absolute geometric scale for a reflected target', () => expect(scaleLayer(shape, from, { ...to, width: -800 })).toMatchObject({ width: -400, strokeWidth: 4 }));
  it('keeps degenerate source axes finite', () => expect(scaleLayer(shape, { ...from, width: 0 }, to)).toMatchObject({ x: 30, width: 100, strokeWidth: 2 }));
});
