import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import type { Background, Format, ImageLayer, Layer, ProjectDocumentV2, ShapeLayer, SlideRecord, TextLayer } from '@/types';
import { id } from '@/lib/nano';
import { DEFAULT_FORMAT } from '@/lib/format';
import type { GridTemplate } from '@/lib/grids';
import { migrateDocument } from '@/core/document/migrations';
import { command, type EditorCommand } from '@/core/document/commands';
import { getSlideLayers, materializeSlide } from '@/core/document/selectors';
import { listProjectSummaries, preserveLegacyBackup, readProject, writeProject, type StoredProjectSummary } from '@/storage/database';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { useEditorSession } from './sessionStore';

enablePatches();

const HISTORY_LIMIT = 80;
const HISTORY_BYTE_LIMIT = 32 * 1024 * 1024;
const MERGE_WINDOW_MS = 750;

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
  zoom: number;
  panOffset: { x: number; y: number };
  leftPanel: LeftPanel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  ready: boolean;
  readOnlyError: string | null;
  transaction: ActiveTransaction | null;

  setLeftPanel(p: LeftPanel): void;
  setZoom(z: number): void;
  setPan(p: { x: number; y: number }): void;
  selectSlide(id: string): void;
  selectLayer(id: string | null): void;
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
  addTextLayer(text?: string): void;
  addShapeLayer(shape: 'rect' | 'ellipse'): void;
  applyGrid(template: GridTemplate, gap: number): void;
  updateLayer(id: string, patch: Partial<Layer>): void;
  updateLayers(patches: { id: string; patch: Partial<Layer> }[]): void;
  deleteLayer(id: string): void;
  duplicateLayer(id: string): void;
  reorderLayer(id: string, dir: 'up' | 'down' | 'top' | 'bottom'): void;
  setLayerOrder(slideId: string, ids: string[]): void;
  toggleVisible(id: string): void;
  toggleLocked(id: string): void;
  renameLayer(id: string, name: string): void;
  setBackground(bg: Background): void;
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

