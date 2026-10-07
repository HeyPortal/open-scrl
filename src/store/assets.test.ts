import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetMeta, ImageLayer } from '@/types';
import { deleteAsset } from '@/lib/assets';
import { deferred } from '@/test/deferred';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { useEditorSession } from '@/editor/sessionStore';
import { useAssets } from './assets';

vi.mock('@/lib/assets', () => ({ DuplicateAssetError: class extends Error {}, deleteAsset: vi.fn(), getAssetThumbUrl: vi.fn(), importAsset: vi.fn(), isLikelyMediaFile: vi.fn(), listAssets: vi.fn() }));
const remove = vi.mocked(deleteAsset);
const meta: AssetMeta = { id: 'asset', name: 'Photo', mime: 'image/jpeg', width: 100, height: 100, blobKey: 'asset', thumbnailKey: 'thumb', hash: 'hash', size: 1 };
let slideId: string;
beforeEach(() => {
  const doc = newDocument(); slideId = doc.slideOrder[0];
  doc.slides[slideId].background = { kind: 'image', assetId: 'asset', blur: 4, dim: 0.2, color: '#abc' };
  useDocumentStore.setState({ doc, activeProjectId: doc.id, past: [], future: [], transaction: null, readOnlyError: null });
  useEditorSession.getState().resetSelection(slideId);
  useAssets.setState({ projectId: doc.id, assets: [meta], thumbs: { asset: 'blob:thumb' }, ready: true });
  remove.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe('media removal background references', () => {
  it('counts background-only usage and clears it in one reversible history step', async () => {
    const background = useDocumentStore.getState().doc.slides[slideId].background;
    await useAssets.getState().remove('asset');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('1 layer or background reference'));
    expect(remove).toHaveBeenCalledWith('asset', useDocumentStore.getState().doc.id);
    expect(useDocumentStore.getState().doc.slides[slideId].background).toEqual({ ...background, assetId: null });
    expect(useAssets.getState()).toMatchObject({ assets: [], thumbs: {} });
    expect(useDocumentStore.getState().past).toHaveLength(1);
    useDocumentStore.getState().undo(); expect(useDocumentStore.getState().doc.slides[slideId].background).toEqual(background);
    useDocumentStore.getState().redo(); expect(useDocumentStore.getState().doc.slides[slideId].background).toEqual({ ...background, assetId: null });
  });
  it('counts layers and all matching backgrounds while preserving existing image placeholders', async () => {
    const image: ImageLayer = { id: 'photo', kind: 'image', name: 'Photo', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, assetId: 'asset', cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
    const doc = structuredClone(useDocumentStore.getState().doc); doc.layers.photo = image; doc.slides[slideId].layerOrder.push('photo');
    doc.slideOrder.push('second', 'other');
    doc.slides.second = { id: 'second', background: { kind: 'image', assetId: 'asset', blur: 0, dim: 0, color: '#fff' }, layerOrder: [] };
    doc.slides.other = { id: 'other', background: { kind: 'image', assetId: 'other', blur: 0, dim: 0, color: '#000' }, layerOrder: [] };
    useDocumentStore.setState({ doc }); await useAssets.getState().remove('asset');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('3 layer or background references'));
    const next = useDocumentStore.getState().doc;
    expect(next.slides[slideId].background).toMatchObject({ assetId: null }); expect(next.slides.second.background).toMatchObject({ assetId: null }); expect(next.slides.other.background).toMatchObject({ assetId: 'other' });
    expect(next.layers.photo).toMatchObject({ assetId: 'asset' }); expect(useDocumentStore.getState().past).toHaveLength(1);
  });
  it('leaves the document and asset intact when removal is declined', async () => {
    vi.mocked(window.confirm).mockReturnValue(false); const doc = useDocumentStore.getState().doc;
    await useAssets.getState().remove('asset'); expect(remove).not.toHaveBeenCalled(); expect(useDocumentStore.getState().doc).toBe(doc); expect(useAssets.getState().assets).toEqual([meta]);
  });
  it('does not mutate references when the underlying asset removal fails', async () => {
    remove.mockRejectedValue(new Error('failed')); await expect(useAssets.getState().remove('asset')).rejects.toThrow('failed');
    expect(useDocumentStore.getState().past).toHaveLength(0); expect(useDocumentStore.getState().doc.slides[slideId].background).toMatchObject({ assetId: 'asset' });
  });
  it('does not prompt or add history for unused media', async () => {
    await useAssets.getState().remove('unused'); expect(window.confirm).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledOnce(); expect(useDocumentStore.getState().past).toHaveLength(0);
  });
  it('ignores a removal without an active project', async () => {
    useDocumentStore.setState({ activeProjectId: null }); await useAssets.getState().remove('asset'); expect(remove).not.toHaveBeenCalled();
  });
  it('does not clear another project after navigation during asset removal', async () => {
    const pending = deferred(); remove.mockReturnValue(pending.promise);
    const work = useAssets.getState().remove('asset');
    useDocumentStore.setState({ activeProjectId: 'other' }); useAssets.setState({ projectId: 'other' }); pending.resolve(); await work;
    expect(useDocumentStore.getState().doc.slides[slideId].background).toMatchObject({ assetId: 'asset' }); expect(useDocumentStore.getState().past).toHaveLength(0);
  });
});
