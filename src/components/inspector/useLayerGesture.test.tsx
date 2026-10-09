import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import type { ShapeLayer } from '@/types';
import { useEditGesture, useLayerGesture } from './useLayerGesture';

const shape: ShapeLayer = {
  id: 's', kind: 'shape', name: 'Shape', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false,
  shape: 'rect', fill: '#ff0000', stroke: 'transparent', strokeWidth: 0, cornerRadius: 0,
};
const store = () => useDocumentStore.getState();

beforeEach(() => {
  const doc = newDocument({ name: 'Test', width: 1000, height: 1000 });
  doc.layers = { s: shape };
  doc.slides[doc.slideOrder[0]].layerOrder = ['s'];
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
});
afterEach(cleanup);

describe('useEditGesture', () => {
  it('groups a gesture into one undo step', () => {
    const { result } = renderHook(() => useLayerGesture('s', 'Change opacity'));
    act(() => result.current.begin());
    act(() => { store().updateLayer('s', { opacity: 0.8 }); store().updateLayer('s', { opacity: 0.5 }); });
    act(() => result.current.end());
    expect(store().transaction).toBeNull();
    expect(store().past).toHaveLength(1);
    expect(store().doc.layers.s.opacity).toBe(0.5);
  });

  it('commits an open gesture when its control unmounts, so later edits are not swallowed', () => {
    const { result, unmount } = renderHook(() => useEditGesture('Change opacity'));
    act(() => result.current.begin());
    act(() => store().updateLayer('s', { opacity: 0.4 }));
    expect(store().transaction).not.toBeNull();

    unmount();
    expect(store().transaction).toBeNull();
    expect(store().past).toHaveLength(1);
    expect(store().past[0].label).toBe('Change opacity');
    expect(store().doc.layers.s.opacity).toBe(0.4);

    act(() => store().updateLayer('s', { fill: '#00ff00' }));
    expect(store().past).toHaveLength(2);
  });

  it('does nothing on unmount when no gesture is open', () => {
    const { unmount } = renderHook(() => useEditGesture('Idle'));
    unmount();
    expect(store().transaction).toBeNull();
    expect(store().past).toHaveLength(0);
  });

  it('leaves a transaction started elsewhere alone', () => {
    const { unmount } = renderHook(() => useEditGesture('Idle'));
    const other = store().beginTransaction('Other');
    unmount();
    expect(store().transaction?.id).toBe(other);
  });
});
