import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import type { ImageLayer, Layer, ShapeLayer, TextLayer } from '@/types';
import { ContextMenuHost, useContextMenu } from '@/components/Menu';
import { MobileSelectionBar } from './MobileSelectionBar';
import { mobileHaptic } from '@/lib/mobileHaptics';

// The export pipeline loads Konva's Node build; it is not exercised here.
vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));
vi.mock('@/lib/mobileHaptics', () => ({ mobileHaptic: vi.fn() }));

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
  render(
    <>
      <MobileSelectionBar onEdit={props.onEdit ?? vi.fn()} onReplacePhoto={props.onReplacePhoto ?? vi.fn()} />
      <ContextMenuHost />
    </>,
  );
const button = (name: RegExp | string) => screen.getByRole('button', { name });
const more = () => button('More actions');
/** Opens the More menu and returns the item, for actions that sit behind it. */
const moreItem = (name: string) => {
  if (!screen.queryByRole('menu', { name: 'More actions' })) fireEvent.click(more());
  return screen.getByRole('menuitem', { name });
};
const chooseMore = (name: string) => fireEvent.click(moreItem(name));

beforeEach(() => seed([photo('a'), text('b'), shape('c')], ['a']));
afterEach(() => {
  cleanup();
  useContextMenu.getState().close();
});

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
    expect(moreItem('Forward')).toBeDisabled();
    expect(moreItem('Backward')).toBeEnabled();
    act(() => useEditorSession.getState().selectLayers(['a']));
    expect(moreItem('Forward')).toBeEnabled();
    expect(moreItem('Backward')).toBeDisabled();
  });

  it('moves layers through the stack', () => {
    seed([photo('a'), text('b'), shape('c')], ['a']);
    bar();
    chooseMore('Forward');
    expect(useDocumentStore.getState().doc.slides[useDocumentStore.getState().doc.slideOrder[0]].layerOrder).toEqual(['b', 'a', 'c']);
  });

  it('toggles the lock and flips its label', () => {
    bar();
    chooseMore('Lock');
    expect(useDocumentStore.getState().doc.layers.a.locked).toBe(true);
    chooseMore('Unlock');
    expect(useDocumentStore.getState().doc.layers.a.locked).toBe(false);
  });

  it('duplicates and selects the copy', () => {
    seed([photo('a'), text('b'), shape('c')], ['c']);
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
    fireEvent.click(more());
    expect(screen.queryByRole('menuitem', { name: /group/i })).toBeNull();
    view.unmount();

    act(() => useEditorSession.getState().selectLayers(['a', 'b']));
    bar();
    expect(screen.getByRole('status', { name: 'Selected: 2 layers' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Ungroup' })).toBeNull();
    chooseMore('Group');
    const { layers } = useDocumentStore.getState().doc;
    expect(layers.a.groupId).toBeTruthy();
    expect(layers.a.groupId).toBe(layers.b.groupId);
    expect(screen.getByRole('status', { name: 'Selected: Group' })).toBeInTheDocument();
    expect(moreItem('Ungroup')).toBeEnabled();
    expect(screen.queryByRole('menuitem', { name: 'Group' })).toBeNull();
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

  it('keeps the common actions in the bar and the rest behind More', () => {
    const view = bar();
    // A photo swaps rather than duplicates: Edit, Replace and Delete stay, Duplicate moves under More.
    for (const name of ['Edit', 'Replace', 'Delete', 'More actions']) expect(button(name)).toBeEnabled();
    for (const name of ['Duplicate', 'Forward', 'Backward', 'Lock']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(more()).toHaveAttribute('aria-haspopup', 'menu');
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Duplicate', 'Forward', 'Backward', 'Lock']);
    view.unmount();
    cleanup();

    seed([photo('a'), text('b'), shape('c')], ['b']);
    bar();
    for (const name of ['Edit', 'Duplicate', 'Delete', 'More actions']) expect(button(name)).toBeEnabled();
    fireEvent.click(more());
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Forward', 'Backward', 'Lock']);
  });

  it('closes More with Escape and returns focus to its button', () => {
    bar();
    more().focus();
    fireEvent.click(more());
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(menu).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more()).toHaveFocus();
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes More on an outside tap, on a second tap of the button, and with the selection', () => {
    bar();
    fireEvent.click(more());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more());
    // The trigger's own tap is not an outside tap, so the click toggles the menu shut.
    fireEvent.pointerDown(more());
    fireEvent.click(more());
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more());
    act(() => useEditorSession.getState().selectLayers([]));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ticks when opening More and leaves command feedback to the mobile shell', () => {
    vi.mocked(mobileHaptic).mockClear();
    bar();
    fireEvent.click(more());
    expect(mobileHaptic).toHaveBeenCalledExactlyOnceWith('selection');
    vi.mocked(mobileHaptic).mockClear();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(mobileHaptic).not.toHaveBeenCalled();
  });
});
