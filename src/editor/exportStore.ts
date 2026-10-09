import { create } from 'zustand';
import { exportInstagramCarousel, exportSlide } from '@/lib/export';
import { useToasts } from '@/store/toasts';
import { useDocumentStore } from './documentStore';
import { useEditorSession } from './sessionStore';
import { editorActivity } from './activity';

interface ExportState {
  exporting: boolean;
  progress: string;
  exportCurrentSlide: () => Promise<void>;
  exportCarousel: () => Promise<void>;
}

export const useExport = create<ExportState>((set, get) => ({
  exporting: false,
  progress: '',
  exportCurrentSlide: async () => {
    if (get().exporting) return;
    const doc = useDocumentStore.getState().doc;
    const index = Math.max(0, doc.slideOrder.indexOf(useEditorSession.getState().selectedSlideId));
    const releaseActivity = editorActivity.begin();
    set({ exporting: true });
    try {
      await exportSlide(doc, index);
    } finally {
      set({ exporting: false });
      releaseActivity();
    }
  },
  exportCarousel: async () => {
    if (get().exporting) return;
    const doc = useDocumentStore.getState().doc;
    const addToast = useToasts.getState().addToast;
    const releaseActivity = editorActivity.begin();
    set({ exporting: true, progress: 'Preparing…' });
    try {
      await exportInstagramCarousel(doc, (progress) => set({ progress }));
      addToast('Instagram carousel export finished.', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Carousel export failed.', 'error');
    } finally {
      set({ exporting: false, progress: '' });
      releaseActivity();
    }
  },
}));
