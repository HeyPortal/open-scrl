import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import type { ImageLayer, Layer, TextLayer } from '@/types';
import { Inspector } from '@/components/Inspector';
import { MobileInspector } from './MobileInspector';

// The export pipeline loads Konva's Node build; it is not exercised here.
vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));

const base = { x: 10, y: 20, width: 300, height: 200, rotation: 0, opacity: 1, visible: true, locked: false } as const;
const photo: ImageLayer = { ...base, id: 'p', kind: 'image', name: 'Photo', assetId: null, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
const title: TextLayer = { ...base, id: 't', kind: 'text', name: 'Title', text: 'Hello', fontFamily: 'Inter', fontSize: 40, fontWeight: 600, italic: false, fill: '#ffffff', align: 'left', letterSpacing: 0, lineHeight: 1.2 };

function select(layer: Layer) {
  const doc = newDocument({ name: 'Test', width: 1000, height: 1000 });
  doc.layers = { [layer.id]: layer };
  doc.slides[doc.slideOrder[0]].layerOrder = [layer.id];
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().selectSlide(doc.slideOrder[0]);
  useEditorSession.getState().selectLayers([layer.id]);
}

beforeEach(() => {
  // jsdom has no canvas; the photo-shape glyphs just skip drawing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  select(title);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MobileInspector', () => {
  it('wraps the shared inspector in the touch container', () => {
    const { container } = render(<MobileInspector />);
    expect(container.firstElementChild).toHaveClass('mobile-inspector');
  });

  it('edits a text layer’s content', () => {
    render(<MobileInspector />);
    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'Summer 24' } });
    expect((useDocumentStore.getState().doc.layers.t as TextLayer).text).toBe('Summer 24');
  });

  it('keeps rotation in [-180, 180) when turning by 90°', () => {
    const rotation = () => useDocumentStore.getState().doc.layers.t.rotation;
    const view = render(<MobileInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° right' }));
    expect(rotation()).toBe(90);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° right' }));
    expect(rotation()).toBe(-180);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° left' }));
    expect(rotation()).toBe(90);
    view.unmount();

    select({ ...title, rotation: 180 });
    render(<MobileInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90° right' }));
    expect(rotation()).toBe(-90);
  });

  it('adds quick rotate buttons that the desktop inspector does not have', () => {
    const view = render(<MobileInspector />);
    view.unmount();
    render(<Inspector onShowLayers={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Rotate 90° right' })).toBeNull();
  });

  it('hides the side-panel Replace link unless the shell provides a picker', () => {
    select(photo);
    const view = render(<MobileInspector />);
    expect(screen.queryByRole('button', { name: 'Choose photo' })).toBeNull();
    view.unmount();
    const onReplacePhoto = vi.fn();
    render(<MobileInspector onReplacePhoto={onReplacePhoto} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    expect(onReplacePhoto).toHaveBeenCalledTimes(1);
  });

  it('keeps the desktop Replace link opening the side panel', () => {
    select(photo);
    useEditorSession.getState().setLeftPanel('text');
    render(<Inspector onShowLayers={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose photo' }));
    expect(useEditorSession.getState().leftPanel).toBe('photos');
  });
});
