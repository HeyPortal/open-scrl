import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { useExport } from '@/editor/exportStore';
import { useToasts } from '@/store/toasts';
import { MobileExportPanel } from './MobileExportPanel';

// The export pipeline loads Konva's Node build; the panel only needs the store's behaviour.
vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));

const exportCarousel = vi.fn(async () => undefined);
const exportCurrentSlide = vi.fn(async () => undefined);

beforeEach(() => {
  const doc = newDocument({ name: 'Trip', width: 1080, height: 1350 });
  doc.format = { name: 'IG Portrait', width: 1080, height: 1350 };
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().selectSlide(doc.slideOrder[0]);
  useEditorView.setState({ previewOpen: false });
  useToasts.setState({ toasts: [] });
  exportCarousel.mockClear();
  exportCurrentSlide.mockClear();
  useExport.setState({ exporting: false, progress: '', exportCarousel, exportCurrentSlide });
});
afterEach(cleanup);

describe('MobileExportPanel', () => {
  it('summarises the project', () => {
    render(<MobileExportPanel onDone={vi.fn()} />);
    expect(screen.getByText('1 slide · IG Portrait · 1080×1350')).toBeInTheDocument();
  });

  it('exports the carousel and the current slide', async () => {
    render(<MobileExportPanel onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /export carousel/i }));
    expect(exportCarousel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /save this slide/i }));
    expect(exportCurrentSlide).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useToasts.getState().toasts.map((t) => t.kind)).toEqual(['success']));
  });

  it('opens the phone preview and closes the sheet', () => {
    const onDone = vi.fn();
    render(<MobileExportPanel onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /preview on phone/i }));
    expect(useEditorView.getState().previewOpen).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows progress and locks the other actions while a carousel exports', () => {
    useExport.setState({ exporting: true, progress: 'Slide 2/4 · image' });
    render(<MobileExportPanel onDone={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Slide 2/4 · image');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByRole('button', { name: /save this slide/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /preview on phone/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /export carousel/i }));
    expect(exportCarousel).not.toHaveBeenCalled();
  });

  it('locks the other actions while a single slide renders', () => {
    useExport.setState({ exporting: true, progress: '' });
    render(<MobileExportPanel onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: /export carousel/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /preview on phone/i })).toBeDisabled();
  });

  it('reports a failed slide export', async () => {
    exportCurrentSlide.mockRejectedValueOnce(new Error('Canvas too large'));
    render(<MobileExportPanel onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /save this slide/i }));
    await waitFor(() => expect(useToasts.getState().toasts[0]).toMatchObject({ kind: 'error', message: 'Canvas too large' }));
  });
});
