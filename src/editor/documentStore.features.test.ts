import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { command } from '@/core/document/commands';
import type { ShapeLayer } from '@/types';
import { newDocument, useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';

const store = () => useDocumentStore.getState();
const shape = (id: string, patch: Partial<ShapeLayer> = {}): ShapeLayer => ({ id, kind: 'shape', name: id, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#000', stroke: '#fff', strokeWidth: 2, cornerRadius: 4, ...patch });
let sid: string;
function seed(layers: ShapeLayer[]) {
  const doc = newDocument({ name: 'Test', width: 100, height: 100 }); sid = doc.slideOrder[0];
  doc.layers = Object.fromEntries(layers.map((layer) => [layer.id, layer]));
  doc.slides[sid].layerOrder = layers.map((layer) => layer.id);
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  store().selectSlide(sid);
}
const order = () => store().doc.slides[sid].layerOrder;
const xs = (ids: string[]) => ids.map((id) => store().doc.layers[id].x);
const assertUndo = (original: ReturnType<typeof store>['doc']) => {
  expect(store().past).toHaveLength(1);
  const changed = store().doc;
  store().undo(); expect(store().doc).toMatchObject({ layers: original.layers, slides: original.slides, slideOrder: original.slideOrder });
  store().redo(); expect(store().doc).toMatchObject({ layers: changed.layers, slides: changed.slides, slideOrder: changed.slideOrder });
};
beforeEach(() => seed([]));
afterEach(() => vi.useRealTimers());

describe('document multi-selection', () => {
  it('mirrors both document and direct session selection calls', () => {
    seed([shape('a'), shape('b')]); store().selectLayers(['a', 'b'], 'a');
    expect(store()).toMatchObject({ selectedLayerIds: ['a', 'b'], selectedLayerId: 'a' });
    useEditorSession.getState().selectLayers(['b']); expect(store()).toMatchObject({ selectedLayerIds: ['b'], selectedLayerId: 'b' });
    useEditorSession.getState().focusSlide(sid); expect(store()).toMatchObject({ selectedSlideId: sid, selectedLayerIds: [], selectedLayerId: null });
    store().selectLayer('a'); expect(store().selectedLayerIds).toEqual(['a']);
    store().selectSlide(sid); expect(store().selectedLayerIds).toEqual([]);
  });
  it('selects only unlocked visible layers on the selected slide', () => {
    seed([shape('a'), shape('b', { locked: true }), shape('c', { visible: false }), shape('d')]);
    store().addSlide(); store().addShapeLayer('rect'); store().selectSlide(sid);
    const past = store().past.length; store().selectAllLayers();
    expect(store().selectedLayerIds).toEqual(['a', 'd']); expect(store().selectedLayerId).toBe('d'); expect(store().past).toHaveLength(past);
  });
  it('prunes an undone addition and picks the last remaining primary', () => {
    seed([shape('a')]); store().addShapeLayer('rect'); const added = store().selectedLayerId!;
    store().selectLayers(['a', added], added); store().undo();
    expect(useEditorSession.getState()).toMatchObject({ selectedLayerIds: ['a'], selectedLayerId: 'a' });
    expect(store()).toMatchObject({ selectedLayerIds: ['a'], selectedLayerId: 'a' });
    store().redo(); expect(store().selectedLayerIds).toEqual(['a']);
  });
  it('prunes after redo deletion and transaction cancellation', () => {
    seed([shape('a'), shape('b')]); store().deleteLayer('b'); store().undo(); store().selectLayers(['a', 'b']); store().redo();
    expect(store()).toMatchObject({ selectedLayerIds: ['a'], selectedLayerId: 'a' });
    const tx = store().beginTransaction('Add'); store().updateTransaction(tx, command('Add', (d) => { d.layers.c = shape('c'); d.slides[sid].layerOrder.push('c'); }));
    store().selectLayers(['a', 'c']); store().cancelTransaction(tx); expect(store().selectedLayerIds).toEqual(['a']);
  });
  it('preserves an explicit null primary when pruning ids', () => {
    seed([shape('a')]); store().addShapeLayer('rect'); const added = store().selectedLayerId!;
    store().selectLayers(['a', added], null); store().undo();
    expect(store()).toMatchObject({ selectedLayerIds: ['a'], selectedLayerId: null });
  });
  it('prunes a deleted slide and restores a valid focus after undoing an added slide', () => {
    seed([shape('a')]); store().addSlide(); const second = store().selectedSlideId;
    store().addShapeLayer('rect'); store().selectSlide(sid); store().selectLayer('a'); store().deleteSlide(second);
    expect(store().selectedLayerIds).toEqual(['a']);
    store().addSlide(); store().undo(); expect(store()).toMatchObject({ selectedSlideId: sid, selectedLayerIds: [] });
  });
});

describe('grouping, deletion and duplication', () => {
  it('groups expanded members contiguously at the topmost member while preserving order', () => {
    seed([shape('a', { groupId: 'old' }), shape('b'), shape('c', { groupId: 'old' }), shape('d'), shape('e')]);
    store().selectLayer('a'); const original = store().doc;
    const group = store().groupLayers(['d', 'c']);
    expect(group).toBeTypeOf('string'); expect(order()).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(['a', 'c', 'd'].map((id) => store().doc.layers[id].groupId)).toEqual([group, group, group]);
    expect(store()).toMatchObject({ selectedLayerIds: ['a', 'c', 'd'], selectedLayerId: 'a' }); assertUndo(original);
  });
  it('does not group fewer than two existing layers', () => {
    seed([shape('a')]); expect(store().groupLayers(['a', 'a', 'missing'])).toBeNull(); expect(store().past).toHaveLength(0);
  });
  it('prefers the selected slide and ignores ids on other slides', () => {
    seed([shape('a'), shape('b')]); store().addSlide(); const otherSlide = store().selectedSlideId; store().addShapeLayer('rect'); const other = store().selectedLayerId!;
    store().selectSlide(sid); store().groupLayers(['missing', other, 'a', 'b']);
    expect(store().doc.layers.a.groupId).toBe(store().doc.layers.b.groupId); expect(store().doc.layers[other].groupId).toBeUndefined();
    expect(store().doc.slides[otherSlide].layerOrder).toEqual([other]);
  });
  it('ungroups every member of touched groups without changing selection', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c', { groupId: 'other' })]);
    store().selectLayer('a'); const original = store().doc; store().ungroupLayers(['b']);
    expect(store().doc.layers.a.groupId).toBeUndefined(); expect(store().doc.layers.b.groupId).toBeUndefined(); expect(store().doc.layers.c.groupId).toBe('other');
    expect(store().selectedLayerIds).toEqual(['a']); assertUndo(original);
  });
  it('deletes ids once, normalizes singleton groups, and clears selection', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c')]);
    store().selectLayers(['a', 'b']); const original = store().doc; store().deleteLayers(['a', 'a', 'c', 'missing']);
    expect(order()).toEqual(['b']); expect(store().doc.layers.b.groupId).toBeUndefined(); expect(store().selectedLayerIds).toEqual([]); assertUndo(original);
  });
  it('normalizes singleton groups after legacy deleteLayer', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' })]); store().deleteLayer('a'); expect(store().doc.layers.b.groupId).toBeUndefined();
  });
  it('duplicates an expanded group as a fresh shared block above its highest member', () => {
    seed([shape('a', { x: 5, groupId: 'g' }), shape('b'), shape('c', { y: 10, groupId: 'g' }), shape('d')]);
    store().selectLayer('a'); const original = store().doc; const copies = store().duplicateLayers(['c']);
    expect(copies).toHaveLength(2); expect(order()).toEqual(['a', 'b', 'c', ...copies, 'd']);
    const [a, c] = copies.map((id) => store().doc.layers[id]);
    expect(a).toMatchObject({ name: 'a copy', x: 29, y: 24 }); expect(c).toMatchObject({ name: 'c copy', x: 24, y: 34 });
    expect(a.groupId).toBeTruthy(); expect(a.groupId).not.toBe('g'); expect(c.groupId).toBe(a.groupId);
    expect(store()).toMatchObject({ selectedLayerIds: copies, selectedLayerId: copies[0] }); assertUndo(original);
  });
  it('places each copied unit directly above its source unit and gives each group its own id', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c'), shape('d', { groupId: 'h' }), shape('e', { groupId: 'h' })]);
    const copies = store().duplicateLayers(['a', 'c', 'e']); const [a, b, c, d, e] = copies;
    expect(order()).toEqual(['a', 'b', a, b, 'c', c, 'd', 'e', d, e]);
    expect(store().doc.layers[a].groupId).toBe(store().doc.layers[b].groupId);
    expect(store().doc.layers[d].groupId).toBe(store().doc.layers[e].groupId);
    expect(store().doc.layers[a].groupId).not.toBe(store().doc.layers[d].groupId);
    expect(store().doc.layers[c].groupId).toBeUndefined();
  });
  it('keeps legacy duplicateLayer group-aware and ignores missing copies', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' })]); store().duplicateLayer('a'); expect(order()).toHaveLength(4);
    expect(store().duplicateLayers(['missing'])).toEqual([]); expect(store().past).toHaveLength(1);
  });
  it('remaps every duplicated slide group without connecting the copies to the source slide', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c', { groupId: 'h' }), shape('d')]);
    const original = store().doc; store().duplicateSlide(sid);
    const copies = store().doc.slides[store().selectedSlideId].layerOrder.map((id) => store().doc.layers[id]);
    expect(copies[0].groupId).toBe(copies[1].groupId); expect(copies[0].groupId).not.toBe('g'); expect(copies[2].groupId).not.toBe('h'); expect(copies[2].groupId).not.toBe(copies[0].groupId); expect(copies[3].groupId).toBeUndefined(); assertUndo(original);
  });
});

