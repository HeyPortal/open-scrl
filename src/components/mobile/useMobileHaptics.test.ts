import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { useExport } from '@/editor/exportStore';
import { mobileHaptic, startMobileHaptics } from '@/lib/mobileHaptics';
import { useMobileHaptics } from './useMobileHaptics';

const stop = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mobileHaptics', () => ({ mobileHaptic: vi.fn(), startMobileHaptics: vi.fn(() => stop) }));
vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  const doc = newDocument();
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().resetSelection(doc.slideOrder[0]);
  useExport.setState({ exporting: false, outcome: 'idle', error: null });
});
afterEach(cleanup);
const cues = () => vi.mocked(mobileHaptic).mock.calls.map(([kind]) => kind);

describe('mobile editor feedback routing', () => {
  it('starts quietly and detaches all observers on unmount', () => {
    const { unmount } = renderHook(useMobileHaptics);
    expect(startMobileHaptics).toHaveBeenCalledTimes(1);
    expect(cues()).toEqual([]);
    unmount();
    useDocumentStore.getState().addSlide();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(cues()).toEqual([]);
  });

  it('confirms edits, distinguishes deletion and history, and ignores no-ops', () => {
    renderHook(useMobileHaptics);
    act(() => useDocumentStore.getState().addSlide());
    expect(cues()[0]).toBe('confirm');
    vi.mocked(mobileHaptic).mockClear();
    act(() => useDocumentStore.getState().deleteSlide(useEditorSession.getState().selectedSlideId));
    expect(cues()[0]).toBe('delete');
    vi.mocked(mobileHaptic).mockClear();
    act(() => { useDocumentStore.getState().undo(); useDocumentStore.getState().redo(); });
    expect(cues()).toEqual(['history', 'history']);
    vi.mocked(mobileHaptic).mockClear();
    act(() => useDocumentStore.getState().deleteSlide(useEditorSession.getState().selectedSlideId));
    expect(cues()).toEqual([]);
  });

  it('leaves typing, sliders, transaction previews and cancellations quiet', () => {
    useDocumentStore.getState().addShapeLayer('rect');
    renderHook(useMobileHaptics);
    const store = useDocumentStore.getState();
    const id = useEditorSession.getState().selectedLayerId!;
    act(() => {
      store.setDocName('Typing');
      store.updateLayer(id, { opacity: .6 });
      const tx = store.beginTransaction('Move layers');
      store.moveLayers([id], 10, 10);
      store.cancelTransaction(tx);
    });
    expect(cues()).toEqual([]);
  });

  it('confirms a discrete transaction once after commit, and not when read-only', () => {
    renderHook(useMobileHaptics);
    const store = useDocumentStore.getState();
    const tx = store.beginTransaction('Add slide');
    act(() => store.addSlide());
    // Selecting the added slide may tick, but it is not a committed change yet.
    expect(cues()).not.toContain('confirm');
    vi.mocked(mobileHaptic).mockClear();
    act(() => store.commitTransaction(tx));
    expect(cues()).toEqual(['confirm']);
    vi.mocked(mobileHaptic).mockClear();
    useDocumentStore.setState({ readOnlyError: 'Read-only' });
    act(() => store.addSlide());
    expect(cues()).not.toContain('confirm');
  });

  it('ticks for changed selection, without repeating a selected layer or buzzing on deselection', () => {
    useDocumentStore.getState().addShapeLayer('rect');
    const id = useEditorSession.getState().selectedLayerId!;
    useEditorSession.getState().selectLayer(null);
    renderHook(useMobileHaptics);
    act(() => { useEditorSession.getState().selectLayer(id); useEditorSession.getState().selectLayer(id); useEditorSession.getState().selectLayer(null); });
    expect(cues()).toEqual(['selection']);
  });

  it('confirms lock changes from selection actions that replace entire layer records', () => {
    useDocumentStore.getState().addShapeLayer('rect');
    const id = useEditorSession.getState().selectedLayerId!;
    renderHook(useMobileHaptics);
    act(() => useDocumentStore.getState().updateLayers([{ id, patch: { locked: true } }]));
    expect(cues()).toEqual(['confirm']);
    vi.mocked(mobileHaptic).mockClear();
    act(() => useDocumentStore.getState().updateLayers([{ id, patch: { opacity: .4 } }]));
    expect(cues()).toEqual([]);
  });

  it('keeps project loads quiet and distinguishes export completion, failure and cancellation', () => {
    renderHook(useMobileHaptics);
    const doc = newDocument();
    act(() => { useDocumentStore.setState({ doc, past: [], future: [] }); useEditorSession.getState().resetSelection(doc.slideOrder[0]); });
    expect(cues()).toEqual([]);
    act(() => { useExport.setState({ exporting: true }); useExport.setState({ outcome: 'complete' }); useExport.setState({ exporting: false }); });
    expect(cues()).toEqual(['confirm', 'success']);
    vi.mocked(mobileHaptic).mockClear();
    act(() => { useExport.setState({ exporting: true, outcome: 'idle' }); useExport.setState({ error: 'Failed' }); useExport.setState({ exporting: false }); });
    expect(cues()).toEqual(['confirm', 'error']);
    vi.mocked(mobileHaptic).mockClear();
    act(() => { useExport.setState({ exporting: true, error: null, outcome: 'idle' }); useExport.setState({ exporting: false, outcome: 'cancelled' }); });
    expect(cues()).toEqual(['confirm']);
  });
});
