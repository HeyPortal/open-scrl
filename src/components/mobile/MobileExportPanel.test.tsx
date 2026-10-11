import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { useEditorView } from '@/editor/viewStore';
import { DEFAULT_EXPORT_SETTINGS, useExport } from '@/editor/exportStore';
import { inspectSlideVideo } from '@/export/video';
import { MobileExportPanel } from './MobileExportPanel';

vi.mock('@/lib/export', () => ({ exportInstagramCarousel: vi.fn(), exportSlide: vi.fn() }));
// Actual panorama pixels are covered in e2e/export.spec.ts.
vi.mock('@/components/SlidePreviewCanvas', () => ({ SlidePreviewCanvas: () => null }));
vi.mock('@/export/video', () => ({ inspectSlideVideo: vi.fn() }));
const exportCarousel = vi.fn(async () => undefined);
const exportCurrentSlide = vi.fn(async () => undefined);
const cancel = vi.fn();
const inspect = vi.mocked(inspectSlideVideo);

beforeEach(() => {
  const doc = newDocument({ name: 'Trip', width: 1080, height: 1350 });
  useDocumentStore.setState({ doc, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().selectSlide(doc.slideOrder[0]);
  useEditorView.setState({ previewOpen: false });
  vi.clearAllMocks();
  inspect.mockResolvedValue({ animated: false, duration: 3 });
  useExport.setState({ exporting: false, cancelling: false, progress: '', fraction: null, error: null, outcome: 'idle', settings: DEFAULT_EXPORT_SETTINGS, exportCarousel, exportCurrentSlide, cancel });
});
afterEach(cleanup);
const ready = async () => { await waitFor(() => expect(screen.getByRole('button', { name: 'Export carousel' })).toBeEnabled()); };

describe('shared web export controls in the phone sheet', () => {
  it('passes JPEG quality and resolution into both carousel and current-slide jobs', async () => {
    render(<MobileExportPanel onDone={vi.fn()} />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    fireEvent.click(screen.getByRole('radio', { name: '2×' }));
    fireEvent.change(screen.getByRole('slider', { name: /JPEG quality/ }), { target: { value: '80' } });
    expect(screen.getByText(/2160 × 2700/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export carousel' }));
    expect(exportCarousel).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', quality: .8, pixelRatio: 2, slideIndexes: [0] }));
    fireEvent.click(screen.getByRole('radio', { name: 'This slide' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save this slide' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save this slide' }));
    expect(exportCurrentSlide).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', quality: .8, pixelRatio: 2 }));
    expect(useDocumentStore.getState().doc.format).toMatchObject({ width: 1080, height: 1350 });
  });

  it('requires a selected slide and preserves its original index', async () => {
    useDocumentStore.getState().addSlide();
    render(<MobileExportPanel onDone={vi.fn()} />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Choose slides' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Export selected slides' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Slide 2' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export selected slides' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export selected slides' }));
    expect(exportCarousel).toHaveBeenCalledWith(expect.objectContaining({ slideIndexes: [1] }));
  });

  it('lets animations become still frames and enables image options for that output', async () => {
    inspect.mockResolvedValue({ animated: true, duration: 3 });
    render(<MobileExportPanel onDone={vi.fn()} />);
    await ready();
    expect(screen.getByRole('radio', { name: '2×' })).toBeDisabled();
    expect(screen.getByText('1 MP4 video · 1080 × 1350 px')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Still' }));
    expect(screen.getByRole('radio', { name: '2×' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Export carousel' }));
    expect(exportCarousel).toHaveBeenCalledWith(expect.objectContaining({ animation: 'still' }));
  });

  it('opens the phone preview and closes the sheet', () => {
    const onDone = vi.fn();
    render(<MobileExportPanel onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview on phone' }));
    expect(useEditorView.getState().previewOpen).toBe(true);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('keeps cancellation available while export settings are locked', () => {
    useExport.setState({ exporting: true, progress: 'Slide 2/4 · image', fraction: .25 });
    render(<MobileExportPanel onDone={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Slide 2/4 · image');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'This slide' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('offers retry when media inspection fails', async () => {
    inspect.mockRejectedValueOnce(new Error('Unreadable media'));
    render(<MobileExportPanel onDone={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Export carousel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry check' }));
    await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
