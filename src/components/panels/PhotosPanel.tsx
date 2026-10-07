import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, GalleryHorizontal, GalleryHorizontalEnd, ImagePlus, Loader2, Trash2, Upload, X } from 'lucide-react';
import type { AssetMeta } from '@/types';
import { useAssets } from '@/store/assets';
import { useEditor } from '@/store/editor';
import { useToasts } from '@/store/toasts';
import { useEditorSession } from '@/editor/sessionStore';
import { slideSpanFor } from '@/core/document/geometry';
import { getMediaKind } from '@/lib/media';
import { useContextMenu } from '../Menu';
import { EmptyState, PanelHeader } from '../ui';

function MediaThumbnail({
  asset,
  broken,
  onError,
}: {
  asset: AssetMeta;
  broken: boolean;
  onError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const url = useAssets((state) => state.thumbs[asset.id]);
  const ensureThumb = useAssets((state) => state.ensureThumb);

  useEffect(() => {
    if (url) return;
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') {
      void ensureThumb(asset.id);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void ensureThumb(asset.id);
    }, { rootMargin: '160px' });
    observer.observe(container);
    return () => observer.disconnect();
  }, [asset.id, ensureThumb, url]);

  return (
    <div ref={containerRef} className="h-full w-full">
      {url && !broken ? (
        <img
          src={url}
          className="w-full h-full object-cover"
          alt={asset.name}
          loading="lazy"
          decoding="async"
          onError={onError}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
          <span className="text-[10px] font-medium text-ink-dim uppercase">Media</span>
          <span className="text-[9px] text-ink-faint truncate max-w-full">{asset.name}</span>
        </div>
      )}
    </div>
  );
}

