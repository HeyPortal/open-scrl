import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, Film, GalleryHorizontal, GalleryHorizontalEnd, Loader2, MoreHorizontal, Trash2, Upload, X } from 'lucide-react';
import type { AssetMeta } from '@/types';
import { useAssets } from '@/store/assets';
import { useEditor } from '@/store/editor';
import { useToasts } from '@/store/toasts';
import { useEditorSession } from '@/editor/sessionStore';
import { slideSpanFor } from '@/core/document/geometry';
import { getMediaKind } from '@/lib/media';
import { ASSET_DRAG_TYPE } from '../canvas/mediaDrop';
import { useContextMenu } from '../Menu';
import { PanelHeader } from '../ui';

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
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={onError}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
          <span className="text-[11px] font-medium uppercase leading-tight text-ink-dim">Media</span>
          <span className="max-w-full truncate text-[11px] leading-tight text-ink-dim">{asset.name}</span>
        </div>
      )}
    </div>
  );
}

const MEDIA_TYPES = 'JPG · PNG · HEIC · GIF · MP4 · MOV';

/**
 * Import area. With an empty library it is a large drop zone (desktop) or tap card (phone); once there is media it
 * shrinks to a single row so the photo grid stays in view. The panel root handles dropping and tracks the file drag
 * (`dragging`), so the zone lights up wherever on the panel files are held.
 */
function MediaDropZone({ sheet, compact, dragging, busy, onBrowse, onBrowseSlides }: { sheet: boolean; compact: boolean; dragging: boolean; busy: boolean; onBrowse: () => void; onBrowseSlides: () => void }) {
  const title = busy ? 'Importing…' : dragging ? (compact && !sheet ? 'Drop files' : 'Drop to import') : 'Import media';
  const icon = busy ? <Loader2 size={compact ? 15 : 20} className="animate-spin" aria-hidden /> : <Upload size={compact ? 15 : 20} aria-hidden />;
  const slidesTitle = 'Import photos and give each one its own slide. Panoramas span as many slides as they need.';
  const slidesLabel = sheet ? 'As slides' : 'Import as new slides';
  if (compact) {
    return (
      <div className={`media-dropzone media-dropzone-compact ${sheet ? 'media-dropzone-sheet' : ''}`} data-dragging={dragging || undefined}>
        <button type="button" className="media-dropzone-main" onClick={onBrowse} disabled={busy}>
          <span className="media-dropzone-icon flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">{icon}</span>
          <span className="media-dropzone-title min-w-0 truncate">{title}</span>
        </button>
        <button type="button" className="media-dropzone-slides" onClick={onBrowseSlides} disabled={busy} title={slidesTitle}>
          <GalleryHorizontalEnd size={sheet ? 17 : 14} aria-hidden /> {slidesLabel}
        </button>
      </div>
    );
  }
  return (
    <div className={`media-dropzone ${sheet ? 'media-dropzone-sheet' : ''}`} data-dragging={dragging || undefined}>
      <button type="button" className="media-dropzone-main flex w-full flex-col items-center text-center disabled:opacity-60" onClick={onBrowse} disabled={busy}>
        <span className="media-dropzone-icon flex items-center justify-center rounded-full bg-accent text-accent-ink">{icon}</span>
        <span className="media-dropzone-title text-ink">{title}</span>
        <span className="media-dropzone-hint leading-snug text-ink-dim">
          {sheet ? 'Photos, GIFs, and videos from your device' : <>Drop photos, GIFs, and videos here, or <span className="media-dropzone-browse font-medium text-accent">browse</span></>}
        </span>
        {!sheet && <span className="media-dropzone-types text-ink-faint">{MEDIA_TYPES}</span>}
        <span className="media-dropzone-private text-ink-faint">Files stay on this device</span>
      </button>
      <button type="button" className="media-dropzone-slides" onClick={onBrowseSlides} disabled={busy} title={slidesTitle}>
        <GalleryHorizontalEnd size={sheet ? 17 : 14} aria-hidden /> {slidesLabel}
      </button>
    </div>
  );
}

