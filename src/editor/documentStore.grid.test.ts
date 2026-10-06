import { beforeEach, describe, expect, it } from 'vitest';
import { GRID_TEMPLATES, layoutGrid } from '@/lib/grids';
import { getLiveGrid } from '@/core/document/grid';
import { newDocument, useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';

const four = GRID_TEMPLATES.find((t) => t.id === 'four-grid')!;
const store = () => useDocumentStore.getState();
const sid = () => store().doc.slideOrder[0];
const slotIds = (slideId = sid()) => store().doc.slides[slideId].grid!.slotIds;
const frame = (id: string) => { const l = store().doc.layers[id]; return { x: l.x, y: l.y, w: l.width, h: l.height }; };

beforeEach(() => {
  useDocumentStore.setState({ doc: newDocument(), past: [], future: [], transaction: null, selectedSlideId: '' });
  useEditorSession.setState({ selectedSlideId: '' });
});

describe('applyGrid', () => {
  it('records the grid and lays the slots out inside the margin', () => {
    store().applyGrid(four, 24, 40);
    expect(store().doc.slides[sid()].grid).toMatchObject({ templateId: 'four-grid', gap: 24, margin: 40 });
    const cells = layoutGrid(four, store().doc.format, 24, 40);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
  });

  it('defaults the margin to 0', () => {
    store().applyGrid(four, 24);
    expect(store().doc.slides[sid()].grid!.margin).toBe(0);
  });
});

describe('setSlideGrid', () => {
  it('moves untouched slots and leaves hand-moved slots, other layers and filled assets alone', () => {
    store().applyGrid(four, 0, 0);
    store().addTextLayer();
    const [a, b, c] = slotIds();
    const textId = store().doc.slides[sid()].layerOrder.find((id) => !slotIds().includes(id))!;
    const textBefore = { ...store().doc.layers[textId] };
    store().updateLayer(b, { x: 500 });
    store().updateLayer(a, { assetId: 'asset-1', cropScale: 2 } as never);
    const bBefore = frame(b);

    store().setSlideGrid(sid(), { gap: 30 });

    const cells = layoutGrid(four, store().doc.format, 30, 0);
    expect(frame(a)).toEqual(cells[0]);
    expect(frame(c)).toEqual(cells[2]);
    expect(frame(b)).toEqual(bBefore);
    expect(store().doc.layers[a]).toMatchObject({ assetId: 'asset-1', cropScale: 2, locked: true });
    expect(store().doc.layers[textId]).toEqual(textBefore);
    expect(store().doc.slides[sid()].grid!.gap).toBe(30);
  });

  it('changes the margin independently of the gap', () => {
    store().applyGrid(four, 20, 0);
    store().setSlideGrid(sid(), { margin: 60 });
    const cells = layoutGrid(four, store().doc.format, 20, 60);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 20, margin: 60 });
  });

  it('keeps the remaining slots on their own cells when a middle slot was deleted', () => {
    store().applyGrid(four, 0, 0);
    store().deleteLayer(slotIds()[1]);
    store().setSlideGrid(sid(), { gap: 20 });
    const cells = layoutGrid(four, store().doc.format, 20, 0);
    expect(frame(slotIds()[0])).toEqual(cells[0]);
    expect(frame(slotIds()[2])).toEqual(cells[2]);
    expect(frame(slotIds()[3])).toEqual(cells[3]);
  });

  it('undoes a multi-tick drag as one step and restores slots and values together', () => {
    store().applyGrid(four, 0, 0);
    const before = store().past.length;
    const tx = store().beginTransaction('Adjust grid', 'gesture:grid');
    for (const gap of [5, 15, 40]) store().setSlideGrid(sid(), { gap });
    store().commitTransaction(tx);
    expect(store().past.length).toBe(before + 1);

    store().undo();

    const cells = layoutGrid(four, store().doc.format, 0, 0);
    slotIds().forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().doc.slides[sid()].grid!.gap).toBe(0);
  });

  it('is a no-op for an unknown template and for a value that has not changed', () => {
    store().applyGrid(four, 10, 0);
    const doc = store().doc;
    store().setSlideGrid(sid(), { gap: 10 });
    expect(store().doc).toBe(doc);
    useDocumentStore.setState((s) => ({ doc: { ...s.doc, slides: { ...s.doc.slides, [sid()]: { ...s.doc.slides[sid()], grid: { ...s.doc.slides[sid()].grid!, templateId: 'nope' } } } } }));
    const unknown = store().doc;
    store().setSlideGrid(sid(), { gap: 50 });
    expect(store().doc).toBe(unknown);
  });

  it('stops being live once every slot is deleted', () => {
    store().applyGrid(four, 10, 0);
    for (const id of [...slotIds()]) store().deleteLayer(id);
    expect(getLiveGrid(store().doc, sid())).toBeNull();
  });
});

describe('duplicateSlide with a grid', () => {
  it('re-ids the copied slots so adjusting the copy does not move the original', () => {
    store().applyGrid(four, 0, 0);
    const original = [...slotIds()];
    store().duplicateSlide(sid());
    const copyId = store().doc.slideOrder[1];
    const copy = slotIds(copyId);

    expect(copy).toHaveLength(original.length);
    expect(copy.some((id) => original.includes(id))).toBe(false);
    expect(copy.every((id) => store().doc.slides[copyId].layerOrder.includes(id))).toBe(true);

    store().setSlideGrid(copyId, { gap: 40 });

    const wide = layoutGrid(four, store().doc.format, 40, 0);
    const flush = layoutGrid(four, store().doc.format, 0, 0);
    copy.forEach((id, i) => expect(frame(id)).toEqual(wide[i]));
    original.forEach((id, i) => expect(frame(id)).toEqual(flush[i]));
  });

  it('keeps copied slotIds aligned with cells when a slot was deleted before duplicating', () => {
    store().applyGrid(four, 0, 0);
    store().deleteLayer(slotIds()[1]);
    store().duplicateSlide(sid());
    const copyId = store().doc.slideOrder[1];
    store().setSlideGrid(copyId, { gap: 20 });
    const cells = layoutGrid(four, store().doc.format, 20, 0);
    expect(frame(slotIds(copyId)[2])).toEqual(cells[2]);
  });
});
