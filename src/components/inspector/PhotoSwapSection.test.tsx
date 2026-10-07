import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import type { ImageLayer } from '@/types';
import { PhotoSwapSection } from './PhotoSwapSection';

const frame = (id: string, assetId: string | null, patch: Partial<ImageLayer> = {}): ImageLayer => ({
  id, kind: 'image', name: id, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false,
  assetId, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1, ...patch,
});

function seed(layers: ImageLayer[]) {
  const doc = newDocument({ name: 'Test', width: 100, height: 100 });
  doc.layers = Object.fromEntries(layers.map((l) => [l.id, l]));
  doc.slides[doc.slideOrder[0]].layerOrder = layers.map((l) => l.id);
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
}

beforeEach(() => seed([frame('a', 'one'), frame('b', 'two'), frame('c', null), frame('d', 'three', { visible: false })]));
afterEach(cleanup);

describe('PhotoSwapSection', () => {
  it('swaps two selected photos', () => {
    render(<PhotoSwapSection ids={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: /swap photos/i }));
    const { layers } = useDocumentStore.getState().doc;
    expect([layers.a, layers.b].map((l) => (l as ImageLayer).assetId)).toEqual(['two', 'one']);
  });

  it('offers nothing destructive until a target is chosen', () => {
    render(<PhotoSwapSection ids={['a']} />);
    expect(screen.getByRole('button', { name: /swap photos/i })).toBeDisabled();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a frame…', 'Slide 1 · b', 'Slide 1 · c (empty)']);
  });

  it('moves a photo into an empty frame', () => {
    render(<PhotoSwapSection ids={['a']} />);
    fireEvent.change(screen.getByLabelText('Other photo frame'), { target: { value: 'c' } });
    fireEvent.click(screen.getByRole('button', { name: /move photo/i }));
    const { layers } = useDocumentStore.getState().doc;
    expect([(layers.a as ImageLayer).assetId, (layers.c as ImageLayer).assetId]).toEqual([null, 'one']);
  });

  it('labels a selected filled and empty pair as a move', () => {
    render(<PhotoSwapSection ids={['c', 'a']} />);
    fireEvent.click(screen.getByRole('button', { name: /move photo/i }));
    const { layers } = useDocumentStore.getState().doc;
    expect([(layers.a as ImageLayer).assetId, (layers.c as ImageLayer).assetId]).toEqual([null, 'one']);
  });

  it('ignores a chosen frame that has since been removed', () => {
    render(<PhotoSwapSection ids={['a']} />);
    fireEvent.change(screen.getByLabelText('Other photo frame'), { target: { value: 'b' } });
    expect(screen.getByRole('button', { name: /swap photos/i })).toBeEnabled();
    act(() => useDocumentStore.getState().deleteLayer('b'));
    expect(screen.getByRole('button', { name: /swap photos/i })).toBeDisabled();
  });
});
