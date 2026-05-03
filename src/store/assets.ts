import { create } from 'zustand';
import {
  DuplicateAssetError,
  deleteAsset as idbDelete,
  getAssetThumbUrl,
  importAsset as idbImport,
  isLikelyImageFile,
  listAssets,
} from '@/lib/assets';
import type { Asset } from '@/types';
import { useToasts } from './toasts';

interface AssetsState {
  assets: Asset[];
  thumbs: Record<string, string>;
  ready: boolean;
  importMessage: string | null;
  loadAll: () => Promise<void>;
  importFiles: (files: File[] | FileList) => Promise<Asset[]>;
  remove: (id: string) => Promise<void>;
  clearImportMessage: () => void;
}

export const useAssets = create<AssetsState>((set, get) => ({
  assets: [],
  thumbs: {},
  ready: false,
  importMessage: null,

  loadAll: async () => {
    const assets = await listAssets();
    set({ assets, ready: true });

    for (const a of assets) {
      const url = await getAssetThumbUrl(a.id);
      if (!url) continue;
      set((state) => ({ thumbs: { ...state.thumbs, [a.id]: url } }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  },

  importFiles: async (files) => {
    const incoming = Array.from(files);
    const arr = incoming.filter(isLikelyImageFile);
    const skipped = incoming.length - arr.length;
    if (arr.length === 0) {
      set({
        importMessage:
          incoming.length > 0
            ? 'Those files did not look like supported images. Try JPG, PNG, WebP, AVIF, or HEIC.'
            : null,
      });
      return [];
    }
    const imported: Asset[] = [];
    const duplicates: string[] = [];
    const failed: string[] = [];
    for (const f of arr) {
      try {
        const a = await idbImport(f);
        imported.push(a);
      } catch (err) {
        if (err instanceof DuplicateAssetError) {
          duplicates.push(f.name);
          useToasts.getState().addToast(`${f.name} has already been imported.`, 'warning');
          continue;
        }
        console.error('Failed to import', f.name, err);
        failed.push(f.name);
      }
    }
    if (imported.length > 0) {
      const next = [...get().assets, ...imported];
      const parts: string[] = [];
      parts.push(`Imported ${imported.length} photo${imported.length === 1 ? '' : 's'}.`);
      if (skipped > 0) parts.push(`Skipped ${skipped} non-image file${skipped === 1 ? '' : 's'}.`);
      if (duplicates.length > 0) {
        parts.push(
          `${duplicates.length} duplicate photo${duplicates.length === 1 ? ' was' : 's were'} already imported.`,
        );
      }
      if (failed.length > 0) {
        parts.push(
          failed.length === 1
            ? `Couldn't decode ${failed[0]}.`
            : `Couldn't decode ${failed.length} files.`,
        );
      }
      set({ assets: next, importMessage: parts.join(' ') });

      for (const a of imported) {
        const url = await getAssetThumbUrl(a.id);
        if (!url) continue;
        set((state) => ({ thumbs: { ...state.thumbs, [a.id]: url } }));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    } else {
      set({
        importMessage:
          duplicates.length > 0 && failed.length === 0
            ? `${duplicates.length} duplicate photo${duplicates.length === 1 ? ' was' : 's were'} already imported.`
            : failed.length > 0
            ? `Couldn't decode ${failed.length} file${failed.length === 1 ? '' : 's'}. If these are HEIC photos, they should import now; otherwise they may be unsupported.`
            : 'No photos were imported.',
      });
    }
    return imported;
  },

  remove: async (id) => {
    await idbDelete(id);
    const next = get().assets.filter((a) => a.id !== id);
    const thumbs = { ...get().thumbs };
    delete thumbs[id];
    set({ assets: next, thumbs });
  },

  clearImportMessage: () => set({ importMessage: null }),
}));