describe('alignment and distribution', () => {
  it('aligns group union bounds as rigid units', () => {
    seed([shape('a', { x: 10, groupId: 'g' }), shape('b', { x: 30, groupId: 'g' }), shape('c', { x: 80 })]);
    const original = store().doc; store().alignLayers(['a', 'c'], 'right'); expect(xs(['a', 'b', 'c'])).toEqual([60, 80, 80]); assertUndo(original);
  });
  it('keeps a unit with any locked member fixed while counting it in selection bounds', () => {
    seed([shape('a', { x: 10, groupId: 'g', locked: true }), shape('b', { x: 30, groupId: 'g' }), shape('c', { x: 80 })]);
    store().alignLayers(['a', 'c'], 'left'); expect(xs(['a', 'b', 'c'])).toEqual([10, 30, 10]);
  });
  it.each([['left', 0, 30], ['centerX', 45, 30], ['right', 90, 30], ['top', 20, 0], ['centerY', 20, 45], ['bottom', 20, 90]] as const)('defaults one unit to slide alignment at %s', (edge, x, y) => {
    seed([shape('a', { x: 20, y: 30 })]); store().alignLayers(['a'], edge); expect(store().doc.layers.a).toMatchObject({ x, y }); expect(store().past).toHaveLength(1);
  });
  it('supports explicit slide and selection targets and rotated bounds', () => {
    seed([shape('a', { x: 20, width: 20, height: 10, rotation: 90 }), shape('b', { x: 60 })]);
    store().alignLayers(['a', 'b'], 'left', 'slide'); expect(store().doc.layers.a.x).toBeCloseTo(-5); expect(store().doc.layers.b.x).toBe(0);
    const before = store().past.length; store().alignLayers(['a'], 'centerX', 'selection'); expect(store().past).toHaveLength(before);
  });
  it('distributes groups with equal gaps and fixed endpoints', () => {
    seed([shape('a'), shape('b', { x: 20, groupId: 'g' }), shape('c', { x: 30, groupId: 'g' }), shape('d', { x: 100 })]);
    const original = store().doc; store().distributeLayers(['a', 'b', 'd'], 'horizontal'); expect(xs(['a', 'b', 'c', 'd'])).toEqual([0, 45, 55, 100]); assertUndo(original);
  });
  it('keeps locked units in their sorted slot and moves remaining units to computed positions', () => {
    seed([shape('a'), shape('b', { x: 20, locked: true }), shape('c', { x: 30 }), shape('d', { x: 120 })]);
    store().distributeLayers(['d', 'c', 'b', 'a'], 'horizontal'); expect(xs(['a', 'b', 'c', 'd'])).toEqual([0, 20, 80, 120]);
  });
  it('supports negative gaps and vertical distribution', () => {
    seed([shape('a', { y: 0, height: 50 }), shape('b', { y: 5, height: 50 }), shape('c', { y: 20, height: 50 })]);
    store().distributeLayers(['a', 'b', 'c'], 'vertical'); expect(['a', 'b', 'c'].map((id) => store().doc.layers[id].y)).toEqual([0, 10, 20]);
  });
  it('does nothing for fewer than three units or no alignment input', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c')]); store().distributeLayers(['a', 'b', 'c'], 'horizontal'); store().alignLayers(['missing'], 'left'); expect(store().past).toHaveLength(0);
  });
});

