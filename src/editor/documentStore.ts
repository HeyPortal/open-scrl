import { applyPatches, enablePatches, produce, produceWithPatches, type Patch, type Draft } from 'immer';
import { create } from 'zustand';
import type { AssetMeta, Background, Bounds, Format, ImageLayer, Layer, ProjectDocumentV2, ShapeLayer, SlideRecord, TextLayer } from '@/types';
import { id } from '@/lib/nano';
import { DEFAULT_FORMAT } from '@/lib/format';
import { layoutGrid, type GridTemplate } from '@/lib/grids';
import { migrateDocument } from '@/core/document/migrations';
import { getLiveGrid, slotMatchesCell } from '@/core/document/grid';
import { command, type EditorCommand } from '@/core/document/commands';
import { getSlideLayers, materializeSlide, expandToGroups, groupMemberIds, selectionUnits } from '@/core/document/selectors';
import { scaleLayer, slideSpanFor, unionBounds, type AlignEdge, type DistributeAxis } from '@/core/document/geometry';
import { measureTextHeight } from '@/render/paint/text';
import { canSwapPhotoFrames, filledPhotoFrames, setFramePhoto, shuffledPhotoIds } from '@/core/document/photos';
import { listProjectSummaries, preserveLegacyBackup, readProject, writeProject, type StoredProjectSummary } from '@/storage/database';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { useEditorSession } from './sessionStore';

enablePatches();

const HISTORY_LIMIT = 80;
const HISTORY_BYTE_LIMIT = 32 * 1024 * 1024;
const MERGE_WINDOW_MS = 750;
let saveTail: Promise<void> = Promise.resolve();

export type { AlignEdge, DistributeAxis } from '@/core/document/geometry';
export type MediaSlideAsset = Pick<AssetMeta, 'id' | 'width' | 'height' | 'mediaKind'>;

export type LeftPanel = 'templates' | 'photos' | 'text' | 'shapes' | 'background' | 'export';
export type ProjectSummary = StoredProjectSummary;
export type TransactionId = string;

interface HistoryEntry {
  label: string;
  mergeKey?: string;
  at: number;
  patches: Patch[];
  inverse: Patch[];
  bytes: number;
}

