import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { buildActions, handleEditorKey, matchesBinding } from './actions';

// The export pipeline loads Konva's Node build; it is not exercised here.
vi.mock('@/editor/exportStore', () => ({
  useExport: { getState: () => ({ exporting: false, exportCarousel: async () => {}, exportCurrentSlide: async () => {} }) },
}));

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init });
const state = () => useDocumentStore.getState();
const selected = () => {
  const id = useEditorSession.getState().selectedLayerId;
  return id ? state().doc.layers[id] : undefined;
};

/** Dispatches a keydown from inside a text field so `event.target` is set. */
function pressInField(init: KeyboardEventInit) {
  const input = document.createElement('input');
  document.body.append(input);
  let handled = false;
  input.addEventListener('keydown', (e) => { handled = handleEditorKey(e); });
  input.dispatchEvent(key({ ...init, bubbles: true }));
  input.remove();
  return handled;
}

beforeEach(() => {
  const doc = newDocument();
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, selectedSlideId: doc.slideOrder[0] });
  useEditorSession.setState({ selectedSlideId: doc.slideOrder[0], selectedLayerId: null, overlay: null });
});

describe('key bindings', () => {
  it('treats Ctrl and ⌘ as the same modifier and respects an explicit Shift state', () => {
    expect(matchesBinding({ key: 'z', mod: true, shift: false }, key({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matchesBinding({ key: 'z', mod: true, shift: false }, key({ key: 'z', metaKey: true }))).toBe(true);
    expect(matchesBinding({ key: 'z', mod: true, shift: false }, key({ key: 'Z', metaKey: true, shiftKey: true }))).toBe(false);
    expect(matchesBinding({ key: 't' }, key({ key: 't', ctrlKey: true }))).toBe(false);
    expect(matchesBinding({ code: 'Digit1', shift: true }, key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe(true);
  });

  it('gives every action a unique id', () => {
    const ids = buildActions().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('editor keyboard shortcuts', () => {
  it('nudges the selected layer by 1px, or 10px with Shift', () => {
    state().addShapeLayer('rect');
    const { x, y } = selected()!;
    handleEditorKey(key({ key: 'ArrowRight', shiftKey: true }));
    handleEditorKey(key({ key: 'ArrowUp' }));
    expect(selected()).toMatchObject({ x: x + 10, y: y - 1 });
  });

  it('does not nudge a locked layer', () => {
    state().addShapeLayer('rect');
    state().toggleLocked(selected()!.id);
    const { x } = selected()!;
    handleEditorKey(key({ key: 'ArrowLeft' }));
    expect(selected()!.x).toBe(x);
  });

  it('changes slides with the arrow keys when nothing is selected', () => {
    const first = state().doc.slideOrder[0];
    state().addSlide();
    useEditorSession.getState().focusSlide(first);
    handleEditorKey(key({ key: 'ArrowRight' }));
    expect(useEditorSession.getState().selectedSlideId).toBe(state().doc.slideOrder[1]);
  });

  it('inserts with single-key shortcuts but not while typing in a field', () => {
    const slideId = state().doc.slideOrder[0];
    expect(pressInField({ key: 't' })).toBe(false);
    expect(state().doc.slides[slideId].layerOrder).toHaveLength(0);
    handleEditorKey(key({ key: 't' }));
    expect(selected()?.kind).toBe('text');
  });

  it('keeps undo available from inside a text field', () => {
    state().addShapeLayer('rect');
    expect(pressInField({ key: 'z', ctrlKey: true })).toBe(true);
    expect(Object.keys(state().doc.layers)).toHaveLength(0);
  });

  it('reorders the selected layer with bracket keys', () => {
    state().addShapeLayer('rect');
    state().addShapeLayer('ellipse');
    const slideId = state().doc.slideOrder[0];
    const top = selected()!.id;
    handleEditorKey(key({ key: '[' }));
    expect(state().doc.slides[slideId].layerOrder[0]).toBe(top);
    handleEditorKey(key({ key: '}', shiftKey: true }));
    expect(state().doc.slides[slideId].layerOrder.at(-1)).toBe(top);
  });
});
