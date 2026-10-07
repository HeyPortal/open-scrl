import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer, Layer } from '@/types';
import { canShufflePhotoFrames, shuffledPhotoIds } from '@/core/document/photos';
import { newDocument, useDocumentStore } from './documentStore';

const store = () => useDocumentStore.getState();
const photo = (id: string, assetId: string | null, patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id, kind: 'image', name: id, x: 12, y: 28, width: 160, height: 90, rotation: 15,
  opacity: 0.8, visible: true, locked: true, assetId, cornerRadius: 11,
  cropOffsetX: 19, cropOffsetY: -7, cropScale: 2, mask: 'arch', stroke: '#f00', strokeWidth: 3,
  shadow: { color: '#000', opacity: 0.4, blur: 7, offsetX: 4, offsetY: 6 }, ...patch,
});
let slideId: string;
function seed(layers: Layer[], other: Layer[] = []) {
  const doc = newDocument({ name: 'Test', width: 400, height: 400 });
  slideId = doc.slideOrder[0];
  doc.layers = Object.fromEntries([...layers, ...other].map((layer) => [layer.id, layer]));
  doc.slides[slideId].layerOrder = layers.map((layer) => layer.id);
  if (other.length) {
    doc.slideOrder.push('other');
    doc.slides.other = { id: 'other', background: { kind: 'solid', color: '#fff' }, layerOrder: other.map((layer) => layer.id) };
  }
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  store().selectSlide(slideId);
}
const assigned = (layer: ImageLayer, assetId: string | null) => ({ ...layer, assetId, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 });
const assertUndo = (original: ReturnType<typeof store>['doc']) => {
  expect(store().past).toHaveLength(1);
  const changed = store().doc;
  store().undo();
  expect(store().doc.layers).toEqual(original.layers);
  expect(store().doc.slides).toEqual(original.slides);
  store().redo();
  expect(store().doc.layers).toEqual(changed.layers);
};
beforeEach(() => seed([]));
afterEach(() => vi.restoreAllMocks());

describe('photo frame assignment', () => {
  it('replaces a locked photo without changing its frame or styling, and restores its old crop on undo', () => {
    const frame = photo('frame', 'old'); seed([frame]);
    const before = store().doc;
    expect(store().assignPhoto('frame', 'new')).toBe(true);
    expect(store().doc.layers.frame).toEqual(assigned(frame, 'new'));
    assertUndo(before);
  });

  it('keeps rapid replacements as separate undo steps', () => {
    seed([photo('frame', 'old')]);
    store().assignPhoto('frame', 'new'); store().assignPhoto('frame', 'next');
    expect(store().past).toHaveLength(2);
    store().undo(); expect(store().doc.layers.frame).toMatchObject({ assetId: 'new' });
    store().undo(); expect(store().doc.layers.frame).toMatchObject({ assetId: 'old', cropScale: 2 });
  });

  it('fills empty visible frames on the target slide in stored order, without stacking leftovers', () => {
    const target = photo('target', 'old'), empty = photo('empty', null, { locked: false });
    const hidden = photo('hidden', null, { visible: false }), occupied = photo('occupied', 'keep');
    seed([empty, hidden, occupied, target], [photo('other-frame', null)]);
    store().selectSlide('other');
    const before = store().doc;
    expect(store().assignPhotos('target', ['a', 'b', 'leftover'])).toBe(2);
    expect(store().doc.layers.target).toEqual(assigned(target, 'a'));
    expect(store().doc.layers.empty).toEqual(assigned(empty, 'b'));
    expect(store().doc.layers.hidden).toEqual(hidden);
    expect(store().doc.layers.occupied).toEqual(occupied);
    expect(store().doc.layers['other-frame']).toEqual(before.layers['other-frame']);
    expect(Object.keys(store().doc.layers)).toHaveLength(5);
    assertUndo(before);
  });
});

