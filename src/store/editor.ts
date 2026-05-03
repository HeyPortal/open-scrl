import { create } from 'zustand';
import { produce } from 'immer';
import { get as idbGet, set as idbSet, createStore as createIdbStore } from 'idb-keyval';
import type {
  Background,
  Document,
  Format,
  ImageLayer,
  Layer,
  ShapeLayer,
  Slide,
  TextLayer,
} from '@/types';
import { id } from '@/lib/nano';
import { DEFAULT_FORMAT } from '@/lib/format';
import type { GridTemplate } from '@/lib/grids';

const docStore = createIdbStore('open-scrl', 'documents');
const DOC_KEY = 'current';
const PROJECT_INDEX_KEY = 'projectIndex';
const ACTIVE_PROJECT_KEY = 'activeProjectId';
const projectDocKey = (projectId: string) => `project:${projectId}`;
const HISTORY_LIMIT = 80;

const newSlide = (bg: Background = { kind: 'solid', color: '#ffffff' }): Slide => ({
  id: id(),
  background: bg,
  layers: [],
});

export const newDocument = (format: Format = DEFAULT_FORMAT, name = 'Untitled'): Document => {
  const now = Date.now();
  return {
    id: id(),
    name,
    format,
    slides: [newSlide()],
    createdAt: now,
    updatedAt: now,
  };
};

export type LeftPanel =
  | 'templates'
  | 'photos'
  | 'text'
  | 'shapes'
  | 'background'
  | 'export';

export interface ProjectSummary {
  id: string;
  name: string;
  format: Format;
  slideCount: number;
  createdAt: number;
  updatedAt: number;
}

interface EditorState {
  doc: Document;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  selectedSlideId: string;
  selectedLayerId: string | null;
  zoom: number;
  panOffset: { x: number; y: number };
  leftPanel: LeftPanel;
  past: Document[];
  future: Document[];
  ready: boolean;

  setLeftPanel: (p: LeftPanel) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;

  selectSlide: (slideId: string) => void;
  selectLayer: (layerId: string | null) => void;

  loadFromDisk: () => Promise<void>;
  saveToDisk: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  closeProject: () => Promise<void>;
  newProject: (format?: Format, name?: string) => Promise<void>;
  setFormat: (f: Format) => void;
  setDocName: (n: string) => void;

  addSlide: (afterSlideId?: string) => void;
  deleteSlide: (slideId: string) => void;
  duplicateSlide: (slideId: string) => void;
  moveSlide: (from: number, to: number) => void;

  addImageLayer: (assetId: string, dim: { width: number; height: number }) => void;
  addTextLayer: (text?: string) => void;
  addShapeLayer: (shape: 'rect' | 'ellipse') => void;
  applyGrid: (template: GridTemplate, gap: number) => void;

