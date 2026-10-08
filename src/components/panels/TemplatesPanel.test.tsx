import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GRID_TEMPLATES, layoutGrid, linkedMax } from '@/lib/grids';
import { getLiveGrid } from '@/core/document/grid';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { TemplatesPanel } from './TemplatesPanel';

// The real module pulls in Konva, which needs a native canvas that jsdom doesn't have.
vi.mock('@/app/actions', () => ({ isMac: false }));

const landscape = { width: 1080, height: 566 };
const fourStack = GRID_TEMPLATES.find((t) => t.id === 'four-stack')!;

afterEach(cleanup);

beforeEach(() => {
  const doc = newDocument();
  useDocumentStore.setState({ doc: { ...doc, format: { ...doc.format, ...landscape } }, past: [], future: [], transaction: null, selectedSlideId: '' });
  useEditorSession.setState({ selectedSlideId: '', gridLinked: false });
});

describe('TemplatesPanel with linked spacing', () => {
  it('snaps a grid that already exists when linking is switched on', () => {
    useDocumentStore.getState().applyGrid(fourStack, 120, 0);
    render(<TemplatesPanel />);

    fireEvent.click(screen.getByRole('button', { name: /link gap and outer margin/i }));

    const { doc } = useDocumentStore.getState();
    expect(getLiveGrid(doc, doc.slideOrder[0])!.grid).toMatchObject({ gap: 100, margin: 100 });
  });

  it('stores a gap and margin the inspector can show when the template cannot fit the linked value', () => {
    render(<TemplatesPanel />);
    fireEvent.change(screen.getByLabelText(/gap between photos/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /link gap and outer margin/i }));
    // 120 px of gap and margin does not fit four stacked rows on a 566 px tall slide; the most that does is 100.
    expect(linkedMax(fourStack, landscape)).toBe(100);

    fireEvent.click(screen.getByTitle('Apply “4 stack” grid'));

    const { doc } = useDocumentStore.getState();
    const live = getLiveGrid(doc, doc.slideOrder[0])!;
    expect(live.grid).toMatchObject({ gap: 100, margin: 100 });
    const cells = layoutGrid(fourStack, landscape, 100, 100);
    live.grid.slotIds.forEach((id, i) => expect(doc.layers[id]).toMatchObject({ y: cells[i].y, height: cells[i].h }));
  });
});
