import { create } from 'zustand';
import {
  DuplicateAssetError,
  deleteAsset as idbDelete,
  getAssetThumbUrl,
  importAsset as idbImport,
  isLikelyMediaFile,
  listAssets,
} from '@/lib/assets';
import type { AssetMeta } from '@/types';
import { useToasts } from './toasts';
import { useEditor } from './editor';

interface AssetsState {
  projectId: string | null;
  assets: AssetMeta[];
  thumbs: Record<string, string>;
  ready: boolean;
  importMessage: string | null;
  loadForProject: (projectId: string) => Promise<void>;
  clearProject: () => void;
  ensureThumb: (id: string) => Promise<string | undefined>;
  importFiles: (files: File[] | FileList) => Promise<AssetMeta[]>;
  remove: (id: string) => Promise<void>;
  clearImportMessage: () => void;
}

const thumbnailLoads = new Map<string, Promise<string | undefined>>();
const thumbnailQueue: Array<() => void> = [];
const MAX_THUMBNAIL_LOADS = 1;
let activeThumbnailLoads = 0;

function drainThumbnailQueue() {
  while (activeThumbnailLoads < MAX_THUMBNAIL_LOADS) {
    const start = thumbnailQueue.shift();
    if (!start) return;
    activeThumbnailLoads++;
    start();
  }
}

function loadThumbnailQueued(id: string) {
  return new Promise<string | undefined>((resolve, reject) => {
    thumbnailQueue.push(() => {
      const run = () => {
        getAssetThumbUrl(id).then(resolve, reject).finally(() => {
          activeThumbnailLoads--;
          drainThumbnailQueue();
        });
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 750 });
      } else {
        window.setTimeout(run, 0);
      }
    });
    drainThumbnailQueue();
  });
}

export const useAssets = create<AssetsState>((set, get) => ({
  projectId: null,
  assets: [],
  thumbs: {},
  ready: false,
  importMessage: null,

  loadForProject: async (projectId) => {
    set({ projectId, assets: [], ready: false, importMessage: null });
    const assets = await listAssets(projectId);
    if (get().projectId === projectId) set({ assets, ready: true });
  },

  clearProject: () => set({ projectId: null, assets: [], ready: false, importMessage: null }),

  ensureThumb: async (id) => {
    const existing = get().thumbs[id];
    if (existing) return existing;
    const loadKey = id;
    let work = thumbnailLoads.get(loadKey);
    if (!work) {
      work = loadThumbnailQueued(id).finally(() => thumbnailLoads.delete(loadKey));
      thumbnailLoads.set(loadKey, work);
    }
    try {
      const url = await work;
      if (url) set((state) => ({ thumbs: { ...state.thumbs, [id]: url } }));
      return url;
    } catch (error) {
      console.warn(`Could not create thumbnail for media ${id}.`, error);
      return undefined;
    }
  },

  importFiles: async (files) => {
    const projectId = useEditor.getState().activeProjectId;
    if (!projectId) {
      set({ importMessage: 'Open a project before importing media.' });
      return [];
    }
    const incoming = Array.from(files);
    const arr = incoming.filter(isLikelyMediaFile);
    const skipped = incoming.length - arr.length;
    if (arr.length === 0) {
      set({
        importMessage:
          incoming.length > 0
            ? 'Those files did not look supported. Try JPG, PNG, GIF, MP4, MOV, or WebM.'
            : null,
      });
      return [];
    }
    const imported: AssetMeta[] = [];
    const duplicates: string[] = [];
    const failed: string[] = [];
    for (const f of arr) {
      try {
        const a = await idbImport(f, projectId);
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
    if (get().projectId !== projectId || useEditor.getState().activeProjectId !== projectId) {
      return imported;
    }
    if (imported.length > 0) {
      const next = [...get().assets, ...imported];
      const parts: string[] = [];
      parts.push(`Imported ${imported.length} media file${imported.length === 1 ? '' : 's'}.`);
      if (skipped > 0) parts.push(`Skipped ${skipped} unsupported file${skipped === 1 ? '' : 's'}.`);
      if (duplicates.length > 0) {
        parts.push(
          `${duplicates.length} duplicate file${duplicates.length === 1 ? ' was' : 's were'} already imported.`,
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
        await get().ensureThumb(a.id);
      }
    } else {
      set({
        importMessage:
          duplicates.length > 0 && failed.length === 0
            ? `${duplicates.length} duplicate file${duplicates.length === 1 ? ' was' : 's were'} already imported.`
            : failed.length > 0
            ? `Couldn't decode ${failed.length} file${failed.length === 1 ? '' : 's'}. If these are HEIC photos, they should import now; otherwise they may be unsupported.`
            : 'No media was imported.',
      });
    }
    return imported;
  },

  remove: async (id) => {
    const projectId = useEditor.getState().activeProjectId;
    if (!projectId) return;
    const doc = useEditor.getState().doc;
    const references = Object.values(doc.layers).filter((layer) => layer.kind === 'image' && layer.assetId === id).length;
    if (references > 0 && !window.confirm(`This media file is used by ${references} layer${references === 1 ? '' : 's'}. Delete it anyway? Those layers will show a missing-media placeholder.`)) return;
    await idbDelete(id, projectId);
    if (get().projectId !== projectId || useEditor.getState().activeProjectId !== projectId) return;
    const next = get().assets.filter((a) => a.id !== id);
    const thumbs = { ...get().thumbs };
    delete thumbs[id];
    thumbnailLoads.delete(id);
    set({ assets: next, thumbs });
  },

  clearImportMessage: () => set({ importMessage: null }),
}));
