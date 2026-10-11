import { create } from 'zustand';
import { exportInstagramCarousel, exportSlide, type ExportOptions } from '@/lib/export';
import { useToasts } from '@/store/toasts';
import { useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';
import { editorActivity } from './activity';

export type ExportSettings = Pick<ExportOptions, 'format' | 'quality' | 'pixelRatio' | 'animation'>;
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { format: 'png', quality: .92, pixelRatio: 1, animation: 'auto' };

interface ExportState {
  exporting: boolean;
  cancelling: boolean;
  progress: string;
  fraction: number | null;
  error: string | null;
  outcome: 'idle' | 'complete' | 'cancelled';
  settings: ExportSettings;
  setSettings: (settings: Partial<ExportSettings>) => void;
  cancel: () => void;
  exportCurrentSlide: (options?: Partial<ExportOptions>) => Promise<void>;
  exportCarousel: (options?: Partial<ExportOptions>) => Promise<void>;
}

let controller: AbortController | null = null;

export const useExport = create<ExportState>((set, get) => {
  const run = async (kind: 'slide' | 'carousel', options: Partial<ExportOptions> = {}) => {
    if (get().exporting) return;
    const doc = useDocumentStore.getState().doc;
    const index = Math.max(0, doc.slideOrder.indexOf(useEditorSession.getState().selectedSlideId));
    const job = new AbortController();
    controller = job;
    const releaseActivity = editorActivity.begin();
    set({ exporting: true, cancelling: false, progress: 'Preparing…', fraction: null, error: null, outcome: 'idle' });
    const report = (progress: string, fraction?: number) => {
      if (!job.signal.aborted) set({ progress, fraction: fraction ?? null });
    };
    try {
      const request = { ...options, signal: job.signal };
      if (kind === 'carousel') await exportInstagramCarousel(doc, report, request);
      else await exportSlide(doc, index, request, report);
      if (job.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      set({ outcome: 'complete' });
      useToasts.getState().addToast('Your download is ready.', 'success');
    } catch (error) {
      if (job.signal.aborted || (error instanceof Error && error.name === 'AbortError')) set({ outcome: 'cancelled' });
      else {
        const message = error instanceof Error ? error.message : 'Export failed. Please try again.';
        set({ error: message });
        useToasts.getState().addToast(message, 'error');
      }
    } finally {
      controller = null;
      set({ exporting: false, cancelling: false, progress: '', fraction: null });
      releaseActivity();
    }
  };
  return {
    exporting: false, cancelling: false, progress: '', fraction: null, error: null, outcome: 'idle',
    settings: DEFAULT_EXPORT_SETTINGS,
    setSettings: (settings) => set({ settings: { ...get().settings, ...settings } }),
    cancel: () => {
      if (!controller) return;
      set({ cancelling: true, progress: 'Cancelling…' });
      controller.abort();
    },
    exportCurrentSlide: (options) => run('slide', options),
    exportCarousel: (options) => run('carousel', options),
  };
});
