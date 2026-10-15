import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorSession } from './sessionStore';

const session = () => useEditorSession.getState();
beforeEach(() => session().resetSelection());
describe('multi-selection session', () => {
  it('keeps the legacy selection API synchronized', () => {
    session().selectLayer('a'); expect(session()).toMatchObject({ selectedLayerId: 'a', selectedLayerIds: ['a'] });
    session().selectLayer(null); expect(session()).toMatchObject({ selectedLayerId: null, selectedLayerIds: [] });
  });
  it('deduplicates and defaults the primary to the last input id', () => { session().selectLayers(['a', 'b', 'a']); expect(session()).toMatchObject({ selectedLayerIds: ['a', 'b'], selectedLayerId: 'a' }); });
  it('accepts an explicit primary, with a safe fallback for invalid ids', () => {
    session().selectLayers(['a', 'b'], 'a'); expect(session().selectedLayerId).toBe('a');
    session().selectLayers(['a', 'b'], 'missing'); expect(session().selectedLayerId).toBe('b');
  });
  it('allows an explicit null primary without violating membership', () => { session().selectLayers(['a', 'b'], null); expect(session()).toMatchObject({ selectedLayerId: null, selectedLayerIds: ['a', 'b'] }); });
  it('clears an empty selection', () => { session().selectLayers(['a']); session().selectLayers([]); expect(session()).toMatchObject({ selectedLayerId: null, selectedLayerIds: [] }); });
  it.each(['selectSlide', 'focusSlide', 'resetSelection'] as const)('%s clears every selected layer', (action) => {
    session().selectLayers(['a', 'b']); const before = session().slideFocusRequest;
    session()[action]('slide'); expect(session()).toMatchObject({ selectedSlideId: 'slide', selectedLayerId: null, selectedLayerIds: [] });
    expect(session().slideFocusRequest).toBe(before + (action === 'focusSlide' ? 1 : 0));
  });
});

describe('media library view', () => {
  beforeEach(() => { session().setMediaSort('none'); session().clearMediaFilters(); });
  it('defaults to import order with no shape filter', () => { expect(session()).toMatchObject({ mediaSort: 'none', mediaShapes: [] }); });
  it('toggles shapes independently and keeps them in a stable order', () => {
    session().toggleMediaShape('horizontal'); session().toggleMediaShape('square');
    expect(session().mediaShapes).toEqual(['square', 'horizontal']);
    session().toggleMediaShape('square');
    expect(session().mediaShapes).toEqual(['horizontal']);
  });
  it('clears filters without touching the sort', () => {
    session().setMediaSort('type'); session().toggleMediaShape('vertical'); session().clearMediaFilters();
    expect(session()).toMatchObject({ mediaSort: 'type', mediaShapes: [] });
  });
});