describe('move, resize and reorder', () => {
  it('moves unlocked ids only, deduplicates, and merges nudges with reversible history', () => {
    seed([shape('a'), shape('b', { locked: true }), shape('c')]); const original = store().doc;
    store().moveLayers(['a', 'a', 'b', 'c'], 1, -2, 'nudge'); store().moveLayers(['a'], 2, -3, 'nudge'); store().moveLayers(['c'], 4, 5, 'nudge');
    expect(store().doc.layers.a).toMatchObject({ x: 3, y: -5 }); expect(store().doc.layers.b).toMatchObject({ x: 0, y: 0 }); expect(store().doc.layers.c).toMatchObject({ x: 5, y: 3 }); assertUndo(original);
  });
  it('ends merging after the time window or a different merge key', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); seed([shape('a')]);
    store().moveLayers(['a'], 1, 0, 'nudge'); vi.advanceTimersByTime(751); store().moveLayers(['a'], 1, 0, 'nudge'); store().moveLayers(['a'], 1, 0, 'other'); expect(store().past).toHaveLength(3);
  });
  it('resizes unlocked layers and their styles as one undo step', () => {
    seed([shape('a', { x: 10 }), shape('b', { locked: true })]); const original = store().doc;
    store().resizeLayers(['a', 'b'], { x: 0, y: 0, width: 100, height: 100 }, { x: 5, y: 10, width: 400, height: 100 });
    expect(store().doc.layers.a).toMatchObject({ x: 45, y: 10, width: 40, height: 10, strokeWidth: 4, cornerRadius: 8 }); expect(store().doc.layers.b).toEqual(original.layers.b); assertUndo(original);
  });
  it('moves a group block past exactly one neighboring group via the legacy API', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c', { groupId: 'h' }), shape('d', { groupId: 'h' }), shape('e')]); const original = store().doc;
    store().reorderLayer('a', 'up'); expect(order()).toEqual(['c', 'd', 'a', 'b', 'e']); assertUndo(original);
    store().reorderLayers(['a'], 'down'); expect(order()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('gathers a discontiguous selection while preserving its order at top and bottom', () => {
    seed(['a', 'b', 'c', 'd', 'e'].map((id) => shape(id)));
    store().reorderLayers(['d', 'b'], 'top'); expect(order()).toEqual(['a', 'c', 'e', 'b', 'd']);
    store().reorderLayers(['b', 'd'], 'bottom'); expect(order()).toEqual(['b', 'd', 'a', 'c', 'e']);
  });
  it('expands group mates before moving multiple selected units one step down', () => {
    seed([shape('a', { groupId: 'g' }), shape('b', { groupId: 'g' }), shape('c'), shape('d', { groupId: 'h' }), shape('e', { groupId: 'h' })]);
    store().reorderLayers(['c', 'e'], 'down'); expect(order()).toEqual(['c', 'd', 'e', 'a', 'b']);
  });
  it('does not add history for boundary moves or missing ids', () => {
    seed([shape('a'), shape('b')]); store().reorderLayer('a', 'down'); store().reorderLayer('b', 'up'); store().reorderLayers(['missing'], 'top'); store().moveLayers([], 1, 1); expect(store().past).toHaveLength(0);
  });
});

