import { describe, expect, it } from 'vitest';
import type { ProjectDocumentV2, ShapeLayer } from '@/types';
import { expandToGroups, groupMemberIds, selectionSlideId, selectionUnits } from './selectors';

const shape = (id: string, x: number, groupId?: string): ShapeLayer => ({ id, kind: 'shape', name: id, x, y: 0, width: 10, height: 20, rotation: 0, opacity: 1, visible: true, locked: false, shape: 'rect', fill: '#000', stroke: '#fff', strokeWidth: 0, cornerRadius: 0, groupId });
const doc: ProjectDocumentV2 = { schemaVersion: 2, revision: 0, id: 'doc', name: 'Test', format: { name: 'Square', width: 100, height: 100 }, createdAt: 0, updatedAt: 0, slideOrder: ['one', 'two'], slides: { one: { id: 'one', background: { kind: 'transparent' }, layerOrder: ['a', 'b', 'c', 'd'] }, two: { id: 'two', background: { kind: 'transparent' }, layerOrder: ['e', 'f'] } }, layers: { a: shape('a', 0, 'group'), b: shape('b', 10), c: shape('c', 30, 'group'), d: shape('d', 50), e: shape('e', 0, 'group'), f: shape('f', 20, 'group') } };

describe('selectionSlideId', () => {
  it('finds the common slide, ignoring duplicates and missing ids', () => expect(selectionSlideId(doc, ['missing', 'c', 'a', 'a'])).toBe('one'));
  it('rejects cross-slide selections', () => expect(selectionSlideId(doc, ['a', 'e'])).toBeUndefined());
  it('returns undefined when no ids exist', () => { expect(selectionSlideId(doc, [])).toBeUndefined(); expect(selectionSlideId(doc, ['missing'])).toBeUndefined(); });
});
describe('group expansion', () => {
  it('deduplicates and returns z-order including group mates', () => expect(expandToGroups(doc, ['d', 'c', 'c', 'missing'])).toEqual(['a', 'c', 'd']));
  it('keeps groups slide-local even with reused group ids', () => expect(expandToGroups(doc, ['a'])).toEqual(['a', 'c']));
  it('expands selections on multiple slides in document order', () => expect(expandToGroups(doc, ['f', 'c'])).toEqual(['a', 'c', 'e', 'f']));
  it('returns all group members including the requested layer', () => expect(groupMemberIds(doc, 'c')).toEqual(['a', 'c']));
  it('returns an ungrouped layer alone and skips missing layers', () => { expect(groupMemberIds(doc, 'b')).toEqual(['b']); expect(groupMemberIds(doc, 'missing')).toEqual([]); });
});
describe('selectionUnits', () => {
  it('combines groups while keeping ungrouped layers separate', () => expect(selectionUnits(doc, ['c', 'b', 'd'])).toEqual([{ ids: ['a', 'c'], bounds: { x: 0, y: 0, width: 40, height: 20 } }, { ids: ['b'], bounds: { x: 10, y: 0, width: 10, height: 20 } }, { ids: ['d'], bounds: { x: 50, y: 0, width: 10, height: 20 } }]));
  it('uses rotated bounds for units', () => {
    const result = selectionUnits({ ...doc, layers: { ...doc.layers, b: { ...doc.layers.b, rotation: 90 } } }, ['b'])[0].bounds;
    expect(result.x).toBeCloseTo(5); expect(result.y).toBeCloseTo(5); expect(result.width).toBeCloseTo(20); expect(result.height).toBeCloseTo(10);
  });
  it('does not combine groups across slides', () => expect(selectionUnits(doc, ['a', 'e']).map((unit) => unit.ids)).toEqual([['a', 'c'], ['e', 'f']]));
  it('returns no units for missing ids', () => expect(selectionUnits(doc, ['missing'])).toEqual([]));
});
