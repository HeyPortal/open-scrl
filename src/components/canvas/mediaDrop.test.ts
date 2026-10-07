import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetMeta, ImageLayer, ShapeLayer } from '@/types';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { addPhotosAt, describeFill, dragCarriesAsset, dragCarriesFiles, locateDrop, readDroppedAssetId, readDroppedFiles } from './mediaDrop';

const store = () => useDocumentStore.getState();
const frame = (id: string, patch: Partial<ImageLayer> = {}): ImageLayer => ({ id, kind: 'image', name: id, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, assetId: null, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1, ...patch });
const text = (id: string): ShapeLayer => ({ id, kind: 'shape', name: id, x: 0, y: 0, width: 400, height: 400, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#000', stroke: '#fff', strokeWidth: 0, cornerRadius: 0 });
const asset = (id: string, width = 400, height = 200): AssetMeta => ({ id, name: id, mime: 'image/jpeg', width, height } as AssetMeta);

let slides: string[];
function seed(layers: Array<[number, ImageLayer | ShapeLayer]>, slideCount = 2) {
  const doc = newDocument({ name: 'Test', width: 400, height: 400 });
  for (let i = 1; i < slideCount; i++) {
    const copy = newDocument({ name: 'x', width: 400, height: 400 });
    doc.slides[copy.slideOrder[0]] = copy.slides[copy.slideOrder[0]]; doc.slideOrder.push(copy.slideOrder[0]);
  }
  slides = doc.slideOrder;
  for (const [index, layer] of layers) { doc.layers[layer.id] = layer; doc.slides[slides[index]].layerOrder.push(layer.id); }
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  store().selectSlide(slides[0]);
  return doc;
}

describe('locateDrop', () => {
  it('finds the topmost visible image frame, including locked ones, and ignores non-image layers above it', () => {
    const doc = seed([[0, frame('under', { locked: true })], [0, frame('over', { x: 50, y: 50 })], [0, text('overlay')]]);
    expect(locateDrop(doc, { x: 60, y: 60 })?.frame?.id).toBe('over');
    expect(locateDrop(doc, { x: 20, y: 20 })?.frame?.id).toBe('under');
  });
  it('skips hidden frames and reports the slide point when no frame is hit', () => {
    const doc = seed([[1, frame('hidden', { visible: false })]]);
    expect(locateDrop(doc, { x: 450, y: 20 })).toEqual({ slideId: slides[1], point: { x: 50, y: 20 }, frame: null });
  });
  it('honors rotation', () => {
    const doc = seed([[0, frame('r', { x: 100, y: 150, width: 200, height: 100, rotation: 90 })]]);
    // Rotated a quarter turn it is tall and narrow around (200, 200).
    expect(locateDrop(doc, { x: 200, y: 120 })?.frame?.id).toBe('r');
    expect(locateDrop(doc, { x: 110, y: 200 })?.frame).toBeNull();
  });
  it('hits a frame that overhangs into the next slide and reports its owning slide', () => {
    const doc = seed([[0, frame('pano', { x: 0, width: 800, height: 400 })]]);
    const hit = locateDrop(doc, { x: 600, y: 100 });
    expect(hit).toMatchObject({ slideId: slides[0], point: { x: 600, y: 100 } });
    expect(hit?.frame?.id).toBe('pano');
  });
  it('rejects points off the strip', () => {
    const doc = seed([]);
    for (const point of [{ x: -1, y: 10 }, { x: 800, y: 10 }, { x: 10, y: 401 }, { x: 10, y: -5 }, { x: NaN, y: 0 }]) expect(locateDrop(doc, point)).toBeNull();
  });
});

describe('drag payloads', () => {
  it('detects asset and file drags from the type list only', () => {
    expect(dragCarriesAsset({ types: ['application/x-osc-asset'] })).toBe(true);
    expect(dragCarriesAsset({ types: ['Files'] })).toBe(false);
    expect(dragCarriesFiles({ types: ['Files'] })).toBe(true);
    expect(dragCarriesFiles(null)).toBe(false);
  });
  it('treats missing, blank, oversized or throwing payloads as no asset', () => {
    expect(readDroppedAssetId({ getData: () => ' abc ' })).toBe('abc');
    expect(readDroppedAssetId({ getData: () => '' })).toBeNull();
    expect(readDroppedAssetId({ getData: () => 'x'.repeat(500) })).toBeNull();
    expect(readDroppedAssetId({ getData: () => { throw new Error('protected'); } })).toBeNull();
    expect(readDroppedAssetId({ getData: () => undefined as unknown as string })).toBeNull();
    expect(readDroppedAssetId(null)).toBeNull();
  });
  it('keeps only media files', () => {
    const files = [new File([''], 'a.jpg', { type: 'image/jpeg' }), new File([''], 'notes.txt', { type: 'text/plain' })];
    expect(readDroppedFiles({ files } as unknown as DataTransfer).map((f) => f.name)).toEqual(['a.jpg']);
  });
});

describe('addPhotosAt', () => {
  beforeEach(() => seed([]));
  it('adds centered on the point, clamped to the slide, as one undo step', () => {
    const original = store().doc;
    const ids = addPhotosAt(slides[1], { x: 390, y: 10 }, [asset('a'), asset('b')]);
    expect(ids).toHaveLength(2);
    expect(store().past).toHaveLength(1);
    const [a, b] = ids.map((id) => store().doc.layers[id]);
    expect(a.x + a.width).toBeLessThanOrEqual(400); expect(a.y).toBe(0);
    expect(b.x).toBeLessThanOrEqual(400 - b.width);
    expect(store().doc.slides[slides[1]].layerOrder).toEqual(ids);
    expect(useEditorSession.getState()).toMatchObject({ selectedSlideId: slides[1], selectedLayerIds: ids });
    store().undo();
    expect(store().doc.layers).toEqual(original.layers);
  });
  it('does nothing for an unknown slide, no assets, or a read-only project', () => {
    expect(addPhotosAt('nope', { x: 0, y: 0 }, [asset('a')])).toEqual([]);
    expect(addPhotosAt(slides[0], { x: 0, y: 0 }, [])).toEqual([]);
    useDocumentStore.setState({ readOnlyError: 'read only' });
    expect(addPhotosAt(slides[0], { x: 0, y: 0 }, [asset('a')])).toEqual([]);
    expect(store().past).toHaveLength(0);
  });
});

describe('describeFill', () => {
  it('reports placed and leftover counts', () => {
    expect(describeFill(1, 1)).toBe('Placed 1 item.');
    expect(describeFill(2, 5)).toContain('3 items didn’t fit');
    expect(describeFill(0, 2)).toMatch(/Could not/);
  });
});
