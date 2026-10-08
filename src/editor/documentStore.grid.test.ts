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

  it('keeps a hand-resized slot free when a later spacing makes its size match the grid again', () => {
    store().applyGrid(four, 0, 0);
    const [a, b] = slotIds();
    const target = layoutGrid(four, store().doc.format, 40, 0)[1];
    store().updateLayer(b, { x: 123, width: 200 });
    store().setSlideGrid(sid(), { gap: 20 });
    // The user drags the slot to exactly where the 40 px grid would put it.
    store().updateLayer(b, { x: target.x, y: target.y, width: target.w, height: target.h });
    const bBefore = frame(b);

    store().setSlideGrid(sid(), { gap: 40 });
    store().setSlideGrid(sid(), { gap: 60 });

    expect(frame(b)).toEqual(bBefore);
    expect(frame(a)).toEqual(layoutGrid(four, store().doc.format, 60, 0)[0]);
    expect(getLiveGrid(store().doc, sid())!.movedSlots).toBe(1);
  });

  it('copies the free slots to a duplicated slide and honours them in apply-to-all', () => {
    store().applyGrid(four, 0, 0);
    const b = slotIds()[1];
    store().updateLayer(b, { x: 321 });
    store().setSlideGrid(sid(), { gap: 10 });
    store().duplicateSlide(sid());
    const copyId = store().doc.slideOrder[1];
    const copyB = slotIds(copyId)[1];
    const resized = frame(copyB);
    const target = layoutGrid(four, store().doc.format, 30, 0)[1];
    store().updateLayer(copyB, { x: target.x, y: target.y, width: target.w, height: target.h });

    store().setSlideGrid(copyId, { gap: 30 });

    expect(store().doc.slides[copyId].grid!.detachedSlotIds).toEqual([copyB]);
    expect(frame(copyB)).toEqual({ x: target.x, y: target.y, w: target.w, h: target.h });
    expect(resized).not.toEqual(frame(copyB));
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

describe('reattachGridSlots', () => {
  it('snaps free slots back to their cells so they follow the grid again, in one undo step', () => {
    store().applyGrid(four, 0, 0);
    const [a, b] = slotIds();
    store().updateLayer(b, { width: 200 });
    store().setSlideGrid(sid(), { gap: 20 });
    expect(store().doc.slides[sid()].grid!.detachedSlotIds).toEqual([b]);
    const before = store().past.length;

    store().reattachGridSlots(sid());

    const cells = layoutGrid(four, store().doc.format, 20, 0);
    expect(frame(b)).toEqual(cells[1]);
    expect(store().doc.slides[sid()].grid!.detachedSlotIds).toBeUndefined();
    expect(getLiveGrid(store().doc, sid())!.movedSlots).toBe(0);
    expect(store().past.length).toBe(before + 1);

    store().setSlideGrid(sid(), { gap: 50 });
    const wide = layoutGrid(four, store().doc.format, 50, 0);
    expect(frame(b)).toEqual(wide[1]);
    expect(frame(a)).toEqual(wide[0]);

    store().undo();
    store().undo();
    expect(frame(b)).toMatchObject({ w: 200 });
    expect(store().doc.slides[sid()].grid!.detachedSlotIds).toEqual([b]);
  });

  it('re-attaches a slot that was reset by hand after a relayout freed it', () => {
    store().applyGrid(four, 0, 0);
    const b = slotIds()[1];
    store().updateLayer(b, { width: 200 });
    store().setSlideGrid(sid(), { gap: 20 });
    const cell = layoutGrid(four, store().doc.format, 0, 0)[1];
    store().setSlideGrid(sid(), { gap: 0 });
    store().updateLayer(b, { x: cell.x, y: cell.y, width: cell.w, height: cell.h });
    store().setSlideGrid(sid(), { gap: 30 });
    expect(frame(b)).toEqual({ x: cell.x, y: cell.y, w: cell.w, h: cell.h });

    store().reattachGridSlots(sid());
    store().setSlideGrid(sid(), { gap: 40 });

    expect(frame(b)).toEqual(layoutGrid(four, store().doc.format, 40, 0)[1]);
  });

  it('does nothing when no slot is moved', () => {
    store().applyGrid(four, 10, 0);
    const doc = store().doc;
    store().reattachGridSlots(sid());
    expect(store().doc).toBe(doc);
  });
});

describe('linkGridSpacing', () => {
  const landscape = { width: 1080, height: 566 };
  const fourStack = GRID_TEMPLATES.find((t) => t.id === 'four-stack')!;
  const useLandscape = () => useDocumentStore.setState((s) => ({ doc: { ...s.doc, format: { ...s.doc.format, ...landscape } } }));

  it('snaps existing grids to equal values that fit their template, in one undo step', () => {
    useLandscape();
    store().applyGrid(fourStack, 120, 0);
    store().addSlide();
    store().applyGrid(four, 30, 10);
    const [a, b] = store().doc.slideOrder;
    const before = store().past.length;

    store().linkGridSpacing();

    // 120 px of gap and margin does not fit four stacked rows on a 566 px tall slide; 100 does.
    expect(store().doc.slides[a].grid).toMatchObject({ gap: 100, margin: 100 });
    expect(store().doc.slides[b].grid).toMatchObject({ gap: 30, margin: 30 });
    const cells = layoutGrid(fourStack, landscape, 100, 100);
    slotIds(a).forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().past.length).toBe(before + 1);

    store().undo();
    expect(store().doc.slides[a].grid).toMatchObject({ gap: 120, margin: 0 });
    expect(store().doc.slides[b].grid).toMatchObject({ gap: 30, margin: 10 });
  });

  it('is a no-op when every grid already has equal, fitting spacing', () => {
    store().applyGrid(four, 20, 20);
    const doc = store().doc;
    store().linkGridSpacing();
    expect(store().doc).toBe(doc);
  });
});

describe('undo and redo with linking on', () => {
  const fourStack = GRID_TEMPLATES.find((t) => t.id === 'four-stack')!;
  const landscape = { width: 1080, height: 566 };

  function linkedFourStack() {
    useDocumentStore.setState((s) => ({ doc: { ...s.doc, format: { ...s.doc.format, ...landscape } } }));
    useEditorSession.setState({ selectedSlideId: sid(), gridLinked: false });
    store().applyGrid(fourStack, 120, 0);
    store().linkGridSpacing();
    useEditorSession.getState().setGridLinked(true);
  }

  it('switches linking off when undo restores unequal spacing', () => {
    linkedFourStack();
    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 100, margin: 100 });

    store().undo();

    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 120, margin: 0 });
    expect(useEditorSession.getState().gridLinked).toBe(false);
  });

  it('leaves linking on when undo keeps the spacing linked', () => {
    linkedFourStack();
    store().setSlideGrid(sid(), { gap: 60, margin: 60 });

    store().undo();

    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 100, margin: 100 });
    expect(useEditorSession.getState().gridLinked).toBe(true);
  });

  it('switches linking off when redo leaves unequal spacing', () => {
    linkedFourStack();
    store().setSlideGrid(sid(), { gap: 40, margin: 40 });
    store().undo();
    useEditorSession.getState().setGridLinked(true);
    store().setSlideGrid(sid(), { gap: 30, margin: 10 });
    store().undo();
    useEditorSession.getState().setGridLinked(true);

    store().redo();

    expect(store().doc.slides[sid()].grid).toMatchObject({ gap: 30, margin: 10 });
    expect(useEditorSession.getState().gridLinked).toBe(false);
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

describe('setGridSpacingForAllSlides', () => {
  const onePlusTwo = GRID_TEMPLATES.find((t) => t.id === 'one-plus-two')!;

  /** Slide 1: 2×2 grid. Slide 2: 1 + 2 grid. Slide 3: no grid, just a text layer. */
  function threeSlides() {
    store().applyGrid(four, 0, 0);
    store().addSlide();
    store().applyGrid(onePlusTwo, 0, 0);
    store().addSlide();
    store().addTextLayer();
    const [a, b, c] = store().doc.slideOrder;
    return { a, b, c };
  }

  it('copies gap and margin to every other slide with a grid, each following its own template', () => {
    const { a, b, c } = threeSlides();
    const textId = store().doc.slides[c].layerOrder[0];
    const textBefore = { ...store().doc.layers[textId] };
    store().setSlideGrid(a, { gap: 30, margin: 20 });

    store().setGridSpacingForAllSlides(a);

    expect(store().doc.slides[b].grid).toMatchObject({ templateId: 'one-plus-two', gap: 30, margin: 20 });
    const cells = layoutGrid(onePlusTwo, store().doc.format, 30, 20);
    slotIds(b).forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
    expect(store().doc.slides[a].grid).toMatchObject({ gap: 30, margin: 20 });
    expect(store().doc.slides[c].grid).toBeUndefined();
    expect(store().doc.layers[textId]).toEqual(textBefore);
  });

  it('leaves a slot that was moved by hand on another slide where it is', () => {
    const { a, b } = threeSlides();
    const [first, second] = slotIds(b);
    store().updateLayer(first, { x: 777 });
    const movedBefore = frame(first);
    store().setSlideGrid(a, { gap: 30, margin: 20 });

    store().setGridSpacingForAllSlides(a);

    expect(frame(first)).toEqual(movedBefore);
    expect(frame(second)).toEqual(layoutGrid(onePlusTwo, store().doc.format, 30, 20)[1]);
  });

  it('is one undo step for all slides', () => {
    const { a, b } = threeSlides();
    store().setSlideGrid(a, { gap: 30, margin: 20 });
    const before = store().past.length;

    store().setGridSpacingForAllSlides(a);
    expect(store().past.length).toBe(before + 1);
    store().undo();

    expect(store().doc.slides[b].grid).toMatchObject({ gap: 0, margin: 0 });
    const flush = layoutGrid(onePlusTwo, store().doc.format, 0, 0);
    slotIds(b).forEach((id, i) => expect(frame(id)).toEqual(flush[i]));
    expect(store().doc.slides[a].grid).toMatchObject({ gap: 30, margin: 20 });
  });

  it('while linked, caps each slide at what its template fits so every slide stays linked', () => {
    const fourStack = GRID_TEMPLATES.find((t) => t.id === 'four-stack')!;
    const landscape = { width: 1080, height: 566 };
    useDocumentStore.setState((s) => ({ doc: { ...s.doc, format: { ...s.doc.format, ...landscape } } }));
    store().applyGrid(fourStack, 0, 0);
    store().addSlide();
    store().applyGrid(four, 120, 120);
    const [a, b] = store().doc.slideOrder;

    store().setGridSpacingForAllSlides(b, true);

    // 120 px of gap and margin does not fit four stacked rows on a 566 px tall slide; 100 does.
    expect(store().doc.slides[a].grid).toMatchObject({ gap: 100, margin: 100 });
    const cells = layoutGrid(fourStack, landscape, 100, 100);
    slotIds(a).forEach((id, i) => expect(frame(id)).toEqual(cells[i]));
  });

  it('copies unequal spacing as it is even when linking is on', () => {
    const { a, b } = threeSlides();
    store().setSlideGrid(a, { gap: 30, margin: 20 });

    store().setGridSpacingForAllSlides(a, true);

    expect(store().doc.slides[b].grid).toMatchObject({ gap: 30, margin: 20 });
  });

  it('does nothing when the source has no grid, no other slide has one, or the spacing already matches', () => {
    store().applyGrid(four, 10, 5);
    store().addSlide();
    const [a, b] = store().doc.slideOrder;
    const doc = store().doc;
    store().setGridSpacingForAllSlides(b);
    store().setGridSpacingForAllSlides(a);
    expect(store().doc).toBe(doc);
  });
});