describe('shuffle photos', () => {
  it('changes the arrangement, preserving repeated photos and every frame while leaving empty/hidden/other slides alone', () => {
    const frames = [photo('a', 'one'), photo('b', 'one', { locked: false }), photo('c', 'two', { groupId: 'regular-group' })];
    const empty = photo('empty', null), hidden = photo('hidden', 'hidden', { visible: false });
    seed([...frames, empty, hidden], [photo('other-frame', 'elsewhere')]);
    const before = store().doc;
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // Repeated identity permutations exercise the bounded fallback.
    expect(canShufflePhotoFrames(before, slideId)).toBe(true);
    expect(store().shufflePhotos()).toBe(true);
    const ids = frames.map((frame) => (store().doc.layers[frame.id] as ImageLayer).assetId);
    expect(ids).not.toEqual(frames.map((frame) => frame.assetId));
    expect([...ids].sort()).toEqual(['one', 'one', 'two']);
    frames.forEach((frame, index) => expect(store().doc.layers[frame.id]).toEqual(assigned(frame, ids[index])));
    expect(store().doc.layers.empty).toEqual(empty); expect(store().doc.layers.hidden).toEqual(hidden);
    expect(store().doc.layers['other-frame']).toEqual(before.layers['other-frame']);
    assertUndo(before);
  });

  it('does not change the document or crops when all filled frames show the same photo', () => {
    seed([photo('a', 'same'), photo('b', 'same'), photo('empty', null)]);
    const before = store().doc;
    expect(canShufflePhotoFrames(before, slideId)).toBe(false);
    expect(store().shufflePhotos()).toBe(false);
    expect(store().doc).toBe(before); expect(store().past).toHaveLength(0);
    expect(shuffledPhotoIds([])).toBeNull();
  });

  it('records every shuffle independently so undo walks back through each arrangement', () => {
    seed([photo('a', 'one'), photo('b', 'two')]);
    const before = store().doc;
    store().shufflePhotos(); const first = store().doc;
    store().shufflePhotos();
    expect(store().past).toHaveLength(2);
    store().undo(); expect(store().doc.layers).toEqual(first.layers);
    store().undo(); expect(store().doc.layers).toEqual(before.layers);
  });
});

describe('swap and move photos', () => {
  it('swaps locked and grouped photos without moving their frames, styles or group membership', () => {
    const a = photo('a', 'one', { groupId: 'g' }), b = photo('b', 'two', { locked: false, width: 70, rotation: -30 });
    seed([a, b]); const before = store().doc;
    expect(store().swapPhotos('a', 'b')).toBe(true);
    expect(store().doc.layers.a).toEqual(assigned(a, 'two'));
    expect(store().doc.layers.b).toEqual(assigned(b, 'one'));
    assertUndo(before);
  });

  it('moves a photo into an empty frame on another slide in a single undo step', () => {
    const source = photo('source', 'one'), target = photo('target', null);
    seed([source], [target]); const before = store().doc;
    expect(store().swapPhotos('source', 'target')).toBe(true);
    expect(store().doc.layers.source).toEqual(assigned(source, null));
    expect(store().doc.layers.target).toEqual(assigned(target, 'one'));
    expect(store().selectedSlideId).toBe(slideId);
    assertUndo(before);
  });

  it('rejects invalid, identical or invisible targets without adding history', () => {
    seed([photo('a', 'one'), photo('same', 'one'), photo('hidden', 'two', { visible: false }), photo('empty', null), photo('empty2', null)]);
    for (const [source, target] of [['a', 'a'], ['a', 'same'], ['a', 'hidden'], ['a', 'missing'], ['empty', 'empty2']]) {
      expect(store().swapPhotos(source, target)).toBe(false);
    }
    expect(store().past).toHaveLength(0);
  });

  it('honors the document read-only state for every photo operation', () => {
    seed([photo('a', 'one'), photo('b', 'two')]);
    useDocumentStore.setState({ readOnlyError: 'Unsupported project' });
    expect(store().assignPhoto('a', 'new')).toBe(false);
    expect(store().assignPhotos('a', ['new'])).toBe(0);
    expect(store().shufflePhotos()).toBe(false);
    expect(store().swapPhotos('a', 'b')).toBe(false);
    expect(store().past).toHaveLength(0);
  });
});
