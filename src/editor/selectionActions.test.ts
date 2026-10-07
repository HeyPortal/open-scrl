import { beforeEach, describe, expect, it } from 'vitest';
import type { ShapeLayer } from '@/types';
import { newDocument, useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';
import { clickWouldNarrow, enterGroup, narrowTo, pickLayer, selectParent } from './selectionActions';

const shape = (id: string, groupId?: string): ShapeLayer => ({ id, kind: 'shape', name: id, x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#000', stroke: '#fff', strokeWidth: 0, cornerRadius: 0, groupId });
const selection = () => useEditorSession.getState().selectedLayerIds;

beforeEach(() => {
  const doc = newDocument({ name: 'Test', width: 100, height: 100 });
  const sid = doc.slideOrder[0];
  const layers = [shape('a', 'g'), shape('b', 'g'), shape('c'), shape('d')];
  doc.layers = Object.fromEntries(layers.map((l) => [l.id, l]));
  doc.slides[sid].layerOrder = layers.map((l) => l.id);
  const second = 'second';
  doc.slides[second] = { id: second, background: { kind: 'solid', color: '#fff' }, layerOrder: ['e'] };
  doc.slideOrder.push(second);
  doc.layers.e = shape('e');
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null });
  useEditorSession.getState().resetSelection(sid);
});

describe('canvas selection', () => {
  it('selects a whole group from any member', () => {
    pickLayer('b', false);
    expect(selection()).toEqual(['a', 'b']);
    expect(useEditorSession.getState().selectedLayerId).toBe('b');
  });

  it('adds and removes whole groups with a modifier', () => {
    pickLayer('c', false);
    pickLayer('a', true);
    expect(selection()).toEqual(['c', 'a', 'b']);
    pickLayer('b', true);
    expect(selection()).toEqual(['c']);
  });

  it('keeps the selection on pointer down so it can be dragged, and narrows on a plain click', () => {
    pickLayer('c', false);
    pickLayer('d', true);
    expect(clickWouldNarrow('d')).toBe(true);
    pickLayer('d', false);
    expect(selection()).toEqual(['c', 'd']);
    narrowTo('d');
    expect(selection()).toEqual(['d']);
    expect(clickWouldNarrow('d')).toBe(false);
  });

  it('steps into a group, picks single members there, and Esc climbs back out', () => {
    pickLayer('a', false);
    enterGroup('a');
    expect(selection()).toEqual(['a']);
    pickLayer('b', false);
    expect(selection()).toEqual(['b']);
    selectParent();
    expect(selection()).toEqual(['a', 'b']);
    selectParent();
    expect(selection()).toEqual([]);
  });

  it('replaces the selection when a modifier-click lands on another slide', () => {
    pickLayer('c', false);
    pickLayer('e', true);
    expect(selection()).toEqual(['e']);
    expect(useEditorSession.getState().selectedSlideId).toBe('second');
  });
});
