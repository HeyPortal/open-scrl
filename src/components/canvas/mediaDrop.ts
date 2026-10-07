import type { AssetMeta, ImageLayer, ProjectDocumentV2 } from '@/types';
import { command } from '@/core/document/commands';
import { isLikelyMediaFile } from '@/lib/assets';
import { getMediaKind } from '@/lib/media';
import { id } from '@/lib/nano';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';

/** Drag type the Media panel puts on a thumbnail; its value is the asset id. */
export const ASSET_DRAG_TYPE = 'application/x-osc-asset';
const MAX_ASSET_ID_LENGTH = 200;
/** Each extra photo dropped at once is nudged so the stack stays readable. */
const CASCADE_STEP = 24;

type DragData = Pick<DataTransfer, 'types'>;

export interface DropPoint {
  x: number;
  y: number;
}

export interface DropLocation {
  /** Slide that owns the image frame under the pointer, or the slide under the pointer when there is none. */
  slideId: string;
  /** Pointer position in the coordinates of `slideId`. */
  point: DropPoint;
  /** Topmost visible image frame under the pointer. */
  frame: ImageLayer | null;
}

const hasType = (data: DragData | null | undefined, type: string) => !!data && Array.from(data.types ?? []).includes(type);
export const dragCarriesAsset = (data: DragData | null | undefined) => hasType(data, ASSET_DRAG_TYPE);
export const dragCarriesFiles = (data: DragData | null | undefined) => hasType(data, 'Files');

/** The dragged asset id, or null when the payload is absent, blank, or not an id. */
export function readDroppedAssetId(data: Pick<DataTransfer, 'getData'> | null | undefined): string | null {
  try {
    const value = data?.getData(ASSET_DRAG_TYPE);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= MAX_ASSET_ID_LENGTH ? trimmed : null;
  } catch {
    return null;
  }
}

export function readDroppedFiles(data: Pick<DataTransfer, 'files'> | null | undefined): File[] {
  try {
    return Array.from(data?.files ?? []).filter(isLikelyMediaFile);
  } catch {
    return [];
  }
}

/** Whether a point in slide-strip (document) coordinates lies inside a layer, honoring its rotation. */
function insideLayer(layer: ImageLayer, slideX: number, point: DropPoint) {
  const cx = slideX + layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const angle = -layer.rotation * Math.PI / 180;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle);
  const y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= Math.abs(layer.width) / 2 && Math.abs(y) <= Math.abs(layer.height) / 2;
}

/**
 * Resolves a point in slide-strip coordinates (slide 0 starts at x = 0) to the slide under it and the
 * topmost visible image frame there. Locked frames count; text and shapes are skipped. Returns null off the strip.
 */
export function locateDrop(doc: ProjectDocumentV2, deck: DropPoint): DropLocation | null {
  const { width, height } = doc.format;
  if (!Number.isFinite(deck.x) || !Number.isFinite(deck.y) || deck.x < 0 || deck.y < 0 || deck.y > height) return null;
  const index = Math.floor(deck.x / width);
  const slideId = doc.slideOrder[index];
  if (!slideId) return null;
  // Frames can overhang their slide (panoramas), so every slide's layers are candidates, topmost last.
  for (let s = doc.slideOrder.length - 1; s >= 0; s--) {
    const owner = doc.slideOrder[s];
    const order = doc.slides[owner]?.layerOrder ?? [];
    for (let i = order.length - 1; i >= 0; i--) {
      const layer = doc.layers[order[i]];
      if (layer?.kind !== 'image' || !layer.visible || !insideLayer(layer, s * width, deck)) continue;
      return { slideId: owner, point: { x: deck.x - s * width, y: deck.y }, frame: layer };
    }
  }
  return { slideId, point: { x: deck.x - index * width, y: deck.y }, frame: null };
}

/** The same fit `addImageLayer` uses: up to 70% of the slide, keeping the media's proportions. */
function fitToSlide(asset: Pick<AssetMeta, 'width' | 'height'>, format: ProjectDocumentV2['format']) {
  const ratio = asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1;
  let width = format.width * 0.7;
  let height = width / ratio;
  if (height > format.height * 0.7) { height = format.height * 0.7; width = height * ratio; }
  return { width, height };
}

/**
 * Adds one new photo layer per asset to a slide, centered on `point`, as a single undo step.
 * Returns the new layer ids in order; empty when nothing could be added.
 */
export function addPhotosAt(slideId: string, point: DropPoint, assets: AssetMeta[]): string[] {
  const editor = useEditor.getState();
  const { doc } = editor;
  if (editor.readOnlyError || !doc.slides[slideId] || !assets.length) return [];
  const layers = assets.map((asset, i): ImageLayer => {
    const { width, height } = fitToSlide(asset, doc.format);
    const kind = getMediaKind(asset);
    const nudge = i * CASCADE_STEP;
    const place = (center: number, size: number, limit: number) => Math.max(0, Math.min(limit - size, center - size / 2 + nudge));
    return {
      id: id(), kind: 'image', name: kind === 'video' ? 'Video' : kind === 'gif' ? 'Animation' : 'Photo',
      x: place(point.x, width, doc.format.width), y: place(point.y, height, doc.format.height), width, height,
      rotation: 0, opacity: 1, visible: true, locked: false, assetId: asset.id, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1,
    };
  });
  editor.execute(command(layers.length === 1 ? 'Add photo' : 'Add photos', (draft) => {
    for (const layer of layers) { draft.layers[layer.id] = layer; draft.slides[slideId].layerOrder.push(layer.id); }
  }));
  const ids = layers.map((layer) => layer.id).filter((layerId) => useEditor.getState().doc.layers[layerId]);
  if (ids.length) {
    const session = useEditorSession.getState();
    if (session.selectedSlideId !== slideId) session.selectSlide(slideId);
    session.selectLayers(ids);
  }
  return ids;
}

/** Toast copy for a files-onto-frame drop. */
export function describeFill(placed: number, total: number) {
  const photos = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
  if (placed <= 0) return 'Could not place the dropped media.';
  const left = total - placed;
  return left > 0
    ? `Placed ${photos(placed)}. ${photos(left)} didn’t fit in an empty frame and stay in Media.`
    : `Placed ${photos(placed)}.`;
}
