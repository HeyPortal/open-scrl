import { useEffect, useRef, useState } from 'react';
import type { ImageLayer } from '@/types';
import { getAssetThumbUrl } from '@/lib/assets';
import { useEditor } from '@/store/editor';
import { FRAME_PRESETS, photoWindow } from '@/render/paint/frames';
import { paintImageContent } from '@/render/paint/layers';
import { Section } from '../ui';

type Preset = typeof FRAME_PRESETS[number];
function Preview({ layer, preset, image }: { layer: ImageLayer; preset: Preset; image: HTMLImageElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, 200, 150);
    const width = layer.width, height = layer.height;
    const scale = Math.min(170 / width, 122 / height);
    const preview = { ...layer, frameStyle: preset.style, stroke: preset.color, strokeWidth: Math.round(Math.min(width, height) * preset.scale), cornerRadius: 0, mask: 'rect' as const };
    ctx.save(); ctx.translate((200 - width * scale) / 2, (150 - height * scale) / 2); ctx.scale(scale, scale);
    if (!image) { const r = photoWindow(preview); ctx.fillStyle = '#687487'; ctx.fillRect(r.x, r.y, r.width, r.height); }
    paintImageContent(ctx, preview, image ? { source: image, width: image.naturalWidth, height: image.naturalHeight } : null);
    ctx.restore();
  }, [layer, preset, image]);
  return <canvas ref={ref} width={200} height={150} aria-hidden className="w-full rounded bg-bg-inset"/>;
}
export function FrameGallery({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let cancelled = false; setImage(null);
    if (layer.assetId) void getAssetThumbUrl(layer.assetId).then((url) => {
      if (!url || cancelled) return;
      const photo = new Image(); photo.onload = () => { if (!cancelled) setImage(photo); }; photo.src = url;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [layer.assetId]);
  return <Section title="Frame gallery">
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Photo frame presets">
      {FRAME_PRESETS.map((preset) => {
        const width = Math.round(Math.min(layer.width, layer.height) * preset.scale);
        const active = preset.id === 'none' ? (layer.strokeWidth ?? 0) === 0 : preset.style ? layer.frameStyle === preset.style && (layer.strokeWidth ?? 0) > 0 : !layer.frameStyle && (layer.strokeWidth ?? 0) === width && (preset.id === 'none' || (layer.stroke ?? '#ffffff').toLowerCase() === preset.color);
        return <button key={preset.id} type="button" aria-pressed={active} aria-label={`${preset.label} frame`} className={`tile p-1.5 text-left ${active ? 'ring-2 ring-accent' : ''}`} onClick={() => updateLayer(layer.id, { frameStyle: preset.style, mask: 'rect', cornerRadius: 0, strokeWidth: width, stroke: preset.color })}>
          <Preview layer={layer} preset={preset} image={image}/><span className="mt-1.5 block text-sm font-medium">{preset.label}</span>
        </button>;
      })}
    </div>
    <p className="text-sm leading-relaxed text-ink-dim">Adjust the frame’s color and width below. The photo fits inside decorative frames.</p>
  </Section>;
}
