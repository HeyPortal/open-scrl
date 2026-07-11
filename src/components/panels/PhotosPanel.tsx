import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { AssetMeta } from '@/types';
import { useAssets } from '@/store/assets';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';

export function PhotosPanel() {
  const assets = useAssets((s) => s.assets);
  const thumbs = useAssets((s) => s.thumbs);
  const importFiles = useAssets((s) => s.importFiles);
  const remove = useAssets((s) => s.remove);
  const importMessage = useAssets((s) => s.importMessage);
  const clearImportMessage = useAssets((s) => s.clearImportMessage);

  const [busy, setBusy] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addImageLayer = useEditor((s) => s.addImageLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const selectedLayerId = useEditorSession((s) => s.selectedLayerId);
  const selectedLayer = useEditor((s) => selectedLayerId ? s.doc.layers[selectedLayerId] : undefined);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await importFiles(files);
    } finally {
      setBusy(false);
    }
  };

  const findSelectedImageLayer = () => {
    return selectedLayerId && selectedLayer?.kind === 'image' ? selectedLayer : null;
  };

  const handleAssetClick = (asset: AssetMeta) => {
    const sel = findSelectedImageLayer();
    if (sel) {
      updateLayer(sel.id, { assetId: asset.id, locked: false });
    } else {
      addImageLayer(asset.id, { width: asset.width, height: asset.height });
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="panel-section">Photos</div>
      <div className="px-3 pb-3 flex flex-col gap-2 border-b border-line">
        <button
          className="ctrl-btn justify-center"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload size={14} /> {busy ? 'Importing…' : 'Import images'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif,.avif,.webp"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {importMessage && (
          <div className="text-[11px] text-ink-dim bg-bg-inset border border-line rounded-md px-2 py-2">
            <div>{importMessage}</div>
            <button className="mt-1 text-accent hover:text-accent-hover" onClick={clearImportMessage}>
              dismiss
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 p-2 overflow-auto scrollbar-thin">
        {assets.map((a) => (
          <div key={a.id} className="relative group">
            <button
              className="block w-full aspect-square bg-bg-inset overflow-hidden rounded hover:ring-2 hover:ring-accent"
              onClick={() => handleAssetClick(a)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-osc-asset', a.id);
              }}
              title={a.name}
            >
              {thumbs[a.id] && !brokenThumbs.has(a.id) ? (
                <img
                  src={thumbs[a.id]}
                  className="w-full h-full object-cover"
                  alt={a.name}
                  loading="lazy"
                  decoding="async"
                  onError={() => {
                    setBrokenThumbs((prev) => new Set(prev).add(a.id));
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center px-1 text-center">
                  <span className="text-[10px] text-ink-dim uppercase">Image</span>
                  <span className="text-[9px] text-ink-faint truncate max-w-full">{a.name}</span>
                </div>
              )}
            </button>
            <button
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-black/60 rounded p-1 hover:bg-black/80"
              onClick={() => remove(a.id)}
              title="Delete"
            >
              <Trash2 size={12} className="text-white" />
            </button>
          </div>
        ))}
        {assets.length === 0 && (
          <div className="col-span-3 text-center text-xs text-ink-faint py-12 px-3">
            No photos yet. Drop images here or use the button above.
          </div>
        )}
      </div>
    </div>
  );
}
