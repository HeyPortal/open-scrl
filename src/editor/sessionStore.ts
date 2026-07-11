import { create } from 'zustand';

export type LeftPanel = 'templates' | 'photos' | 'text' | 'shapes' | 'background' | 'export';

interface SessionState {
  selectedSlideId: string;
  selectedLayerId: string | null;
  zoom: number;
  scroll: { left: number; top: number };
  leftPanel: LeftPanel;
  selectSlide: (id: string) => void;
  selectLayer: (id: string | null) => void;
  resetSelection: (slideId?: string) => void;
  setZoom: (zoom: number) => void;
  setScroll: (scroll: { left: number; top: number }) => void;
  setLeftPanel: (panel: LeftPanel) => void;
}

export const useEditorSession = create<SessionState>((set) => ({
  selectedSlideId: '',
  selectedLayerId: null,
  zoom: 0.5,
  scroll: { left: 0, top: 0 },
  leftPanel: 'photos',
  selectSlide: (selectedSlideId) => set({ selectedSlideId, selectedLayerId: null }),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  resetSelection: (selectedSlideId = '') => set({ selectedSlideId, selectedLayerId: null }),
  setZoom: (zoom) => set({ zoom: Math.max(0.05, Math.min(4, zoom)) }),
  setScroll: (scroll) => set({ scroll }),
  setLeftPanel: (leftPanel) => set({ leftPanel }),
}));