interface ActiveTransaction {
  id: TransactionId;
  label: string;
  mergeKey?: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface EditorState {
  doc: ProjectDocumentV2;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  selectedSlideId: string;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  zoom: number;
  panOffset: { x: number; y: number };
  leftPanel: LeftPanel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  ready: boolean;
  readOnlyError: string | null;
  saveError: string | null;
  transaction: ActiveTransaction | null;

  setLeftPanel(p: LeftPanel): void;
  setZoom(z: number): void;
  setPan(p: { x: number; y: number }): void;
  selectSlide(id: string): void;
  selectLayer(id: string | null): void;
  selectLayers(ids: string[], primaryId?: string | null): void;
  selectAllLayers(): void;
  loadFromDisk(): Promise<void>;
  saveToDisk(): Promise<void>;
  openProject(id: string): Promise<void>;
  closeProject(): Promise<void>;
  newProject(format?: Format, name?: string): Promise<void>;
  setFormat(format: Format): void;
  setDocName(name: string): void;
  addSlide(after?: string): void;
  deleteSlide(id: string): void;
  duplicateSlide(id: string): void;
  moveSlide(from: number, to: number): void;
  addImageLayer(assetId: string, dim: { width: number; height: number }): void;
  assignPhoto(layerId: string, assetId: string | null): boolean;
  assignPhotos(targetLayerId: string, assetIds: string[]): number;
  shufflePhotos(slideId?: string): boolean;
  swapPhotos(sourceId: string, targetId: string): boolean;
  addTextLayer(text?: string): void;
  addShapeLayer(shape: 'rect' | 'ellipse'): void;
  applyGrid(template: GridTemplate, gap: number, margin?: number): void;
  setSlideGrid(slideId: string, patch: { gap?: number; margin?: number }): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  updateLayers(patches: { id: string; patch: Partial<Layer> }[]): void;
  deleteLayer(id: string): void;
  deleteLayers(ids: string[]): void;
  duplicateLayers(ids: string[]): string[];
  groupLayers(ids: string[]): string | null;
  ungroupLayers(ids: string[]): void;
  alignLayers(ids: string[], edge: AlignEdge, relativeTo?: 'selection' | 'slide'): void;
  distributeLayers(ids: string[], axis: DistributeAxis): void;
  moveLayers(ids: string[], dx: number, dy: number, mergeKey?: string): void;
  resizeLayers(ids: string[], from: Bounds, to: Bounds): void;
  reorderLayers(ids: string[], dir: 'up' | 'down' | 'top' | 'bottom'): void;
  spreadAcrossSlides(asset: { id: string; width: number; height: number }, span?: number): void;
  addMediaAsSlides(assets: MediaSlideAsset[]): void;
  duplicateLayer(id: string): void;
  reorderLayer(id: string, dir: 'up' | 'down' | 'top' | 'bottom'): void;
  setLayerOrder(slideId: string, ids: string[]): void;
  toggleVisible(id: string): void;
  toggleLocked(id: string): void;
  renameLayer(id: string, name: string): void;
  setBackground(bg: Background): void;
  setBackgroundForAllSlides(bg: Background): void;
  execute(command: EditorCommand): void;
  beginTransaction(label: string, mergeKey?: string): TransactionId;
  updateTransaction(id: TransactionId, command: EditorCommand): void;
  commitTransaction(id: TransactionId): void;
  cancelTransaction(id: TransactionId): void;
  undo(): void;
  redo(): void;
}

const newSlide = (): SlideRecord => ({ id: id(), background: { kind: 'solid', color: '#ffffff' }, layerOrder: [] });

export function newDocument(format: Format = DEFAULT_FORMAT, name = 'Untitled'): ProjectDocumentV2 {
  const now = Date.now();
  const slide = newSlide();
  return {
    schemaVersion: 2,
    revision: 0,
    id: id(),
    name,
    format,
    slideOrder: [slide.id],
    slides: { [slide.id]: slide },
    layers: {},
    createdAt: now,
    updatedAt: now,
  };
}

function summary(doc: ProjectDocumentV2): ProjectSummary {
  return { id: doc.id, name: doc.name, format: doc.format, slideCount: doc.slideOrder.length, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

const sortProjects = (p: ProjectSummary[]) => [...p].sort((a, b) => b.updatedAt - a.updatedAt);
const patchBytes = (p: Patch[], i: Patch[]) => JSON.stringify([p, i]).length * 2;
const contentPatches = (patches: Patch[]) => patches.filter((p) => p.path[0] !== 'revision' && p.path[0] !== 'updatedAt');

function trimHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const next = entries.slice(-HISTORY_LIMIT);
  let bytes = next.reduce((n, e) => n + e.bytes, 0);
  while (next.length > 1 && bytes > HISTORY_BYTE_LIMIT) bytes -= next.shift()!.bytes;
  return next;
}

function applyCommand(doc: ProjectDocumentV2, editorCommand: EditorCommand) {
  const [next, patches, inverse] = produceWithPatches(doc, (draft) => {
    editorCommand.apply(draft);
    draft.revision += 1;
    draft.updatedAt = Date.now();
  });
  return { next, patches: contentPatches(patches), inverse: contentPatches(inverse) };
}

function findLayerSlide(doc: ProjectDocumentV2, layerId: string) {
  return doc.slideOrder.find((sid) => doc.slides[sid]?.layerOrder.includes(layerId));
}

export async function collectProjectAssetScopes(
  projects: StoredProjectSummary[],
  loadProject: typeof readProject = readProject,
) {
  const scopes: { projectId: string; assetIds: string[] }[] = [];
  const failures: { projectId: string; error: unknown }[] = [];
  for (const project of projects) {
    try {
      const stored = await loadProject(project.id);
      if (!stored) throw new Error('The saved project record is missing.');
      const doc = migrateDocument(stored);
      const assetIds = Object.values(doc.layers)
        .filter((layer): layer is ImageLayer => layer.kind === 'image' && Boolean(layer.assetId))
        .map((layer) => layer.assetId as string);
      for (const slide of Object.values(doc.slides)) {
        if (slide.background.kind === 'image' && slide.background.assetId) assetIds.push(slide.background.assetId);
      }
      scopes.push({ projectId: project.id, assetIds: [...new Set(assetIds)] });
    } catch (error) {
      failures.push({ projectId: project.id, error });
    }
  }
  return { scopes, failures };
}

const TEXT_LAYOUT_KEYS = new Set(['text', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'letterSpacing', 'lineHeight', 'width', 'autoFit']);

/** Text boxes without shrink-to-fit grow and shrink with their text, like the Mac app. */
function fitTextBox<T extends Layer>(layer: T, changed: Iterable<string>): T {
  if (layer.kind !== 'text' || layer.autoFit || ![...changed].some((key) => TEXT_LAYOUT_KEYS.has(key))) return layer;
  const height = measureTextHeight(layer);
  return height === undefined || Math.abs(height - layer.height) < 0.01 ? layer : { ...layer, height };
}

/** Prefer the current selection's slide; fall back for legacy explicit-id calls. */
function idsOnOneSlide(doc: ProjectDocumentV2, ids: string[]): string[] {
  const selected = new Set(ids);
  const current = useEditorSession.getState().selectedSlideId;
  const sid = doc.slides[current]?.layerOrder.some((lid) => selected.has(lid) && !!doc.layers[lid])
    ? current
    : ids.map((lid) => doc.layers[lid] ? findLayerSlide(doc, lid) : undefined).find(Boolean);
  if (!sid) return [];
  return doc.slides[sid].layerOrder.filter((lid) => selected.has(lid) && !!doc.layers[lid]);
}

function activeSlideId(doc: ProjectDocumentV2): string {
  const selected = useEditorSession.getState().selectedSlideId;
  return doc.slides[selected] ? selected : doc.slideOrder[0];
}

function normalizeGroups(doc: Draft<ProjectDocumentV2>, sid: string): void {
  const groups = new Map<string, string[]>();
  for (const lid of doc.slides[sid].layerOrder) {
    const group = doc.layers[lid]?.groupId;
    if (group) groups.set(group, [...(groups.get(group) ?? []), lid]);
  }
  for (const members of groups.values()) if (members.length === 1) delete doc.layers[members[0]].groupId;
}

function mediaLayer(asset: { id: string }, format: Format, span: number, name: string): ImageLayer {
  return { id: id(), kind: 'image', name, x: 0, y: 0, width: format.width * span, height: format.height, rotation: 0, opacity: 1, visible: true, locked: false, assetId: asset.id, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
}

export const useDocumentStore = create<EditorState>((set, get) => ({
  doc: newDocument(), projects: [], activeProjectId: null,
  selectedSlideId: '', selectedLayerId: null, selectedLayerIds: [], zoom: 0.5, panOffset: { x: 0, y: 0 }, leftPanel: 'photos',
  past: [], future: [], ready: false, readOnlyError: null, saveError: null, transaction: null,

  setLeftPanel: (leftPanel) => { useEditorSession.getState().setLeftPanel(leftPanel); set({ leftPanel }); },
  setZoom: (zoom) => { useEditorSession.getState().setZoom(zoom); set({ zoom: Math.max(0.05, Math.min(4, zoom)) }); },
  setPan: (panOffset) => set({ panOffset }),
  selectSlide: (selectedSlideId) => useEditorSession.getState().selectSlide(selectedSlideId),
  selectLayer: (selectedLayerId) => useEditorSession.getState().selectLayer(selectedLayerId),
  selectLayers: (ids, primaryId) => useEditorSession.getState().selectLayers(ids, primaryId),
  selectAllLayers: () => {
    const doc = get().doc;
    const sid = activeSlideId(doc);
    get().selectLayers(getSlideLayers(doc, sid).filter((layer) => !layer.locked && layer.visible).map((layer) => layer.id));
  },

  loadFromDisk: async () => {
    const projects = await listProjectSummaries();
    try {
      if (await assetRepository.needsProjectScopeMigration()) {
        const scan = await collectProjectAssetScopes(projects);
        for (const failure of scan.failures) {
          console.warn(`Could not inspect media references for project ${failure.projectId}.`, failure.error);
        }
        if (scan.failures.length === 0) {
          await assetRepository.migrateProjectScopes(scan.scopes, projects[0]?.id);
        } else {
          // Do not set the one-time migration marker after a partial scan. A
          // transient read failure must be retried on the next launch.
          console.warn('Project media migration was deferred until every project can be read.');
        }
      }
    } catch (error) {
      // Project loading should never be held hostage by an optional media
      // migration. The editor can still open and retry on the next launch.
      console.error('Could not migrate project media libraries.', error);
    }
    set({ projects, ready: true });
  },
  saveToDisk: async () => {
    const { activeProjectId, doc } = get();
    if (!activeProjectId) return;
    const s = summary(doc);
    // Autosave and navigation both write projects. Preserve invocation order
    // and merge summaries against current state after each asynchronous write.
    const work = saveTail.then(async () => {
      try {
        await writeProject(doc, s);
        set((state) => ({ projects: sortProjects([s, ...state.projects.filter((p) => p.id !== doc.id)]), saveError: null }));
      } catch (error) {
        set({ saveError: 'Your latest changes could not be saved. Keep this page open and retry saving.' });
        throw error;
      }
    });
    saveTail = work.catch(() => undefined);
    await work;
  },
  openProject: async (projectId) => {
    if (get().activeProjectId) await get().saveToDisk();
    const stored = await readProject(projectId);
    if (!stored) return;
    try {
      const doc = migrateDocument(stored);
      if (!('schemaVersion' in stored)) await preserveLegacyBackup(projectId, stored);
      set({ doc, activeProjectId: doc.id, selectedSlideId: doc.slideOrder[0] ?? '', selectedLayerId: null, selectedLayerIds: [], past: [], future: [], readOnlyError: null });
      useEditorSession.getState().resetSelection(doc.slideOrder[0] ?? '');
      if (!('schemaVersion' in stored)) await get().saveToDisk();
    } catch (error) {
      set({ readOnlyError: error instanceof Error ? error.message : 'This project cannot be opened.', activeProjectId: null });
    }
  },
  closeProject: async () => {
    if (get().activeProjectId) await get().saveToDisk();
    set({ activeProjectId: null, selectedSlideId: '', selectedLayerId: null, selectedLayerIds: [], past: [], future: [] });
    useEditorSession.getState().resetSelection();
  },
  newProject: async (format = DEFAULT_FORMAT, name = 'Untitled') => {
    if (get().activeProjectId) await get().saveToDisk();
    const doc = newDocument(format, name.trim() || 'Untitled');
    set({ doc, activeProjectId: doc.id, selectedSlideId: doc.slideOrder[0], selectedLayerId: null, selectedLayerIds: [], past: [], future: [], projects: sortProjects([summary(doc), ...get().projects]) });
    useEditorSession.getState().resetSelection(doc.slideOrder[0]);
    await get().saveToDisk();
  },

  execute: (editorCommand) => set((state) => {
    if (state.readOnlyError) return {};
    const result = applyCommand(state.doc, editorCommand);
    if (!result.patches.length) return {};
    if (state.transaction) {
      return { doc: result.next, transaction: { ...state.transaction, patches: [...state.transaction.patches, ...result.patches], inverse: [...result.inverse, ...state.transaction.inverse] } };
    }
    const now = Date.now();
    const entry: HistoryEntry = { label: editorCommand.label, mergeKey: editorCommand.mergeKey, at: now, patches: result.patches, inverse: result.inverse, bytes: patchBytes(result.patches, result.inverse) };
    const previous = state.past.at(-1);
    let past: HistoryEntry[];
    if (editorCommand.mergeKey && previous?.mergeKey === editorCommand.mergeKey && now - previous.at <= MERGE_WINDOW_MS) {
      const patches = [...previous.patches, ...entry.patches];
      const inverse = [...entry.inverse, ...previous.inverse];
      const merged = { ...entry, patches, inverse, bytes: patchBytes(patches, inverse) };
      past = [...state.past.slice(0, -1), merged];
    } else past = [...state.past, entry];
    return { doc: result.next, past: trimHistory(past), future: [] };
  }),
  beginTransaction: (label, mergeKey) => {
    const tx = { id: id(), label, mergeKey, patches: [], inverse: [] };
    set({ transaction: tx });
    return tx.id;
  },
  updateTransaction: (transactionId, editorCommand) => {
    if (get().transaction?.id === transactionId) get().execute(editorCommand);
  },
  commitTransaction: (transactionId) => set((state) => {
    const tx = state.transaction;
    if (!tx || tx.id !== transactionId) return {};
    if (!tx.patches.length) return { transaction: null };
    const entry: HistoryEntry = { label: tx.label, mergeKey: tx.mergeKey, at: Date.now(), patches: tx.patches, inverse: tx.inverse, bytes: patchBytes(tx.patches, tx.inverse) };
    return { transaction: null, past: trimHistory([...state.past, entry]), future: [] };
  }),
  cancelTransaction: (transactionId) => set((state) => {
    const tx = state.transaction;
    if (!tx || tx.id !== transactionId) return {};
    return { doc: produce(applyPatches(state.doc, tx.inverse), (d) => { d.revision += 1; d.updatedAt = Date.now(); }), transaction: null };
  }),

  setFormat: (format) => get().execute(command('Change format', (d) => { d.format = format; })),
  setDocName: (name) => get().execute(command('Rename project', (d) => { d.name = name; }, 'project:name')),
  addSlide: (after) => {
    const slide = newSlide();
    get().execute(command('Add slide', (d) => {
      const index = after ? d.slideOrder.indexOf(after) + 1 : d.slideOrder.length;
      d.slideOrder.splice(Math.max(0, index), 0, slide.id); d.slides[slide.id] = slide;
    }));
    get().selectSlide(slide.id);
  },
  deleteSlide: (slideId) => {
    const state = get(); if (state.doc.slideOrder.length <= 1) return;
    const index = state.doc.slideOrder.indexOf(slideId); if (index < 0) return;
    const wasSelected = useEditorSession.getState().selectedSlideId === slideId;
    get().execute(command('Delete slide', (d) => {
      for (const lid of d.slides[slideId]?.layerOrder ?? []) delete d.layers[lid];
      delete d.slides[slideId]; d.slideOrder.splice(index, 1);
    }));
    // Deleting another slide (from the canvas header) keeps the current selection.
    if (wasSelected) get().selectSlide(get().doc.slideOrder[Math.min(index, get().doc.slideOrder.length - 1)] ?? '');
  },
  duplicateSlide: (slideId) => {
    const source = get().doc.slides[slideId]; if (!source) return;
    const nextId = id(); const newLayerIds: string[] = [];
    get().execute(command('Duplicate slide', (d) => {
      const groups = new Map<string, string>();
      const idMap = new Map<string, string>();
      for (const lid of source.layerOrder) {
        const nid = id(); const layer = d.layers[lid];
        if (!layer) continue;
        newLayerIds.push(nid); idMap.set(lid, nid);
        const copy = { ...layer, id: nid };
        if (layer.groupId) {
          if (!groups.has(layer.groupId)) groups.set(layer.groupId, id());
          copy.groupId = groups.get(layer.groupId)!;
        }
        d.layers[nid] = copy;
      }
      // slotIds must stay index-aligned with the template cells, so a slot that no longer exists gets a fresh unused id rather than being dropped.
      const grid = source.grid && { ...source.grid, slotIds: source.grid.slotIds.map((old) => idMap.get(old) ?? id()) };
      d.slides[nextId] = { ...source, id: nextId, layerOrder: newLayerIds, ...(grid ? { grid } : {}) };
      d.slideOrder.splice(d.slideOrder.indexOf(slideId) + 1, 0, nextId);
    })); get().selectSlide(nextId);
  },
  moveSlide: (from, to) => get().execute(command('Move slide', (d) => {
    if (from < 0 || to < 0 || from >= d.slideOrder.length || to >= d.slideOrder.length) return;
    const [sid] = d.slideOrder.splice(from, 1); d.slideOrder.splice(to, 0, sid);
  })),

  addImageLayer: (assetId, dim) => {
    const s = get(); const fmt = s.doc.format; const ratio = dim.width / dim.height;
    let width = fmt.width * 0.7; let height = width / ratio;
    if (height > fmt.height * 0.7) { height = fmt.height * 0.7; width = height * ratio; }
    const layer: ImageLayer = { id: id(), kind: 'image', name: 'Photo', x: (fmt.width-width)/2, y: (fmt.height-height)/2, width, height, rotation: 0, opacity: 1, visible: true, locked: false, assetId, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
    const sid = useEditorSession.getState().selectedSlideId || s.doc.slideOrder[0];
    get().execute(command('Add photo', (d) => { d.layers[layer.id] = layer; d.slides[sid].layerOrder.push(layer.id); })); get().selectLayer(layer.id);
  },
  assignPhoto: (layerId, assetId) => {
    const layer = get().doc.layers[layerId];
    if (get().readOnlyError || layer?.kind !== 'image') return false;
    get().execute(command(assetId === null ? 'Clear photo' : layer.assetId ? 'Replace photo' : 'Fill photo frame', (d) => {
      setFramePhoto(d.layers[layerId] as ImageLayer, assetId);
    }));
    return true;
  },
  assignPhotos: (targetLayerId, assetIds) => {
    const { doc, readOnlyError } = get();
    const target = doc.layers[targetLayerId];
    const slideId = findLayerSlide(doc, targetLayerId);
    if (readOnlyError || !slideId || target?.kind !== 'image' || assetIds.length === 0) return 0;
    const targets = [targetLayerId, ...getSlideLayers(doc, slideId)
      .filter((layer) => layer.id !== targetLayerId && layer.kind === 'image' && layer.visible && layer.assetId === null)
      .map((layer) => layer.id)].slice(0, assetIds.length);
    get().execute(command(targets.length === 1 ? 'Replace photo' : 'Place photos', (d) => {
      targets.forEach((layerId, index) => setFramePhoto(d.layers[layerId] as ImageLayer, assetIds[index]));
    }));
    return targets.length;
  },
  shufflePhotos: (slideId) => {
    const { doc, readOnlyError } = get();
    if (readOnlyError) return false;
    const frames = filledPhotoFrames(doc, slideId ?? (useEditorSession.getState().selectedSlideId || doc.slideOrder[0]));
    const shuffled = shuffledPhotoIds(frames.map((layer) => layer.assetId!));
    if (!shuffled) return false;
    get().execute(command('Shuffle photos', (d) => {
      frames.forEach((layer, index) => setFramePhoto(d.layers[layer.id] as ImageLayer, shuffled[index]));
    }));
    return true;
  },
  swapPhotos: (sourceId, targetId) => {
    const { doc, readOnlyError } = get();
    if (readOnlyError || !canSwapPhotoFrames(doc, sourceId, targetId)) return false;
    const source = doc.layers[sourceId] as ImageLayer, target = doc.layers[targetId] as ImageLayer;
    get().execute(command(source.assetId && target.assetId ? 'Swap photos' : 'Move photo', (d) => {
      setFramePhoto(d.layers[sourceId] as ImageLayer, target.assetId);
      setFramePhoto(d.layers[targetId] as ImageLayer, source.assetId);
    }));
    return true;
  },
  addTextLayer: (text = 'Double-click to edit') => {
    const s = get(); const f = s.doc.format; const sid = useEditorSession.getState().selectedSlideId || s.doc.slideOrder[0];
    const layer: TextLayer = fitTextBox({ id: id(), kind:'text', name:'Text', x:f.width*.1, y:f.height*.4, width:f.width*.8, height:200, rotation:0, opacity:1, visible:true, locked:false, text, fontFamily:'Inter', fontSize:96, fontWeight:700, italic:false, fill:'#111111', align:'center', letterSpacing:0, lineHeight:1.15 } as TextLayer, ['text']);
    get().execute(command('Add text', (d) => { d.layers[layer.id]=layer; d.slides[sid].layerOrder.push(layer.id); })); get().selectLayer(layer.id);
  },
  addShapeLayer: (shape) => {
    const s=get(); const f=s.doc.format; const sid=useEditorSession.getState().selectedSlideId||s.doc.slideOrder[0]; const width=f.width*.4; const height=f.height*.3;
    const layer: ShapeLayer={id:id(),kind:'shape',name:shape==='rect'?'Rectangle':'Ellipse',x:(f.width-width)/2,y:(f.height-height)/2,width,height,rotation:0,opacity:1,visible:true,locked:false,shape,fill:'#7c5cff',stroke:'transparent',strokeWidth:0,cornerRadius:shape==='rect'?24:0};
    get().execute(command('Add shape',(d)=>{d.layers[layer.id]=layer;d.slides[sid].layerOrder.push(layer.id);}));get().selectLayer(layer.id);
  },
  applyGrid: (template,gap,margin=0) => { const s=get();const sid=useEditorSession.getState().selectedSlideId||s.doc.slideOrder[0];const cells=layoutGrid(template,s.doc.format,gap,margin);
    get().execute(command('Apply grid',(d)=>{for(const lid of d.slides[sid].layerOrder)delete d.layers[lid];d.slides[sid].layerOrder=[];const slotIds:string[]=[];cells.forEach((c,i)=>{const lid=id();slotIds.push(lid);d.layers[lid]={id:lid,kind:'image',name:`Photo ${i+1}`,x:c.x,y:c.y,width:c.w,height:c.h,rotation:0,opacity:1,visible:true,locked:true,assetId:null,cornerRadius:0,cropOffsetX:0,cropOffsetY:0,cropScale:1};d.slides[sid].layerOrder.push(lid);});d.slides[sid].grid={templateId:template.id,gap,margin,slotIds};}));get().selectLayer(null);
  },
  setSlideGrid: (slideId,patch) => { const s=get();const live=getLiveGrid(s.doc,slideId);if(!live)return;
    const gap=patch.gap??live.grid.gap;const margin=patch.margin??live.grid.margin;if(gap===live.grid.gap&&margin===live.grid.margin)return;
    const oldCells=layoutGrid(live.template,s.doc.format,live.grid.gap,live.grid.margin);const newCells=layoutGrid(live.template,s.doc.format,gap,margin);
    get().execute(command('Adjust grid',(d)=>{const slide=d.slides[slideId];const g=slide.grid;if(!g)return;
      g.slotIds.forEach((lid,i)=>{const layer=d.layers[lid];if(!layer||!slide.layerOrder.includes(lid)||!oldCells[i]||!newCells[i])return;if(!slotMatchesCell(layer,oldCells[i]))return;const c=newCells[i];layer.x=c.x;layer.y=c.y;layer.width=c.w;layer.height=c.h;});
      g.gap=gap;g.margin=margin;},`grid:${slideId}`));
  },
  updateLayer: (layerId, patch) => get().execute(command('Edit layer',(d)=>{if(d.layers[layerId])d.layers[layerId]=fitTextBox({...d.layers[layerId],...patch} as Layer,Object.keys(patch));},`layer:${layerId}:${Object.keys(patch).sort().join(',')}`)),
  updateLayers: (patches) => get().execute(command('Edit layers',(d)=>{for(const p of patches)if(d.layers[p.id])d.layers[p.id]=fitTextBox({...d.layers[p.id],...p.patch} as Layer,Object.keys(p.patch));})),
  deleteLayer: (layerId) => get().deleteLayers([layerId]),
  deleteLayers: (ids) => {
    if (get().readOnlyError) return;
    const selected = idsOnOneSlide(get().doc, ids);
    const sid = selected.length ? findLayerSlide(get().doc, selected[0]) : undefined;
    if (!sid) return;
    get().execute(command('Delete layers', (d) => {
      const removed = new Set(selected);
      d.slides[sid].layerOrder = d.slides[sid].layerOrder.filter((lid) => !removed.has(lid));
      for (const lid of selected) delete d.layers[lid];
      normalizeGroups(d, sid);
    }));
    get().selectLayer(null);
  },
  duplicateLayer: (layerId) => { get().duplicateLayers([layerId]); },
  duplicateLayers: (ids) => {
    const doc = get().doc;
    const units = selectionUnits(doc, idsOnOneSlide(doc, ids));
    if (!units.length || get().readOnlyError) return [];
    const sid = findLayerSlide(doc, units[0].ids[0])!;
    const originals = new Map<string, string>();
    const copiesByTop = new Map<string, string[]>();
    const copies: Layer[] = [];
    for (const unit of units) {
      const groupId = doc.layers[unit.ids[0]].groupId ? id() : undefined;
      const unitCopies = unit.ids.map((lid) => {
        const original = doc.layers[lid]; const nid = id();
        originals.set(lid, nid);
        copies.push({ ...original, id: nid, x: original.x + 24, y: original.y + 24, name: `${original.name} copy`, ...(groupId ? { groupId } : {}) });
        return nid;
      });
      copiesByTop.set(unit.ids.at(-1)!, unitCopies);
    }
    get().execute(command('Duplicate layers', (d) => {
      for (const copy of copies) d.layers[copy.id] = copy;
      d.slides[sid].layerOrder = d.slides[sid].layerOrder.flatMap((lid) => [lid, ...(copiesByTop.get(lid) ?? [])]);
    }));
    const copyIds = copies.map((copy) => copy.id);
    const primary = useEditorSession.getState().selectedLayerId;
    get().selectLayers(copyIds, primary ? originals.get(primary) : undefined);
    return copyIds;
  },
  groupLayers: (ids) => {
    const doc = get().doc;
    const members = expandToGroups(doc, idsOnOneSlide(doc, ids));
    if (members.length < 2 || get().readOnlyError) return null;
    const sid = findLayerSlide(doc, members[0])!;
    const groupId = id();
    get().execute(command('Group layers', (d) => {
      for (const lid of members) d.layers[lid].groupId = groupId;
      const selected = new Set(members);
      const order = d.slides[sid].layerOrder;
      const top = order.indexOf(members.at(-1)!);
      const insertion = order.slice(0, top + 1).filter((lid) => !selected.has(lid)).length;
      const remaining = order.filter((lid) => !selected.has(lid));
      remaining.splice(insertion, 0, ...members);
      d.slides[sid].layerOrder = remaining;
    }));
    const primary = useEditorSession.getState().selectedLayerId;
    get().selectLayers(members, primary && members.includes(primary) ? primary : undefined);
    return groupId;
  },
  ungroupLayers: (ids) => {
    const members = expandToGroups(get().doc, idsOnOneSlide(get().doc, ids));
    get().execute(command('Ungroup layers', (d) => {
      for (const lid of members) if (d.layers[lid].groupId) delete d.layers[lid].groupId;
    }));
  },
  alignLayers: (ids, edge, relativeTo) => {
    const doc = get().doc;
    const units = selectionUnits(doc, idsOnOneSlide(doc, ids));
    if (!units.length) return;
    const target = (relativeTo ?? (units.length >= 2 ? 'selection' : 'slide')) === 'selection'
      ? unionBounds(units.map((unit) => unit.bounds))!
      : { x: 0, y: 0, width: doc.format.width, height: doc.format.height };
    const horizontal = edge === 'left' || edge === 'centerX' || edge === 'right';
    const coordinate = (bounds: Bounds) => {
      switch (edge) {
        case 'left': return bounds.x;
        case 'centerX': return bounds.x + bounds.width / 2;
        case 'right': return bounds.x + bounds.width;
        case 'top': return bounds.y;
        case 'centerY': return bounds.y + bounds.height / 2;
        case 'bottom': return bounds.y + bounds.height;
      }
    };
    get().execute(command('Align layers', (d) => {
      for (const unit of units) {
        if (unit.ids.some((lid) => d.layers[lid].locked)) continue;
        const delta = coordinate(target) - coordinate(unit.bounds);
        for (const lid of unit.ids) {
          if (horizontal) d.layers[lid].x += delta;
          else d.layers[lid].y += delta;
        }
      }
    }));
  },
  distributeLayers: (ids, axis) => {
    const doc = get().doc;
    const units = selectionUnits(doc, idsOnOneSlide(doc, ids));
    if (units.length < 3) return;
    const position = axis === 'horizontal' ? 'x' : 'y';
    const size = axis === 'horizontal' ? 'width' : 'height';
    units.sort((a, b) => a.bounds[position] - b.bounds[position] || (a.bounds[position] + a.bounds[size] / 2) - (b.bounds[position] + b.bounds[size] / 2));
    const first = units[0].bounds; const last = units.at(-1)!.bounds;
    const span = last[position] + last[size] - first[position];
    const gap = (span - units.reduce((sum, unit) => sum + unit.bounds[size], 0)) / (units.length - 1);
    get().execute(command('Distribute layers', (d) => {
      let cursor = first[position] + first[size] + gap;
      for (let i = 1; i < units.length - 1; i++) {
        const unit = units[i];
        if (!unit.ids.some((lid) => d.layers[lid].locked)) {
          const delta = cursor - unit.bounds[position];
          for (const lid of unit.ids) d.layers[lid][position] += delta;
        }
        cursor += unit.bounds[size] + gap;
      }
    }));
  },
  moveLayers: (ids, dx, dy, mergeKey) => {
    const members = idsOnOneSlide(get().doc, ids);
    get().execute(command('Move layers', (d) => {
      for (const lid of members) if (!d.layers[lid].locked) { d.layers[lid].x += dx; d.layers[lid].y += dy; }
    }, mergeKey));
  },
  resizeLayers: (ids, from, to) => {
    const members = idsOnOneSlide(get().doc, ids);
    get().execute(command('Resize layers', (d) => {
      for (const lid of members) if (!d.layers[lid].locked) d.layers[lid] = fitTextBox(scaleLayer(d.layers[lid] as Layer, from, to), ['width', 'fontSize']);
    }));
  },
  reorderLayer: (layerId, dir) => get().reorderLayers([layerId], dir),
  reorderLayers: (ids, dir) => {
    const doc = get().doc;
    const members = expandToGroups(doc, idsOnOneSlide(doc, ids));
    if (!members.length) return;
    const sid = findLayerSlide(doc, members[0])!;
    const order = doc.slides[sid].layerOrder;
    const selected = new Set(members);
    const remaining = order.filter((lid) => !selected.has(lid));
    let insertion: number;
    if (dir === 'top') insertion = remaining.length;
    else if (dir === 'bottom') insertion = 0;
    else {
      const neighbor = dir === 'up'
        ? order[order.indexOf(members.at(-1)!) + 1]
        : order[order.indexOf(members[0]) - 1];
      if (!neighbor) return;
      const neighbors = groupMemberIds(doc, neighbor);
      insertion = dir === 'up'
        ? Math.max(...neighbors.map((lid) => remaining.indexOf(lid))) + 1
        : Math.min(...neighbors.map((lid) => remaining.indexOf(lid)));
    }
    remaining.splice(insertion, 0, ...members);
    if (remaining.every((lid, i) => lid === order[i])) return;
    get().execute(command('Reorder layers', (d) => { d.slides[sid].layerOrder = remaining; }));
  },
  spreadAcrossSlides: (asset, requestedSpan) => {
    if (get().readOnlyError) return;
    const doc = get().doc; const sid = activeSlideId(doc);
    const span = Math.max(2, Math.round(requestedSpan ?? slideSpanFor(asset, doc.format)));
    if (!Number.isFinite(span) || !doc.slides[sid]) return;
    const layer = mediaLayer(asset, doc.format, span, 'Panorama');
    get().execute(command('Spread panorama across slides', (d) => {
      const needed = d.slideOrder.indexOf(sid) + span;
      while (d.slideOrder.length < needed) {
        const slide = newSlide(); d.slides[slide.id] = slide; d.slideOrder.push(slide.id);
      }
      d.layers[layer.id] = layer; d.slides[sid].layerOrder.push(layer.id);
    }));
    get().selectLayer(layer.id);
  },
  addMediaAsSlides: (assets) => {
    if (!assets.length || get().readOnlyError) return;
    const doc = get().doc; const sid = activeSlideId(doc);
    const replace = doc.slideOrder.length === 1 && doc.slides[doc.slideOrder[0]].layerOrder.length === 0;
    const slides: SlideRecord[] = []; const layers: ImageLayer[] = [];
    for (const asset of assets) {
      const span = slideSpanFor(asset, doc.format);
      const first = newSlide();
      if (replace && !slides.length) first.background = doc.slides[doc.slideOrder[0]].background;
      const name = span > 1 ? 'Panorama' : asset.mediaKind === 'video' ? 'Video' : asset.mediaKind === 'gif' ? 'Animation' : 'Photo';
      const layer = mediaLayer(asset, doc.format, span, name);
      first.layerOrder.push(layer.id); layers.push(layer); slides.push(first);
      for (let i = 1; i < span; i++) slides.push(newSlide());
    }
    get().execute(command('Add media as slides', (d) => {
      if (replace) { delete d.slides[d.slideOrder[0]]; d.slideOrder = []; }
      const index = replace ? 0 : d.slideOrder.indexOf(sid) + 1;
      d.slideOrder.splice(index, 0, ...slides.map((slide) => slide.id));
      for (const slide of slides) d.slides[slide.id] = slide;
      for (const layer of layers) d.layers[layer.id] = layer;
    }));
    useEditorSession.getState().focusSlide(slides[0].id);
  },
  setLayerOrder: (slideId,ids) => get().execute(command('Reorder layers',(d)=>{if(d.slides[slideId])d.slides[slideId].layerOrder=ids;})),
  toggleVisible: (layerId) => get().execute(command('Toggle layer visibility',(d)=>{if(d.layers[layerId])d.layers[layerId].visible=!d.layers[layerId].visible;})),
  toggleLocked: (layerId) => get().execute(command('Toggle layer lock',(d)=>{if(d.layers[layerId])d.layers[layerId].locked=!d.layers[layerId].locked;})),
  renameLayer: (layerId,name) => get().execute(command('Rename layer',(d)=>{if(d.layers[layerId])d.layers[layerId].name=name;},`layer:${layerId}:name`)),
  setBackground: (background) => {const sid=useEditorSession.getState().selectedSlideId;get().execute(command('Change background',(d)=>{if(d.slides[sid])d.slides[sid].background=background;}));},
  setBackgroundForAllSlides: (background) => get().execute(command('Change all backgrounds',(d)=>{for(const sid of d.slideOrder)d.slides[sid].background={...background};})),
  undo: () => set((s)=>{const entry=s.past.at(-1);if(!entry)return{};const doc=produce(applyPatches(s.doc,entry.inverse),(d)=>{d.revision+=1;d.updatedAt=Date.now();});return{doc,past:s.past.slice(0,-1),future:[entry,...s.future].slice(0,HISTORY_LIMIT)};}),
  redo: () => set((s)=>{const entry=s.future[0];if(!entry)return{};const doc=produce(applyPatches(s.doc,entry.patches),(d)=>{d.revision+=1;d.updatedAt=Date.now();});return{doc,past:trimHistory([...s.past,entry]),future:s.future.slice(1)};}),
}));

// The session owns selection, including direct calls from canvas and panels.
useEditorSession.subscribe((session) => {
  const state = useDocumentStore.getState();
  if (state.selectedSlideId !== session.selectedSlideId || state.selectedLayerId !== session.selectedLayerId || state.selectedLayerIds !== session.selectedLayerIds) {
    useDocumentStore.setState({ selectedSlideId: session.selectedSlideId, selectedLayerId: session.selectedLayerId, selectedLayerIds: session.selectedLayerIds });
  }
});

// Prune after every document replacement, including history and transaction rollback.
useDocumentStore.subscribe((state, previous) => {
  if (state.doc === previous.doc) return;
  const session = useEditorSession.getState();
  const ids = session.selectedLayerIds.filter((lid) => !!state.doc.layers[lid] && !!findLayerSlide(state.doc, lid));
  const primary = session.selectedLayerId === null ? null : ids.includes(session.selectedLayerId) ? session.selectedLayerId : ids.at(-1) ?? null;
  const lostSlide = session.selectedSlideId && !state.doc.slides[session.selectedSlideId];
  if (lostSlide) session.selectSlide((primary ? findLayerSlide(state.doc, primary) : undefined) ?? state.doc.slideOrder[0] ?? '');
  if (lostSlide || ids.length !== session.selectedLayerIds.length || primary !== session.selectedLayerId) {
    session.selectLayers(ids, primary);
  }
});

export const selectActiveSlide = (s: EditorState) => materializeSlide(s.doc, useEditorSession.getState().selectedSlideId || s.doc.slideOrder[0]);
export const selectActiveLayer = (s: EditorState) => { const id=useEditorSession.getState().selectedLayerId; return id ? s.doc.layers[id] : undefined; };
export const selectSlideLayers = (s: EditorState, slideId: string) => getSlideLayers(s.doc, slideId);
