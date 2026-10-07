import { create } from 'zustand';

/** View-only editor state that isn't part of the document or selection. */
interface ViewState {
  previewOpen: boolean;
  /** Shows the carousel as one seamless strip: no slide chrome, gaps or headers. */
  wideMode: boolean;
  setPreviewOpen: (open: boolean) => void;
  setWideMode: (on: boolean) => void;
}

export const useEditorView = create<ViewState>((set) => ({
  previewOpen: false,
  wideMode: false,
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  setWideMode: (wideMode) => set({ wideMode }),
}));
