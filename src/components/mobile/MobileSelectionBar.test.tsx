import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '@/types';
import { MobileSelectionBar } from './MobileSelectionBar';

// The export pipeline loads Konva's Node build; it is not exercised here.
vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));

const base = { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false } as const;
const photo = (id: string, assetId: string | null = 'asset'): ImageLayer => ({ ...base, id, kind: 'image', name: id, assetId, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 });
const text = (id: string): TextLayer => ({ ...base, id, kind: 'text', name: id, text: 'Hi', fontFamily: 'Inter', fontSize: 40, fontWeight: 600, italic: false, fill: '#ffffff', align: 'left', letterSpacing: 0, lineHeight: 1.2 });
const shape = (id: string): ShapeLayer => ({ ...base, id, kind: 'shape', name: id, shape: 'rect', fill: '#ff0000', stroke: 'transparent', strokeWidth: 0, cornerRadius: 0 });

function seed(layers: Layer[], selected: string[]) {
  const doc = newDocument({ name: 'Test', width: 1000, height: 1000 });
  doc.layers = Object.fromEntries(layers.map((l) => [l.id, l]));
  doc.slides[doc.slideOrder[0]].layerOrder = layers.map((l) => l.id);
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().selectSlide(doc.slideOrder[0]);
  useEditorSession.getState().selectLayers(selected);
}

const bar = (props: Partial<Parameters<typeof MobileSelectionBar>[0]> = {}) =>
  render(<MobileSelectionBar onEdit={props.onEdit ?? vi.fn()} onReplacePhoto={props.onReplacePhoto ?? vi.fn()} />);
const button = (name: RegExp | string) => screen.getByRole('button', { name });

beforeEach(() => seed([photo('a'), text('b'), shape('c')], ['a']));
afterEach(cleanup);

describe('MobileSelectionBar', () => {
  it('names a single layer by kind and offers Edit and Replace for a photo', () => {
    const onEdit = vi.fn();
    const onReplacePhoto = vi.fn();
    bar({ onEdit, onReplacePhoto });
    expect(screen.getByRole('status', { name: 'Selected: Photo' })).toBeInTheDocument();
    fireEvent.click(button('Edit'));
    fireEvent.click(button('Replace'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onReplacePhoto).toHaveBeenCalledTimes(1);
  });

  it('offers to fill an empty photo frame', () => {
    seed([photo('a', null)], ['a']);
    bar();
    expect(button('Add photo')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
  });

  it('hides Replace for text and shapes', () => {
    seed([photo('a'), text('b'), shape('c')], ['b']);
    const view = bar();
    expect(screen.getByRole('status', { name: 'Selected: Text' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace|add photo/i })).toBeNull();
    act(() => useEditorSession.getState().selectLayers(['c']));
    expect(screen.getByRole('status', { name: 'Selected: Shape' })).toBeInTheDocument();
    view.unmount();
  });

  it('disables Forward at the top of the stack and Backward at the bottom', () => {
    seed([photo('a'), text('b'), shape('c')], ['c']);
    bar();
    expect(button('Forward')).toBeDisabled();
    expect(button('Backward')).toBeEnabled();
    act(() => useEditorSession.getState().selectLayers(['a']));
    expect(button('Forward')).toBeEnabled();
    expect(button('Backward')).toBeDisabled();
  });

  it('moves layers through the stack', () => {
    seed([photo('a'), text('b'), shape('c')], ['a']);
    bar();
    fireEvent.click(button('Forward'));
    expect(useDocumentStore.getState().doc.slides[useDocumentStore.getState().doc.slideOrder[0]].layerOrder).toEqual(['b', 'a', 'c']);
  });

  it('toggles the lock and flips its label', () => {
    bar();
    fireEvent.click(button('Lock'));
    expect(useDocumentStore.getState().doc.layers.a.locked).toBe(true);
    fireEvent.click(button('Unlock'));
    expect(useDocumentStore.getState().doc.layers.a.locked).toBe(false);
  });

  it('duplicates and selects the copy', () => {
    bar();
    fireEvent.click(button('Duplicate'));
    const { doc } = useDocumentStore.getState();
    expect(Object.keys(doc.layers)).toHaveLength(4);
    expect(useEditorSession.getState().selectedLayerIds).toHaveLength(1);
    expect(useEditorSession.getState().selectedLayerIds[0]).not.toBe('a');
  });

  it('only offers Group for several layers, then Ungroup once grouped', () => {
    const view = bar();
    expect(screen.queryByRole('button', { name: /group/i })).toBeNull();
    view.unmount();

    act(() => useEditorSession.getState().selectLayers(['a', 'b']));
    bar();
    expect(screen.getByRole('status', { name: 'Selected: 2 layers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ungroup' })).toBeNull();
    fireEvent.click(button('Group'));
    const { layers } = useDocumentStore.getState().doc;
    expect(layers.a.groupId).toBeTruthy();
    expect(layers.a.groupId).toBe(layers.b.groupId);
    expect(screen.getByRole('status', { name: 'Selected: Group' })).toBeInTheDocument();
    expect(button('Ungroup')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Group' })).toBeNull();
  });

  it('deletes the selection', () => {
    bar();
    fireEvent.click(button('Delete'));
    expect(useDocumentStore.getState().doc.layers.a).toBeUndefined();
    expect(useEditorSession.getState().selectedLayerIds).toEqual([]);
  });

  it('Done clears the selection', () => {
    bar();
    fireEvent.click(button('Done'));
    expect(useEditorSession.getState().selectedLayerIds).toEqual([]);
  });

  it('renders nothing without a selection', () => {
    seed([photo('a')], []);
    const { container } = bar();
    expect(container).toBeEmptyDOMElement();
  });

  it('gives a light haptic tap where supported', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      bar();
      fireEvent.click(button('Duplicate'));
      expect(vibrate).toHaveBeenCalledWith(8);
    } finally {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    }
  });
});