export function PhotosPanel({ layout = 'sidebar' }: { layout?: 'sidebar' | 'sheet' }) {
  const sheet = layout === 'sheet';
  const activeProjectId = useEditor((s) => s.activeProjectId);
  const assetProjectId = useAssets((s) => s.projectId);
  const scopedAssets = useAssets((s) => s.assets);
  const assets = assetProjectId === activeProjectId ? scopedAssets : [];
  const importFiles = useAssets((s) => s.importFiles);
  const remove = useAssets((s) => s.remove);
  const importMessage = useAssets((s) => s.importMessage);
  const clearImportMessage = useAssets((s) => s.clearImportMessage);

  const [busy, setBusy] = useState(false);
  // A file drag over anywhere on the panel lights up the import zone; the depth counter ignores child enter/leave pairs.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files');
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
  const assignPhoto = useEditor((s) => s.assignPhoto);
  const selectedLayerId = useEditorSession((s) => s.selectedLayerId);
  const selectLayer = useEditorSession((s) => s.selectLayer);
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
    const importingProjectId = useEditor.getState().activeProjectId;
    setBusy(true);
    try {
      const imported = await importFiles(files);
      if (useEditor.getState().activeProjectId !== importingProjectId) return;
      if (asSlides && imported.length) {
        addMediaAsSlides(imported);
        const count = imported.reduce((n, a) => n + spanOf(a), 0);
        addToast(`Created ${count} slide${count === 1 ? '' : 's'} from ${imported.length} item${imported.length === 1 ? '' : 's'}.`, 'success');
        return;
      }
      const panorama = imported.find((a) => spanOf(a) > 1);
      if (panorama) {
        addToast(`“${panorama.name}” is a panorama.`, 'info', { label: `Spread across ${spanOf(panorama)} slides`, run: () => { if (useEditor.getState().activeProjectId === importingProjectId) spread(panorama); } });
      }
    } finally {
      setBusy(false);
    }
  };

  const assetMenu = (asset: AssetMeta, x: number, y: number, trigger?: HTMLElement) => {
    const slot = findSelectedImageLayer();
    openMenu(x, y, [
      { label: 'Add to slide', onSelect: () => addImageLayer(asset.id, { width: asset.width, height: asset.height }) },
      { label: spanOf(asset) > 1 ? `Spread across ${spanOf(asset)} slides` : 'Spread across 2 slides', onSelect: () => spread(asset) },
      { label: 'New slide with this', onSelect: () => addMediaAsSlides([asset]) },
      ...(slot ? [{ label: slot.assetId ? `Replace photo in “${slot.name}”` : `Fill “${slot.name}”`, onSelect: () => { assignPhoto(slot.id, asset.id); } }] : []),
      { separator: true },
      { label: 'Remove from project', danger: true, onSelect: () => void remove(asset.id) },
    ], asset.name, trigger);
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
      assignPhoto(sel.id, asset.id);
    } else {
      addImageLayer(asset.id, { width: asset.width, height: asset.height });
    }
  };

  const targetSlot = findSelectedImageLayer();

  return (
    <div
      className={sheet ? 'lib-panel flex flex-col' : 'lib-panel flex h-full flex-col'}
      onDragEnter={(e) => { if (!isFileDrag(e)) return; dragDepth.current += 1; setDragging(true); }}
      onDragLeave={(e) => { if (!isFileDrag(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        // Handled here; the editor shell's import fallback must not import the same files again.
        e.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {!sheet && <PanelHeader title="Media" action={assets.length > 0 ? <span className="media-count" aria-label={`${assets.length} media ${assets.length === 1 ? 'item' : 'items'}`}>{assets.length}</span> : undefined} />}
      <div className={sheet ? 'flex flex-col gap-2.5 px-4 pb-3 pt-1' : 'flex shrink-0 flex-col gap-2.5 px-3 pb-3'}>
        <MediaDropZone
          sheet={sheet}
          compact={assets.length > 0}
          dragging={dragging}
          busy={busy}
          onBrowse={() => { importAsSlides.current = false; inputRef.current?.click(); }}
          onBrowseSlides={() => { importAsSlides.current = true; inputRef.current?.click(); }}
        />
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
          <div role="status" className={`flex items-center gap-1 rounded-lg bg-bg-inset text-ink-dim ${sheet ? 'min-h-11 pl-3.5 pr-1 text-[13px]' : 'min-h-8 pl-3 pr-0.5 text-xs'}`}>
            <div className="min-w-0 flex-1 py-1.5 leading-snug">{importMessage}</div>
            <button className={`flex shrink-0 items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink ${sheet ? 'h-11 w-11' : 'h-7 w-7'}`} onClick={clearImportMessage} title="Dismiss" aria-label="Dismiss import message">
              <X size={14} aria-hidden />
            </button>
          </div>
        )}
        {assets.length > 0 && (sheet ? (
          <p className={`flex min-h-9 items-center gap-2 rounded-lg text-[12px] leading-snug ${targetSlot ? 'bg-accent-soft px-3 py-1.5 text-accent' : 'px-0.5 text-ink-dim'}`}>
            <span className="min-w-0 flex-1">
              {targetSlot
                ? targetSlot.assetId
                  ? <>Tap a photo to replace <strong>{targetSlot.name}</strong>, or its current photo to duplicate it.</>
                  : <>Tap a photo to fill <strong>{targetSlot.name}</strong>.</>
                : 'Tap a photo to add it to the slide.'}
            </span>
            {targetSlot && <button className="-my-1.5 flex min-h-11 shrink-0 items-center rounded-md px-2 font-semibold underline underline-offset-2 active:bg-accent-soft" onClick={() => selectLayer(null)}>Add new instead</button>}
          </p>
        ) : (
          <p className={`rounded-lg text-[11px] leading-relaxed ${targetSlot ? 'bg-accent-soft px-3 py-2 text-accent' : 'px-0.5 text-ink-dim'}`}>
            {targetSlot
              ? targetSlot.assetId
                ? <>Click or drag a photo onto <strong>{targetSlot.name}</strong> to replace it, or click its current photo to duplicate it.</>
                : <>Click a photo to fill <strong>{targetSlot.name}</strong>.</>
              : 'Click a photo to add it to the slide, or drag it onto a frame or the canvas.'}
          </p>
        ))}
      </div>
      <div className={sheet ? 'grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] content-start gap-2 border-t border-line px-4 py-3' : 'grid min-h-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-auto border-t border-line px-3 py-3 scrollbar-thin'}>
        {assets.map((a) => {
          const current = targetSlot?.assetId === a.id;
          const span = spanOf(a);
          return (
            <div key={a.id} className="group relative" onContextMenu={(e) => { e.preventDefault(); assetMenu(a, e.clientX, e.clientY); }}>
              <button
                className={`block aspect-square w-full overflow-hidden bg-bg-inset transition-shadow hover:ring-2 hover:ring-accent/60 ${sheet ? 'rounded-xl' : 'rounded-lg'} ${current ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg-panel' : ''}`}
                onClick={() => handleAssetClick(a)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id);
                  e.dataTransfer.effectAllowed = 'copy';
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
                <span className="pointer-events-none absolute bottom-1 left-1 flex h-5 items-center gap-1 rounded-md bg-black/65 px-1.5 text-[11px] font-semibold uppercase leading-none text-white">
                  <Film size={11} aria-hidden /> {a.mediaKind === 'gif' || a.mime === 'image/gif' ? 'GIF' : 'Video'}
                </span>
              )}
              {span > 1 && (
                <button
                  // The sheet's visible chip stays compact; its padded hit area reaches 44 px.
                  className={`absolute bottom-1 right-1 flex h-5 items-center gap-1 rounded-md bg-black/70 px-1.5 text-[11px] font-semibold leading-none text-white opacity-80 transition-opacity hover:bg-accent hover:text-accent-ink hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 ${sheet ? 'after:absolute after:-inset-3' : ''}`}
                  onClick={() => spread(a)}
                  title={`Panorama — spread it across ${span} slides`}
                  aria-label={`Spread ${a.name} across ${span} slides`}
                >
                  <GalleryHorizontal size={12} aria-hidden /> {span}
                </button>
              )}
              {usedAssets.has(a.id) && (
                <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink shadow" title="Used in this project">
                  <Check size={10} strokeWidth={3} aria-hidden />
                </span>
              )}
              {sheet ? (
                // A 44 px hit area reaching into the grid gap; only the 24 px glass chip in the corner is drawn.
                <button
                  className="group/more absolute -right-1 -top-1 flex h-11 w-11 items-start justify-end p-2"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); assetMenu(a, r.right - 220, r.bottom + 4, e.currentTarget); }}
                  aria-label={`More actions for ${a.name}`}
                  aria-haspopup="menu"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm transition-colors group-active/more:bg-black/75">
                    <MoreHorizontal size={14} aria-hidden />
                  </span>
                </button>
              ) : (
                <button
                  className="absolute right-1 top-1 rounded-md bg-black/70 p-1.5 text-white/80 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => remove(a.id)}
                  title="Delete"
                  aria-label={`Remove ${a.name} from this project`}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