export function PhotosPanel() {
  const activeProjectId = useEditor((s) => s.activeProjectId);
  const assetProjectId = useAssets((s) => s.projectId);
  const scopedAssets = useAssets((s) => s.assets);
  const assets = assetProjectId === activeProjectId ? scopedAssets : [];
  const importFiles = useAssets((s) => s.importFiles);
  const remove = useAssets((s) => s.remove);
  const importMessage = useAssets((s) => s.importMessage);
  const clearImportMessage = useAssets((s) => s.clearImportMessage);

  const [busy, setBusy] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Set by "Import as new slides" just before opening the shared file picker.
  const importAsSlides = useRef(false);
  const format = useEditor((s) => s.doc.format);
  const spreadAcrossSlides = useEditor((s) => s.spreadAcrossSlides);
  const addMediaAsSlides = useEditor((s) => s.addMediaAsSlides);
  const addToast = useToasts((s) => s.addToast);
  const openMenu = useContextMenu((s) => s.open);
  /** Slides a photo needs to keep its proportions; 1 for anything that isn't a panorama. */
  const spanOf = (asset: AssetMeta) => (getMediaKind(asset) === 'image' ? slideSpanFor(asset, format) : 1);
  const importRequest = useEditorSession((s) => s.importRequest);
  const handledRequest = useRef(importRequest);
  useEffect(() => {
    // Opens the file picker for "Import media" from the toolbar, palette, or menus.
    if (importRequest === handledRequest.current) return;
    handledRequest.current = importRequest;
    importAsSlides.current = false;
    inputRef.current?.click();
  }, [importRequest]);

  const addImageLayer = useEditor((s) => s.addImageLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const selectedLayerId = useEditorSession((s) => s.selectedLayerId);
  const selectedLayer = useEditor((s) => selectedLayerId ? s.doc.layers[selectedLayerId] : undefined);
  const layers = useEditor((s) => s.doc.layers);
  const slides = useEditor((s) => s.doc.slides);
  const usedAssets = useMemo(() => new Set([
    ...Object.values(layers).flatMap((l) => l.kind === 'image' && l.assetId ? [l.assetId] : []),
    ...Object.values(slides).flatMap((slide) => slide.background.kind === 'image' && slide.background.assetId ? [slide.background.assetId] : []),
  ]), [layers, slides]);

  const spread = (asset: AssetMeta) => {
    const span = Math.max(2, spanOf(asset));
    spreadAcrossSlides(asset, span);
    addToast(`Spread across ${span} slides. Drag it to choose what lands on each one.`, 'success');
  };

  /** Imports files; `asSlides` gives each one its own full-bleed slide (panoramas span several). */
  const handleFiles = async (files: FileList | null, asSlides = false) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const imported = await importFiles(files);
      if (asSlides && imported.length) {
        addMediaAsSlides(imported);
        const count = imported.reduce((n, a) => n + spanOf(a), 0);
        addToast(`Created ${count} slide${count === 1 ? '' : 's'} from ${imported.length} item${imported.length === 1 ? '' : 's'}.`, 'success');
        return;
      }
      const panorama = imported.find((a) => spanOf(a) > 1);
      if (panorama) {
        addToast(`“${panorama.name}” is a panorama.`, 'info', { label: `Spread across ${spanOf(panorama)} slides`, run: () => spread(panorama) });
      }
    } finally {
      setBusy(false);
    }
  };

  const assetMenu = (asset: AssetMeta, x: number, y: number) => {
    const slot = findSelectedImageLayer();
    openMenu(x, y, [
      { label: 'Add to slide', onSelect: () => addImageLayer(asset.id, { width: asset.width, height: asset.height }) },
      { label: spanOf(asset) > 1 ? `Spread across ${spanOf(asset)} slides` : 'Spread across 2 slides', onSelect: () => spread(asset) },
      { label: 'New slide with this', onSelect: () => addMediaAsSlides([asset]) },
      ...(slot ? [{ label: slot.assetId ? `Replace photo in “${slot.name}”` : `Fill “${slot.name}”`, onSelect: () => updateLayer(slot.id, { assetId: asset.id, locked: false }) }] : []),
      { separator: true },
      { label: 'Remove from project', danger: true, onSelect: () => void remove(asset.id) },
    ], asset.name);
  };

  const findSelectedImageLayer = () => {
    return selectedLayerId && selectedLayer?.kind === 'image' ? selectedLayer : null;
  };

  const handleAssetClick = (asset: AssetMeta) => {
    const sel = findSelectedImageLayer();
    if (sel?.assetId === asset.id) {
      duplicateLayer(sel.id);
      return;
    }
    if (sel) {
      updateLayer(sel.id, { assetId: asset.id, locked: false });
    } else {
      addImageLayer(asset.id, { width: asset.width, height: asset.height });
    }
  };

  const targetSlot = findSelectedImageLayer();

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      <PanelHeader title="Media" action={assets.length > 0 ? <span className="text-xs tabular-nums text-ink-faint">{assets.length}</span> : undefined} />
      <div className="flex flex-col gap-2 px-3 pb-3">
        <button
          className="group flex w-full items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-2.5 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
          onClick={() => { importAsSlides.current = false; inputRef.current?.click(); }}
          disabled={busy}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-ink">{busy ? 'Importing…' : 'Import media'}</span>
            <span className="block text-[11px] text-ink-faint">or drop photos, GIFs, and videos</span>
          </span>
        </button>
        <button
          className="flex items-center gap-1.5 self-start rounded px-0.5 text-[11px] font-medium text-ink-dim hover:text-ink disabled:opacity-60"
          onClick={() => { importAsSlides.current = true; inputRef.current?.click(); }}
          disabled={busy}
          title="Import photos and give each one its own slide. Panoramas span as many slides as they need."
        >
          <GalleryHorizontalEnd size={13} aria-hidden /> Import as new slides
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,.heic,.heif,.avif,.webp,.mp4,.mov,.m4v,.webm"
          multiple
          hidden
          onChange={(e) => {
            const asSlides = importAsSlides.current;
            importAsSlides.current = false;
            handleFiles(e.target.files, asSlides);
            e.target.value = '';
          }}
        />
        {importMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-bg-inset px-3 py-2 text-xs text-ink-dim">
            <div className="flex-1 leading-relaxed">{importMessage}</div>
            <button className="text-ink-faint hover:text-ink" onClick={clearImportMessage} title="Dismiss" aria-label="Dismiss import message">
              <X size={14} />
            </button>
          </div>
        )}
        {assets.length > 0 && (
          <p className={`rounded-lg px-3 py-2 text-[11px] leading-relaxed ${targetSlot ? 'bg-accent-soft text-accent' : 'text-ink-faint'}`}>
            {targetSlot
              ? targetSlot.assetId
                ? <>Click to replace the photo in <strong>{targetSlot.name}</strong>, or click its current photo to duplicate it.</>
                : <>Click a photo to fill <strong>{targetSlot.name}</strong>.</>
              : 'Click a photo to add it to the slide.'}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 content-start gap-1.5 overflow-auto border-t border-line px-3 py-3 scrollbar-thin">
        {assets.map((a) => {
          const current = targetSlot?.assetId === a.id;
          const span = spanOf(a);
          return (
            <div key={a.id} className="group relative" onContextMenu={(e) => { e.preventDefault(); assetMenu(a, e.clientX, e.clientY); }}>
              <button
                className={`block aspect-square w-full overflow-hidden rounded-lg bg-bg-inset transition-shadow hover:ring-2 hover:ring-accent/60 ${current ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-panel' : ''}`}
                onClick={() => handleAssetClick(a)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-osc-asset', a.id);
                }}
                title={a.name}
              >
                <MediaThumbnail
                  asset={a}
                  broken={brokenThumbs.has(a.id)}
                  onError={() => {
                    setBrokenThumbs((prev) => new Set(prev).add(a.id));
                  }}
                />
              </button>
              {(a.mediaKind === 'video' || a.mediaKind === 'gif' || a.mime.startsWith('video/') || a.mime === 'image/gif') && (
                <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-semibold uppercase text-white">
                  <Film size={9} /> {a.mediaKind === 'gif' || a.mime === 'image/gif' ? 'GIF' : 'Video'}
                </span>
              )}
              {span > 1 && (
                <button
                  className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-md bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white opacity-80 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => spread(a)}
                  title={`Panorama — spread it across ${span} slides`}
                  aria-label={`Spread ${a.name} across ${span} slides`}
                >
                  <GalleryHorizontal size={10} aria-hidden /> {span}
                </button>
              )}
              {usedAssets.has(a.id) && (
                <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow" title="Used in this project">
                  <Check size={10} strokeWidth={3} aria-hidden />
                </span>
              )}
              <button
                className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white/80 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove(a.id)}
                title="Delete"
                aria-label={`Remove ${a.name} from this project`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
        {assets.length === 0 && (
          <div className="col-span-3">
            <EmptyState icon={<ImagePlus size={22} aria-hidden />} title="No media yet.">
              Drop images, GIFs, or videos here or use the import button above. Files stay on this device.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