export const useDocumentStore = create<EditorState>((set, get) => ({
  doc: newDocument(), projects: [], activeProjectId: null,
  selectedSlideId: '', selectedLayerId: null, zoom: 0.5, panOffset: { x: 0, y: 0 }, leftPanel: 'photos',
  past: [], future: [], ready: false, readOnlyError: null, transaction: null,

  setLeftPanel: (leftPanel) => { useEditorSession.getState().setLeftPanel(leftPanel); set({ leftPanel }); },
  setZoom: (zoom) => { useEditorSession.getState().setZoom(zoom); set({ zoom: Math.max(0.05, Math.min(4, zoom)) }); },
  setPan: (panOffset) => set({ panOffset }),
  selectSlide: (selectedSlideId) => { useEditorSession.getState().selectSlide(selectedSlideId); set({ selectedSlideId, selectedLayerId: null }); },
  selectLayer: (selectedLayerId) => { useEditorSession.getState().selectLayer(selectedLayerId); set({ selectedLayerId }); },

  loadFromDisk: async () => {
    const projects = await listProjectSummaries();
    try {
      if (await assetRepository.needsProjectScopeMigration()) {
        const scopes: { projectId: string; assetIds: string[] }[] = [];
        for (const project of projects) {
          try {
            const stored = await readProject(project.id);
            if (!stored) continue;
            const doc = migrateDocument(stored);
            const assetIds = Object.values(doc.layers)
              .filter((layer): layer is ImageLayer => layer.kind === 'image' && Boolean(layer.assetId))
              .map((layer) => layer.assetId as string);
            scopes.push({ projectId: project.id, assetIds });
          } catch (error) {
            console.warn(`Could not inspect media references for project ${project.id}.`, error);
          }
        }
        await assetRepository.migrateProjectScopes(scopes, projects[0]?.id);
      }
    } catch (error) {
      // Project loading should never be held hostage by an optional media
      // migration. The editor can still open and retry on the next launch.
      console.error('Could not migrate project media libraries.', error);
    }
    set({ projects, ready: true });
  },
  saveToDisk: async () => {
    const { activeProjectId, doc, projects } = get();
    if (!activeProjectId) return;
    const s = summary(doc);
    await writeProject(doc, s);
    set({ projects: sortProjects([s, ...projects.filter((p) => p.id !== doc.id)]) });
  },
  openProject: async (projectId) => {
    if (get().activeProjectId) await get().saveToDisk();
    const stored = await readProject(projectId);
    if (!stored) return;
    try {
      const doc = migrateDocument(stored);
      if (!('schemaVersion' in stored)) await preserveLegacyBackup(projectId, stored);
      set({ doc, activeProjectId: doc.id, selectedSlideId: doc.slideOrder[0] ?? '', selectedLayerId: null, past: [], future: [], readOnlyError: null });
      useEditorSession.getState().resetSelection(doc.slideOrder[0] ?? '');
      if (!('schemaVersion' in stored)) await get().saveToDisk();
    } catch (error) {
      set({ readOnlyError: error instanceof Error ? error.message : 'This project cannot be opened.', activeProjectId: null });
    }
  },
  closeProject: async () => {
    if (get().activeProjectId) await get().saveToDisk();
    set({ activeProjectId: null, selectedSlideId: '', selectedLayerId: null, past: [], future: [] });
    useEditorSession.getState().resetSelection();
  },
  newProject: async (format = DEFAULT_FORMAT, name = 'Untitled') => {
    if (get().activeProjectId) await get().saveToDisk();
    const doc = newDocument(format, name.trim() || 'Untitled');
    set({ doc, activeProjectId: doc.id, selectedSlideId: doc.slideOrder[0], selectedLayerId: null, past: [], future: [], projects: sortProjects([summary(doc), ...get().projects]) });
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
      const merged = { ...entry, inverse: previous.inverse, bytes: patchBytes(entry.patches, previous.inverse) };
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
    const index = state.doc.slideOrder.indexOf(slideId);
    get().execute(command('Delete slide', (d) => {
      for (const lid of d.slides[slideId]?.layerOrder ?? []) delete d.layers[lid];
      delete d.slides[slideId]; d.slideOrder.splice(index, 1);
    }));
    get().selectSlide(get().doc.slideOrder[Math.min(index, get().doc.slideOrder.length - 1)] ?? '');
  },
  duplicateSlide: (slideId) => {
    const source = get().doc.slides[slideId]; if (!source) return;
    const nextId = id(); const newLayerIds: string[] = [];
    get().execute(command('Duplicate slide', (d) => {
      for (const lid of source.layerOrder) { const nid = id(); newLayerIds.push(nid); d.layers[nid] = { ...d.layers[lid], id: nid }; }
      d.slides[nextId] = { ...source, id: nextId, layerOrder: newLayerIds };
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
  addTextLayer: (text = 'Double-click to edit') => {
    const s = get(); const f = s.doc.format; const sid = useEditorSession.getState().selectedSlideId || s.doc.slideOrder[0];
    const layer: TextLayer = { id: id(), kind:'text', name:'Text', x:f.width*.1, y:f.height*.4, width:f.width*.8, height:200, rotation:0, opacity:1, visible:true, locked:false, text, fontFamily:'Inter', fontSize:96, fontWeight:700, italic:false, fill:'#111111', align:'center', letterSpacing:0, lineHeight:1.15 };
    get().execute(command('Add text', (d) => { d.layers[layer.id]=layer; d.slides[sid].layerOrder.push(layer.id); })); get().selectLayer(layer.id);
  },
  addShapeLayer: (shape) => {
    const s=get(); const f=s.doc.format; const sid=useEditorSession.getState().selectedSlideId||s.doc.slideOrder[0]; const width=f.width*.4; const height=f.height*.3;
    const layer: ShapeLayer={id:id(),kind:'shape',name:shape==='rect'?'Rectangle':'Ellipse',x:(f.width-width)/2,y:(f.height-height)/2,width,height,rotation:0,opacity:1,visible:true,locked:false,shape,fill:'#7c5cff',stroke:'transparent',strokeWidth:0,cornerRadius:shape==='rect'?24:0};
    get().execute(command('Add shape',(d)=>{d.layers[layer.id]=layer;d.slides[sid].layerOrder.push(layer.id);}));get().selectLayer(layer.id);
  },
  applyGrid: (template,gap) => { const s=get();const sid=useEditorSession.getState().selectedSlideId||s.doc.slideOrder[0];const cells=template.cells(s.doc.format.width,s.doc.format.height,gap);
    get().execute(command('Apply grid',(d)=>{for(const lid of d.slides[sid].layerOrder)delete d.layers[lid];d.slides[sid].layerOrder=[];cells.forEach((c,i)=>{const lid=id();d.layers[lid]={id:lid,kind:'image',name:`Photo ${i+1}`,x:c.x,y:c.y,width:c.w,height:c.h,rotation:0,opacity:1,visible:true,locked:true,assetId:null,cornerRadius:0,cropOffsetX:0,cropOffsetY:0,cropScale:1};d.slides[sid].layerOrder.push(lid);});}));get().selectLayer(null);
  },
  updateLayer: (layerId, patch) => get().execute(command('Edit layer',(d)=>{if(d.layers[layerId])d.layers[layerId]={...d.layers[layerId],...patch} as Layer;},`layer:${layerId}:${Object.keys(patch).sort().join(',')}`)),
  updateLayers: (patches) => get().execute(command('Edit layers',(d)=>{for(const p of patches)if(d.layers[p.id])d.layers[p.id]={...d.layers[p.id],...p.patch} as Layer;})),
  deleteLayer: (layerId) => {get().execute(command('Delete layer',(d)=>{const sid=findLayerSlide(d as ProjectDocumentV2,layerId);if(sid)d.slides[sid].layerOrder=d.slides[sid].layerOrder.filter((x)=>x!==layerId);delete d.layers[layerId];}));get().selectLayer(null);},
  duplicateLayer: (layerId) => {const original=get().doc.layers[layerId];const sid=findLayerSlide(get().doc,layerId);if(!original||!sid)return;const nid=id();get().execute(command('Duplicate layer',(d)=>{d.layers[nid]={...original,id:nid,x:original.x+24,y:original.y+24,name:`${original.name} copy`};const at=d.slides[sid].layerOrder.indexOf(layerId);d.slides[sid].layerOrder.splice(at+1,0,nid);}));get().selectLayer(nid);},
  reorderLayer: (layerId,dir) => get().execute(command('Reorder layer',(d)=>{const sid=findLayerSlide(d as ProjectDocumentV2,layerId);if(!sid)return;const order=d.slides[sid].layerOrder;const at=order.indexOf(layerId);order.splice(at,1);const to=dir==='up'?Math.min(at+1,order.length):dir==='down'?Math.max(at-1,0):dir==='top'?order.length:0;order.splice(to,0,layerId);})),
  setLayerOrder: (slideId,ids) => get().execute(command('Reorder layers',(d)=>{if(d.slides[slideId])d.slides[slideId].layerOrder=ids;})),
  toggleVisible: (layerId) => get().execute(command('Toggle layer visibility',(d)=>{if(d.layers[layerId])d.layers[layerId].visible=!d.layers[layerId].visible;})),
  toggleLocked: (layerId) => get().execute(command('Toggle layer lock',(d)=>{if(d.layers[layerId])d.layers[layerId].locked=!d.layers[layerId].locked;})),
  renameLayer: (layerId,name) => get().execute(command('Rename layer',(d)=>{if(d.layers[layerId])d.layers[layerId].name=name;},`layer:${layerId}:name`)),
  setBackground: (background) => {const sid=useEditorSession.getState().selectedSlideId;get().execute(command('Change background',(d)=>{if(d.slides[sid])d.slides[sid].background=background;}));},
  undo: () => set((s)=>{const entry=s.past.at(-1);if(!entry)return{};const doc=produce(applyPatches(s.doc,entry.inverse),(d)=>{d.revision+=1;d.updatedAt=Date.now();});return{doc,past:s.past.slice(0,-1),future:[entry,...s.future].slice(0,HISTORY_LIMIT)};}),
  redo: () => set((s)=>{const entry=s.future[0];if(!entry)return{};const doc=produce(applyPatches(s.doc,entry.patches),(d)=>{d.revision+=1;d.updatedAt=Date.now();});return{doc,past:trimHistory([...s.past,entry]),future:s.future.slice(1)};}),
}));

export const selectActiveSlide = (s: EditorState) => materializeSlide(s.doc, useEditorSession.getState().selectedSlideId || s.doc.slideOrder[0]);
export const selectActiveLayer = (s: EditorState) => { const id=useEditorSession.getState().selectedLayerId; return id ? s.doc.layers[id] : undefined; };
export const selectSlideLayers = (s: EditorState, slideId: string) => getSlideLayers(s.doc, slideId);
