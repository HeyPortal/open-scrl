import { openDB } from 'idb';
import type { Format, ImageLayer, ProjectDocumentV2 } from '@/types';
import { id } from './nano';
import { validateProject } from './validateProject';

export interface PostTemplate { id: string; name: string; document: ProjectDocumentV2 }
type Cell = { x: number; y: number; width: number; height: number; rotation?: number; frame?: number };
export const POST_PRESETS: { id: string; name: string; description: string; slides: Cell[][] }[] = [
  { id: 'gallery', name: 'Gallery', description: 'Three photos · white mats', slides: [[{ x: .065, y: .055, width: .87, height: .89, frame: .035 }], [{ x: .065, y: .055, width: .87, height: .89, frame: .035 }], [{ x: .065, y: .055, width: .87, height: .89, frame: .035 }]] },
  { id: 'storyboard', name: 'Storyboard', description: 'Four photos · two slides', slides: [[{ x: .045, y: .045, width: .91, height: .55 }, { x: .045, y: .62, width: .44, height: .335 }, { x: .515, y: .62, width: .44, height: .335 }], [{ x: .045, y: .045, width: .91, height: .91 }]] },
  { id: 'overlap', name: 'Photo stack', description: 'Three photos · one slide', slides: [[{ x: .08, y: .06, width: .68, height: .56, rotation: -5, frame: .025 }, { x: .28, y: .43, width: .66, height: .48, rotation: 6, frame: .025 }, { x: .09, y: .67, width: .32, height: .24, rotation: -8, frame: .02 }]] },
];

export function presetDocument(presetId: string, format: Format): ProjectDocumentV2 {
  const preset = POST_PRESETS.find((preset) => preset.id === presetId);
  if (!preset) throw new Error('Unknown post template.');
  const doc: ProjectDocumentV2 = { schemaVersion: 2, revision: 0, id: id(), name: preset.name, format, slideOrder: [], slides: {}, layers: {}, createdAt: Date.now(), updatedAt: Date.now() };
  for (const cells of preset.slides) {
    const sid = id(); doc.slideOrder.push(sid);
    const order = cells.map((cell, index) => {
      const lid = id();
      const layer: ImageLayer = { id: lid, kind: 'image', name: `Photo ${index + 1}`, assetId: null, x: cell.x * format.width, y: cell.y * format.height, width: cell.width * format.width, height: cell.height * format.height, rotation: cell.rotation ?? 0, opacity: 1, visible: true, locked: false, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1, stroke: '#ffffff', strokeWidth: (cell.frame ?? 0) * Math.min(format.width, format.height) };
      doc.layers[lid] = layer; return lid;
    });
    doc.slides[sid] = { id: sid, background: { kind: 'solid', color: '#ffffff' }, layerOrder: order };
  }
  return doc;
}
export function withoutPhotos(doc: ProjectDocumentV2): ProjectDocumentV2 {
  validateProject(doc);
  const layout = structuredClone(doc);
  for (const layer of Object.values(layout.layers)) if (layer.kind === 'image') { layer.assetId = null; layer.cropOffsetX = layer.cropOffsetY = 0; layer.cropScale = 1; layer.name = 'Photo'; }
  for (const slide of Object.values(layout.slides)) if (slide.background.kind === 'image') slide.background = { kind: 'solid', color: slide.background.color };
  return layout;
}
async function database() { return openDB('open-scrl-templates', 1, { upgrade(db) { db.createObjectStore('layouts', { keyPath: 'id' }); } }); }
export async function listTemplates(): Promise<PostTemplate[]> { const db = await database(); try { return await db.getAll('layouts'); } finally { db.close(); } }
export async function saveTemplate(doc: ProjectDocumentV2, name: string): Promise<PostTemplate> {
  if (!name.trim()) throw new Error('Give your template a name.');
  const template = { id: id(), name: name.trim(), document: withoutPhotos(doc) };
  const db = await database(); try { await db.put('layouts', template); } finally { db.close(); }
  return template;
}
export async function deleteTemplate(templateId: string) { const db = await database(); try { await db.delete('layouts', templateId); } finally { db.close(); } }
