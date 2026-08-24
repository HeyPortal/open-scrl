import { DuplicateAssetError, getAsset, getAssetMetadata, importAsset } from '@/lib/assets';
import { useAssets } from '@/store/assets';
import { useEditor } from '@/store/editor';
import { useToasts } from '@/store/toasts';
import type { ImageLayer } from '@/types';
import {
  canRemoveBackground,
  cutoutFileName,
  removeImageBackground,
  type BackgroundRemovalProgress,
} from './backgroundRemoval';

const jobs = new Set<string>();

export async function restoreLayerBackground(layerId: string) {
  const layer = useEditor.getState().doc.layers[layerId];
  if (!layer || layer.kind !== 'image' || !layer.sourceAssetId) return;
  useEditor.getState().updateLayer(layerId, {
    assetId: layer.sourceAssetId,
    sourceAssetId: undefined,
  } as Partial<ImageLayer>);
  useToasts.getState().addToast('Restored the original photo.', 'success');
}

export async function removeLayerBackground(layerId: string, onProgress?: BackgroundRemovalProgress) {
  if (jobs.has(layerId)) return;
  const editor = useEditor.getState();
  const layer = editor.doc.layers[layerId];
  const projectId = editor.activeProjectId;
  if (!layer || layer.kind !== 'image' || !layer.assetId || !projectId) {
    throw new Error('Select a photo layer first.');
  }
  const meta = await getAssetMetadata(layer.assetId);
  if (!canRemoveBackground(meta)) {
    throw new Error('Background removal works on still photos, not GIF or video.');
  }
  const original = await getAsset(layer.assetId);
  if (!original) throw new Error('That photo is missing from this project.');

  jobs.add(layerId);
  try {
    const png = await removeImageBackground(original.blob, onProgress);
    const file = new File([png], cutoutFileName(original.name), { type: 'image/png' });
    let cutout;
    try {
      cutout = await importAsset(file, projectId);
    } catch (error) {
      if (!(error instanceof DuplicateAssetError)) throw error;
      cutout = error.existing;
    }
    if (useEditor.getState().activeProjectId !== projectId) return;
    useAssets.getState().addAsset(cutout);
    useEditor.getState().updateLayer(layerId, {
      assetId: cutout.id,
      sourceAssetId: layer.sourceAssetId ?? layer.assetId,
    } as Partial<ImageLayer>);
    useToasts.getState().addToast('Background removed on this device.', 'success');
  } finally {
    jobs.delete(layerId);
  }
}
