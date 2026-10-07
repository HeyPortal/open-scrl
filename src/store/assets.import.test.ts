import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetMeta } from '@/types';
import { DuplicateAssetError, importAsset, isLikelyMediaFile } from '@/lib/assets';
import { newDocument, useDocumentStore } from '@/editor/documentStore';
import { deferred } from '@/test/deferred';
import { useAssets } from './assets';
import { useToasts } from './toasts';

vi.mock('@/lib/assets', () => ({
  DuplicateAssetError: class extends Error {
    readonly existing: AssetMeta;
    constructor(existing: AssetMeta) { super('Duplicate'); this.existing = existing; }
  },
  deleteAsset: vi.fn(), getAssetThumbUrl: vi.fn(), importAsset: vi.fn(),
  isLikelyMediaFile: vi.fn(), listAssets: vi.fn(),
}));

const existing: AssetMeta = { id: 'existing', name: 'Existing.png', mime: 'image/png', width: 100, height: 100, blobKey: 'existing', thumbnailKey: 'thumb', hash: 'existing-hash', size: 1 };
const added: AssetMeta = { ...existing, id: 'new', name: 'New.png', hash: 'new-hash', blobKey: 'new' };
const file = (name: string) => new File(['image'], name, { type: 'image/png' });
const importer = vi.mocked(importAsset);

beforeEach(() => {
  const doc = newDocument();
  useDocumentStore.setState({ doc, activeProjectId: doc.id, past: [], future: [], transaction: null, readOnlyError: null });
  useAssets.setState({ projectId: doc.id, assets: [existing], thumbs: { existing: 'blob:existing', new: 'blob:new' }, ready: true, importMessage: null });
  useToasts.setState({ toasts: [] });
  importer.mockReset();
  vi.mocked(isLikelyMediaFile).mockReset().mockImplementation((f) => f.type.startsWith('image/'));
});
afterEach(() => vi.restoreAllMocks());

describe('media drops reusing existing imports', () => {
  it('returns duplicates and new photos in drop order without duplicating library entries', async () => {
    importer.mockRejectedValueOnce(new DuplicateAssetError(existing)).mockResolvedValueOnce(added).mockRejectedValueOnce(new DuplicateAssetError(existing));
    const result = await useAssets.getState().importFiles([file('Existing.png'), file('New.png'), file('Existing-again.png')], { reuseExisting: true });
    expect(result).toEqual([existing, added, existing]);
    expect(useAssets.getState().assets).toEqual([existing, added]);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('keeps ordinary library imports skipping duplicates with a warning', async () => {
    importer.mockRejectedValueOnce(new DuplicateAssetError(existing));
    expect(await useAssets.getState().importFiles([file('Existing.png')])).toEqual([]);
    expect(useAssets.getState().assets).toEqual([existing]);
    expect(useToasts.getState().toasts).toEqual([expect.objectContaining({ kind: 'warning', message: 'Existing.png has already been imported.' })]);
  });

  it('reuses an entirely duplicate drop', async () => {
    importer.mockRejectedValueOnce(new DuplicateAssetError(existing));
    expect(await useAssets.getState().importFiles([file('Existing.png')], { reuseExisting: true })).toEqual([existing]);
    expect(useAssets.getState().assets).toEqual([existing]);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('does not treat unsupported or failed files as photos to place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    importer.mockRejectedValueOnce(new Error('Decode failed')).mockRejectedValueOnce(new DuplicateAssetError(existing));
    const result = await useAssets.getState().importFiles([new File(['text'], 'notes.txt', { type: 'text/plain' }), file('Broken.png'), file('Existing.png')], { reuseExisting: true });
    expect(result).toEqual([existing]);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(useAssets.getState().assets).toEqual([existing]);
    expect(useAssets.getState().importMessage).toContain("Couldn't decode");
  });

  it('keeps a project switch during import from modifying the new project library', async () => {
    const work = deferred<AssetMeta>();
    importer.mockReturnValueOnce(work.promise);
    const result = useAssets.getState().importFiles([file('New.png')], { reuseExisting: true });
    const other = newDocument();
    useDocumentStore.setState({ doc: other, activeProjectId: other.id });
    useAssets.setState({ projectId: other.id, assets: [], importMessage: null });
    work.resolve(added);
    expect(await result).toEqual([added]);
    expect(useAssets.getState()).toMatchObject({ projectId: other.id, assets: [], importMessage: null });
  });
});
