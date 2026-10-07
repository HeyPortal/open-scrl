import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEditor } from '@/store/editor';
import type { ImageLayer, ProjectDocumentV2 } from '@/types';
import { SlidePhotoActions } from './SlidePhotoActions';

const frame = (id: string, assetId: string | null, visible = true): ImageLayer => ({
  id, kind: 'image', name: id, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible, locked: false,
  assetId, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1,
});

function setLayers(layers: ImageLayer[], shufflePhotos = vi.fn(() => true)) {
  const base = useEditor.getState().doc;
  const slideId = base.slideOrder[0];
  const doc: ProjectDocumentV2 = {
    ...base,
    slides: { ...base.slides, [slideId]: { ...base.slides[slideId], layerOrder: layers.map((l) => l.id) } },
    layers: Object.fromEntries(layers.map((l) => [l.id, l])),
  };
  useEditor.setState({ doc, shufflePhotos });
  return { slideId, shufflePhotos };
}

describe('SlidePhotoActions', () => {
  beforeEach(() => useEditor.setState(useEditor.getInitialState()));
  afterEach(cleanup);

  it('shuffles the slide when two different photos are placed', () => {
    const { slideId, shufflePhotos } = setLayers([frame('a', 'one'), frame('b', 'two')]);
    render(<SlidePhotoActions slideId={slideId} />);
    fireEvent.click(screen.getByRole('button', { name: /shuffle photos/i }));
    expect(shufflePhotos).toHaveBeenCalledWith(slideId);
  });

  it('is disabled and explains why with a single filled frame', () => {
    const { slideId } = setLayers([frame('a', 'one'), frame('b', null)]);
    render(<SlidePhotoActions slideId={slideId} />);
    expect(screen.getByRole('button', { name: /shuffle photos/i })).toBeDisabled();
    expect(screen.getByText(/at least two different photos/i)).toBeInTheDocument();
  });

  it('is hidden without photo frames', () => {
    const { slideId } = setLayers([]);
    const { container } = render(<SlidePhotoActions slideId={slideId} />);
    expect(container).toBeEmptyDOMElement();
  });
});