describe('panoramas and media slides', () => {
  it('adds enough trailing slides and a selected spanning panorama in one undo step', () => {
    const original = store().doc; store().spreadAcrossSlides({ id: 'wide', width: 350, height: 100 });
    expect(store().doc.slideOrder).toHaveLength(4); expect(order()).toEqual([store().selectedLayerId]);
    expect(store().doc.layers[store().selectedLayerId!]).toMatchObject({ name: 'Panorama', assetId: 'wide', x: 0, y: 0, width: 400, height: 100, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 }); assertUndo(original);
  });
  it('starts from the selected slide and reuses enough existing trailing slides', () => {
    store().addSlide(); store().addSlide(); store().selectSlide(sid); const original = store().doc;
    store().spreadAcrossSlides({ id: 'photo', width: 100, height: 100 }, 1); expect(store().doc.slideOrder).toHaveLength(3); expect(order()).toHaveLength(1); expect(store().doc.layers[order()[0]].width).toBe(200);
    store().selectSlide(original.slideOrder[2]); store().spreadAcrossSlides({ id: 'photo', width: 100, height: 100 }, 3); expect(store().doc.slideOrder).toHaveLength(5);
  });
  it('replaces the single empty slide, preserving its background and focusing the first new slide', () => {
    const bg = { kind: 'image' as const, assetId: 'background', blur: 2, dim: 0.1, color: '#123' };
    store().setBackground(bg); useDocumentStore.setState({ past: [] }); const original = store().doc; const focus = useEditorSession.getState().slideFocusRequest;
    store().addMediaAsSlides([{ id: 'photo', width: 100, height: 100 }, { id: 'wide', width: 300, height: 100 }, { id: 'video', width: 100, height: 200, mediaKind: 'video' }, { id: 'gif', width: 100, height: 100, mediaKind: 'gif' }]);
    const doc = store().doc; const slides = doc.slideOrder.map((id) => doc.slides[id]);
    expect(slides).toHaveLength(6); expect(doc.slides[sid]).toBeUndefined(); expect(slides[0].background).toEqual(bg);
    expect(slides.slice(1).every((slide) => slide.background.kind === 'solid')).toBe(true);
    expect(slides.map((slide) => slide.layerOrder.length)).toEqual([1, 1, 0, 0, 1, 1]);
    expect(Object.values(doc.layers).map((layer) => layer.name)).toEqual(['Photo', 'Panorama', 'Video', 'Animation']);
    expect(Object.values(doc.layers).map((layer) => layer.width)).toEqual([100, 300, 100, 100]);
    expect(store()).toMatchObject({ selectedSlideId: slides[0].id, selectedLayerId: null, selectedLayerIds: [] }); expect(useEditorSession.getState().slideFocusRequest).toBe(focus + 1); assertUndo(original);
  });
  it('inserts media after a nonempty selected slide and before later slides', () => {
    seed([shape('a')]); store().addSlide(); const last = store().selectedSlideId; store().selectSlide(sid); useDocumentStore.setState({ past: [] }); const original = store().doc;
    store().addMediaAsSlides([{ id: 'photo', width: 100, height: 200 }]); expect(store().doc.slideOrder).toEqual([sid, store().selectedSlideId, last]);
    const layer = store().doc.layers[store().doc.slides[store().selectedSlideId].layerOrder[0]];
    expect(layer).toMatchObject({ name: 'Photo', x: 0, y: 0, width: 100, height: 100, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 }); assertUndo(original);
  });
  it('inserts after a selected empty slide in a multi-slide project and ignores empty imports', () => {
    store().addSlide(); const selected = store().selectedSlideId; store().addMediaAsSlides([{ id: 'photo', width: 100, height: 100 }]); expect(store().doc.slideOrder).toEqual([sid, selected, store().selectedSlideId]);
    const before = store().doc; const history = store().past.length; store().addMediaAsSlides([]); expect(store().doc).toBe(before); expect(store().past).toHaveLength(history);
  });
});