  updateLayer: (layerId: string, patch: Partial<Layer>) => void;
  updateLayers: (patches: { id: string; patch: Partial<Layer> }[]) => void;
  deleteLayer: (layerId: string) => void;
  duplicateLayer: (layerId: string) => void;
  reorderLayer: (layerId: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  toggleVisible: (layerId: string) => void;
  toggleLocked: (layerId: string) => void;
  renameLayer: (layerId: string, name: string) => void;

  setBackground: (bg: Background) => void;

  undo: () => void;
  redo: () => void;
}

const mutate = (
  state: EditorState,
  recipe: (doc: Document) => void,
  options: { history?: boolean } = { history: true },
): Partial<EditorState> => {
  const next = produce(state.doc, (d) => {
    recipe(d);
    d.updatedAt = Date.now();
  });
  if (next === state.doc) return {};
  const base: Partial<EditorState> = { doc: next };
  if (options.history) {
    base.past = [...state.past.slice(-HISTORY_LIMIT + 1), state.doc];
    base.future = [];
  }
  return base;
};

const findSlide = (doc: Document, slideId: string) => doc.slides.find((s) => s.id === slideId);

const findActiveSlide = (doc: Document, selectedSlideId: string) => {
  return findSlide(doc, selectedSlideId) ?? doc.slides[0];
};

const summarizeProject = (doc: Document): ProjectSummary => ({
  id: doc.id,
  name: doc.name,
  format: doc.format,
  slideCount: doc.slides.length,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const sortProjects = (projects: ProjectSummary[]) =>
  [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

const saveProjectIndex = async (projects: ProjectSummary[]) => {
  await idbSet(PROJECT_INDEX_KEY, sortProjects(projects), docStore);
};

export const useEditor = create<EditorState>((set, get) => ({
  doc: newDocument(),
  projects: [],
  activeProjectId: null,
  selectedSlideId: '',
  selectedLayerId: null,
  zoom: 0.5,
  panOffset: { x: 0, y: 0 },
  leftPanel: 'photos',
  past: [],
  future: [],
  ready: false,

  setLeftPanel: (p) => set({ leftPanel: p }),
  setZoom: (z) => set({ zoom: Math.max(0.05, Math.min(4, z)) }),
  setPan: (p) => set({ panOffset: p }),

  selectSlide: (slideId) => set({ selectedSlideId: slideId, selectedLayerId: null }),
  selectLayer: (layerId) => set({ selectedLayerId: layerId }),

  loadFromDisk: async () => {
    let projects = await idbGet<ProjectSummary[]>(PROJECT_INDEX_KEY, docStore);
    const legacy = await idbGet<Document>(DOC_KEY, docStore);

    if ((!projects || projects.length === 0) && legacy) {
      const migrated = summarizeProject(legacy);
      projects = [migrated];
      await idbSet(projectDocKey(legacy.id), legacy, docStore);
      await saveProjectIndex(projects);
    }

    set({
      projects: sortProjects(projects ?? []),
      activeProjectId: null,
      selectedSlideId: '',
      selectedLayerId: null,
      past: [],
      future: [],
      ready: true,
    });
  },

  saveToDisk: async () => {
    const { activeProjectId, doc, projects } = get();
    if (!activeProjectId) return;

    const projectDoc = doc;
    const nextProjects = sortProjects([
      summarizeProject(projectDoc),
      ...projects.filter((p) => p.id !== activeProjectId),
    ]);

    set({ projects: nextProjects });
    await idbSet(projectDocKey(activeProjectId), projectDoc, docStore);
    await idbSet(DOC_KEY, projectDoc, docStore);
    await idbSet(ACTIVE_PROJECT_KEY, activeProjectId, docStore);
    await saveProjectIndex(nextProjects);
  },

  openProject: async (projectId) => {
    const currentId = get().activeProjectId;
    if (currentId) await get().saveToDisk();

    const saved = await idbGet<Document>(projectDocKey(projectId), docStore);
    if (!saved) return;

    set({
      doc: saved,
      activeProjectId: saved.id,
      selectedSlideId: saved.slides[0]?.id ?? '',
      selectedLayerId: null,
      past: [],
      future: [],
    });
  },

  closeProject: async () => {
    if (get().activeProjectId) await get().saveToDisk();
    set({
      activeProjectId: null,
      selectedSlideId: '',
      selectedLayerId: null,
      past: [],
      future: [],
    });
  },

  newProject: async (format = DEFAULT_FORMAT, name = 'Untitled') => {
    if (get().activeProjectId) await get().saveToDisk();

    const fresh = newDocument(format, name.trim() || 'Untitled');
    const nextProjects = sortProjects([
      summarizeProject(fresh),
      ...get().projects.filter((p) => p.id !== fresh.id),
    ]);

    set({
      doc: fresh,
      projects: nextProjects,
      activeProjectId: fresh.id,
      selectedSlideId: fresh.slides[0].id,
      selectedLayerId: null,
      past: [],
      future: [],
    });

    await idbSet(projectDocKey(fresh.id), fresh, docStore);
    await idbSet(DOC_KEY, fresh, docStore);
    await idbSet(ACTIVE_PROJECT_KEY, fresh.id, docStore);
    await saveProjectIndex(nextProjects);
  },

  setFormat: (f) =>
    set((s) => mutate(s, (d) => {
      d.format = f;
    })),

  setDocName: (n) =>
    set((s) => mutate(s, (d) => {
      d.name = n;
    }, { history: false })),

  addSlide: (afterSlideId) =>
    set((s) => {
      const slide = newSlide();
      return {
        ...mutate(s, (d) => {
          if (afterSlideId) {
            const idx = d.slides.findIndex((sl) => sl.id === afterSlideId);
            d.slides.splice(idx + 1, 0, slide);
            return;
          }
          d.slides.push(slide);
        }),
        selectedSlideId: slide.id,
        selectedLayerId: null,
      };
    }),

  deleteSlide: (slideId) =>
    set((s) => {
      if (s.doc.slides.length <= 1) return {};
      const idx = s.doc.slides.findIndex((sl) => sl.id === slideId);
      const next = mutate(s, (d) => {
        d.slides.splice(idx, 1);
      });
      const updatedDoc = next.doc as Document;
      const newSelected =
        updatedDoc.slides[Math.min(idx, updatedDoc.slides.length - 1)]?.id ?? '';
      return { ...next, selectedSlideId: newSelected, selectedLayerId: null };
    }),

  duplicateSlide: (slideId) =>
    set((s) => {
      const original = s.doc.slides.find((sl) => sl.id === slideId);
      if (!original) return {};
      const clone: Slide = {
        ...original,
        id: id(),
        layers: original.layers.map((l) => ({ ...l, id: id() })),
      };
      const next = mutate(s, (d) => {
        const idx = d.slides.findIndex((sl) => sl.id === slideId);
        d.slides.splice(idx + 1, 0, clone);
      });
      return { ...next, selectedSlideId: clone.id, selectedLayerId: null };
    }),

  moveSlide: (from, to) =>
    set((s) => mutate(s, (d) => {
      if (from < 0 || from >= d.slides.length) return;
      if (to < 0 || to >= d.slides.length) return;
      const [m] = d.slides.splice(from, 1);
      d.slides.splice(to, 0, m);
    })),

  addImageLayer: (assetId, dim) =>
    set((s) => {
      const slide = findActiveSlide(s.doc, s.selectedSlideId);
      const fmt = s.doc.format;
      const ratio = dim.width / dim.height;
      let w = fmt.width * 0.7;
      let h = w / ratio;
      if (h > fmt.height * 0.7) {
        h = fmt.height * 0.7;
        w = h * ratio;
      }
      const layer: ImageLayer = {
        id: id(),
        kind: 'image',
        name: 'Photo',
        x: (fmt.width - w) / 2,
        y: (fmt.height - h) / 2,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId,
        cornerRadius: 0,
        cropOffsetX: 0,
        cropOffsetY: 0,
        cropScale: 1,
      };
      const next = mutate(s, (d) => {
        const sl = d.slides.find((x) => x.id === slide.id)!;
        sl.layers.push(layer);
      });
      return { ...next, selectedLayerId: layer.id };
    }),

  addTextLayer: (text = 'Double-click to edit') =>
    set((s) => {
      const slide = findActiveSlide(s.doc, s.selectedSlideId);
      const fmt = s.doc.format;
      const layer: TextLayer = {
        id: id(),
        kind: 'text',
        name: 'Text',
        x: fmt.width * 0.1,
        y: fmt.height * 0.4,
        width: fmt.width * 0.8,
        height: 200,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text,
        fontFamily: 'Inter',
        fontSize: 96,
        fontWeight: 700,
        italic: false,
        fill: '#111111',
        align: 'center',
        letterSpacing: 0,
        lineHeight: 1.15,
      };
      const next = mutate(s, (d) => {
        const sl = d.slides.find((x) => x.id === slide.id)!;
        sl.layers.push(layer);
      });
      return { ...next, selectedLayerId: layer.id };
    }),

  addShapeLayer: (shape) =>
    set((s) => {
      const slide = findActiveSlide(s.doc, s.selectedSlideId);
      const fmt = s.doc.format;
      const w = fmt.width * 0.4;
      const h = fmt.height * 0.3;
      const layer: ShapeLayer = {
        id: id(),
        kind: 'shape',
        name: shape === 'rect' ? 'Rectangle' : 'Ellipse',
        x: (fmt.width - w) / 2,
        y: (fmt.height - h) / 2,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        shape,
        fill: '#7c5cff',
        stroke: 'transparent',
        strokeWidth: 0,
        cornerRadius: shape === 'rect' ? 24 : 0,
      };
      const next = mutate(s, (d) => {
        const sl = d.slides.find((x) => x.id === slide.id)!;
        sl.layers.push(layer);
      });
      return { ...next, selectedLayerId: layer.id };
    }),

  applyGrid: (template, gap) =>
    set((s) => {
      const slide = findActiveSlide(s.doc, s.selectedSlideId);
      const fmt = s.doc.format;
      const cells = template.cells(fmt.width, fmt.height, gap);
      const layers: ImageLayer[] = cells.map((c, i) => ({
        id: id(),
        kind: 'image',
        name: `Photo ${i + 1}`,
        x: c.x,
        y: c.y,
        width: c.w,
        height: c.h,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: true,
        assetId: null,
        cornerRadius: 0,
        cropOffsetX: 0,
        cropOffsetY: 0,
        cropScale: 1,
      }));
      const next = mutate(s, (d) => {
        const sl = d.slides.find((x) => x.id === slide.id)!;
        sl.layers = layers;
      });
      return { ...next, selectedLayerId: null };
    }),

  updateLayer: (layerId, patch) =>
    set((s) => mutate(s, (d) => {
      for (const sl of d.slides) {
        const idx = sl.layers.findIndex((l) => l.id === layerId);
        if (idx >= 0) {
          sl.layers[idx] = { ...sl.layers[idx], ...patch } as Layer;
          return;
        }
      }
    }, { history: true })),

  updateLayers: (patches) =>
    set((s) => mutate(s, (d) => {
      const m = new Map(patches.map((p) => [p.id, p.patch]));
      for (const sl of d.slides) {
        for (let i = 0; i < sl.layers.length; i++) {
          const p = m.get(sl.layers[i].id);
          if (p) sl.layers[i] = { ...sl.layers[i], ...p } as Layer;
        }
      }
    })),

  deleteLayer: (layerId) =>
    set((s) => {
      const next = mutate(s, (d) => {
        for (const sl of d.slides) {
          const idx = sl.layers.findIndex((l) => l.id === layerId);
          if (idx >= 0) {
            sl.layers.splice(idx, 1);
            return;
          }
        }
      });
      return { ...next, selectedLayerId: null };
    }),

  duplicateLayer: (layerId) =>
    set((s) => {
      let newId = '';
      const next = mutate(s, (d) => {
        for (const sl of d.slides) {
          const idx = sl.layers.findIndex((l) => l.id === layerId);
          if (idx >= 0) {
            const orig = sl.layers[idx];
            newId = id();
            const clone: Layer = {
              ...orig,
              id: newId,
              x: orig.x + 24,
              y: orig.y + 24,
              name: `${orig.name} copy`,
            };
            sl.layers.splice(idx + 1, 0, clone);
            return;
          }
        }
      });
      return { ...next, selectedLayerId: newId || s.selectedLayerId };
    }),

  reorderLayer: (layerId, dir) =>
    set((s) => mutate(s, (d) => {
      for (const sl of d.slides) {
        const idx = sl.layers.findIndex((l) => l.id === layerId);
        if (idx < 0) continue;
        const [layer] = sl.layers.splice(idx, 1);
        if (dir === 'up') sl.layers.splice(Math.min(idx + 1, sl.layers.length), 0, layer);
        else if (dir === 'down') sl.layers.splice(Math.max(idx - 1, 0), 0, layer);
        else if (dir === 'top') sl.layers.push(layer);
        else if (dir === 'bottom') sl.layers.unshift(layer);
        return;
      }
    })),

  toggleVisible: (layerId) =>
    set((s) => mutate(s, (d) => {
      for (const sl of d.slides) {
        const layer = sl.layers.find((l) => l.id === layerId);
        if (layer) {
          layer.visible = !layer.visible;
          return;
        }
      }
    })),

  toggleLocked: (layerId) =>
    set((s) => mutate(s, (d) => {
      for (const sl of d.slides) {
        const layer = sl.layers.find((l) => l.id === layerId);
        if (layer) {
          layer.locked = !layer.locked;
          return;
        }
      }
    })),

  renameLayer: (layerId, name) =>
    set((s) => mutate(s, (d) => {
      for (const sl of d.slides) {
        const layer = sl.layers.find((l) => l.id === layerId);
        if (layer) {
          layer.name = name;
          return;
        }
      }
    }, { history: false })),

  setBackground: (bg) =>
    set((s) => mutate(s, (d) => {
      const sl = d.slides.find((x) => x.id === s.selectedSlideId);
      if (sl) sl.background = bg;
    })),

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const previous = s.past[s.past.length - 1];
      return {
        doc: previous,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT),
      };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0];
      return {
        doc: next,
        past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
      };
    }),
}));

export const selectActiveSlide = (s: EditorState): Slide | undefined =>
  s.doc.slides.find((sl) => sl.id === s.selectedSlideId) ?? s.doc.slides[0];

export const selectActiveLayer = (s: EditorState): Layer | undefined => {
  if (!s.selectedLayerId) return undefined;
  for (const sl of s.doc.slides) {
    const l = sl.layers.find((x) => x.id === s.selectedLayerId);
    if (l) return l;
  }
  return undefined;
};
