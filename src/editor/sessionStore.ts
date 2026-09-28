import { create } from 'zustand';

export type LeftPanel = 'templates' | 'photos' | 'text' | 'shapes' | 'background' | 'export';
export type SaveStatus = 'saved' | 'pending' | 'saving';
export type Overlay = 'palette' | 'shortcuts' | null;

interface SessionState {
  selectedSlideId: string;
  selectedLayerId: string | null;
  slideFocusRequest: number;
  zoom: number;
  /** Zoom that fits one slide in the canvas viewport; published by the canvas. */
  fitZoom: number;
  scroll: { left: number; top: number };
  leftPanel: LeftPanel;
  leftPanelOpen: boolean;
  saveStatus: SaveStatus;
  overlay: Overlay;
  /** Incremented to ask the media panel to open its file picker. */
  importRequest: number;
  selectSlide: (id: string) => void;
  focusSlide: (id: string) => void;
  selectLayer: (id: string | null) => void;
  resetSelection: (slideId?: string) => void;
  setZoom: (zoom: number) => void;
  setFitZoom: (zoom: number) => void;
  setScroll: (scroll: { left: number; top: number }) => void;
  setLeftPanel: (panel: LeftPanel) => void;
  setLeftPanelOpen: (open: boolean) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setOverlay: (overlay: Overlay) => void;
  requestImport: () => void;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export const useEditorSession = create<SessionState>((set) => ({
  selectedSlideId: '',
  selectedLayerId: null,
  slideFocusRequest: 0,
  zoom: 0.5,
  fitZoom: 0.5,
  scroll: { left: 0, top: 0 },
  leftPanel: 'photos',
  leftPanelOpen: true,
  saveStatus: 'saved',
  overlay: null,
  importRequest: 0,
  selectSlide: (selectedSlideId) => set({ selectedSlideId, selectedLayerId: null }),
  focusSlide: (selectedSlideId) => set((state) => ({
    selectedSlideId,
    selectedLayerId: null,
    slideFocusRequest: state.slideFocusRequest + 1,
  })),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  resetSelection: (selectedSlideId = '') => set({ selectedSlideId, selectedLayerId: null }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setFitZoom: (fitZoom) => set({ fitZoom: clampZoom(fitZoom) }),
  setScroll: (scroll) => set({ scroll }),
  setLeftPanel: (leftPanel) => set({ leftPanel, leftPanelOpen: true }),
  setLeftPanelOpen: (leftPanelOpen) => set({ leftPanelOpen }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  setOverlay: (overlay) => set({ overlay }),
  requestImport: () => set((state) => ({ leftPanel: 'photos', leftPanelOpen: true, importRequest: state.importRequest + 1 })),
}));
