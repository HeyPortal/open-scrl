import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, ImageOff, Sparkles } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { useAssets } from '@/store/assets';
import type { AssetMeta, Background, Gradient } from '@/types';
import { GRADIENT_SWATCHES, SOLID_SWATCHES, backgroundCss, sameBackground } from '@/lib/palette';
import { backgroundGradient, gradientBackground } from '@/render/paint/gradient';
import { getMediaKind } from '@/lib/media';
import { ColorField, PanelHeader, Slider } from '../ui';
import { GradientEditor, Segmented } from '../inspector/controls';
import { useEditGesture } from '../inspector/useLayerGesture';

type Mode = Background['kind'];

const GRADIENT_PRESETS: Gradient[] = [
  ...GRADIENT_SWATCHES.map((g) => ({ type: 'linear' as const, angle: g.angle, stops: [{ offset: 0, color: g.from }, { offset: 1, color: g.to }] })),
  { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#fde68a' }, { offset: 0.5, color: '#fb7185' }, { offset: 1, color: '#7c5cff' }] },
  { type: 'linear', angle: 160, stops: [{ offset: 0, color: '#0f172a' }, { offset: 0.55, color: '#1e3a8a' }, { offset: 1, color: '#7c3aed' }] },
  { type: 'linear', angle: 120, stops: [{ offset: 0, color: '#fef3c7' }, { offset: 0.5, color: '#fecaca' }, { offset: 1, color: '#e9d5ff' }] },
  { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#c7d2fe' }] },
  { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#f97316' }, { offset: 0.5, color: '#db2777' }, { offset: 1, color: '#4c1d95' }] },
  { type: 'radial', angle: 0, stops: [{ offset: 0, color: '#34d399' }, { offset: 0.6, color: '#0e7490' }, { offset: 1, color: '#0f172a' }] },
];

function SolidSwatch({ color, active, onClick }: { color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`relative flex aspect-square items-center justify-center rounded-md ring-1 ring-inset ring-white/10 transition-transform hover:scale-105 ${active ? 'outline outline-2 outline-offset-2 outline-accent' : ''}`}
      style={{ background: color }} onClick={onClick} aria-label={`Solid ${color}`} aria-pressed={active} title={color}
    >
      {active && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow"><Check size={10} strokeWidth={3} aria-hidden /></span>}
    </button>
  );
}

function AssetTile({ asset, active, onClick }: { asset: AssetMeta; active: boolean; onClick: () => void }) {
  const url = useAssets((s) => s.thumbs[asset.id]);
  const ensureThumb = useAssets((s) => s.ensureThumb);
  useEffect(() => { if (!url) void ensureThumb(asset.id); }, [asset.id, ensureThumb, url]);
  return (
    <button type="button" onClick={onClick} aria-pressed={active} title={asset.name}
      className={`relative aspect-square overflow-hidden rounded-md bg-bg-inset ring-1 ring-inset transition-transform hover:scale-[1.03] ${active ? 'outline outline-2 outline-offset-2 outline-accent ring-transparent' : 'ring-white/10'}`}>
      {url && <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />}
      {active && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow"><Check size={10} strokeWidth={3} aria-hidden /></span>}
    </button>
  );
}

/** `sheet` is the touch layout used inside the mobile bottom sheet; `sidebar` is the desktop panel. */
export function BackgroundPanel({ layout = 'sidebar' }: { layout?: 'sidebar' | 'sheet' }) {
  const sheet = layout === 'sheet';
  const px = sheet ? 'px-4' : 'px-3';
  const setBackground = useEditor((s) => s.setBackground);
  const setBackgroundForAllSlides = useEditor((s) => s.setBackgroundForAllSlides);
  const selectedSlideId = useEditorSession((s) => s.selectedSlideId);
  const slideCount = useEditor((s) => s.doc.slideOrder.length);
  const slideId = useEditor((s) => selectedSlideId || s.doc.slideOrder[0]);
  const slide = useEditor((s) => s.doc.slides[slideId]);
  const slideIndex = useEditor((s) => s.doc.slideOrder.indexOf(slideId));
  const slidePhotoIds = useEditor(useShallow((s) => (s.doc.slides[slideId]?.layerOrder ?? []).map((id) => s.doc.layers[id]).flatMap((l) => (l?.kind === 'image' && l.assetId ? [l.assetId] : []))));
  const assets = useAssets((s) => s.assets).filter((a) => getMediaKind(a) !== 'video');
  const gesture = useEditGesture('Change background', `background:${slideId}`);
  const stored = slide?.background;
  const current = useMemo<Background>(() => stored ?? { kind: 'solid', color: '#ffffff' }, [stored]);
  const [mode, setMode] = useState<Mode>(current.kind);
  useEffect(() => setMode(current.kind), [current.kind, slideId]);

  // Remember the last value of each kind so switching modes back and forth doesn't lose edits.
  const [memory, setMemory] = useState<Partial<Record<Mode, Background>>>({});
  useEffect(() => setMemory((m) => ({ ...m, [current.kind]: current })), [current]);

  const choose = (next: Mode) => {
    setMode(next);
    if (next === current.kind) return;
    if (memory[next]) { setBackground(memory[next]!); return; }
    const base = current.kind === 'solid' ? current.color : current.kind === 'gradient' ? current.from : current.kind === 'image' ? current.color : '#ffffff';
    if (next === 'solid') setBackground({ kind: 'solid', color: base });
    else if (next === 'gradient') setBackground(gradientBackground(GRADIENT_PRESETS[0]));
    else if (next === 'transparent') setBackground({ kind: 'transparent' });
    else {
      // Default to a soft, blurred copy of this slide's photo: the classic carousel backdrop.
      const assetId = slidePhotoIds[0] ?? assets[0]?.id ?? null;
      setBackground({ kind: 'image', assetId, blur: assetId && slidePhotoIds.includes(assetId) ? 48 : 0, dim: 0, color: '#111111' });
    }
  };

  const gradient = current.kind === 'gradient' ? backgroundGradient(current) : GRADIENT_PRESETS[0];
  const image = current.kind === 'image' ? current : null;

  return (
    <div className={sheet ? 'flex flex-col' : 'flex h-full flex-col overflow-auto scrollbar-thin'}>
      {sheet
        ? <p className="px-4 pb-3 text-[12px] leading-relaxed text-ink-faint">Changes apply to slide {Math.max(1, slideIndex + 1)}.</p>
        : <PanelHeader title="Background" hint={`Changes apply to slide ${Math.max(1, slideIndex + 1)}.`} />}
      <div className={`${px} pb-3`}>
        <Segmented label="Background type" value={mode} onChange={choose} options={[
          { value: 'solid', label: 'Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'image', label: 'Photo' },
          { value: 'transparent', label: 'None', title: 'Transparent' },
        ]} />
      </div>

      {mode === 'solid' && (
        <div className={`border-t border-line ${px} py-3.5`}>
          <div className="grid grid-cols-6 gap-2">
            {SOLID_SWATCHES.map((c) => <SolidSwatch key={c} color={c} active={sameBackground(current, { kind: 'solid', color: c })} onClick={() => setBackground({ kind: 'solid', color: c })} />)}
          </div>
          <div className={`mt-3 ${sheet ? '[&_label]:h-11 [&_label]:rounded-xl [&_label]:px-2.5' : ''}`}>
            <ColorField value={current.kind === 'solid' ? current.color : '#ffffff'} onChange={(color) => setBackground({ kind: 'solid', color })} label="Custom background color" />
          </div>
        </div>
      )}

      {mode === 'gradient' && (
        <div className={`border-t border-line ${px} py-3.5`}>
          <GradientEditor value={gradient} onChange={(g) => setBackground(gradientBackground(g))} gesture={gesture} presets={GRADIENT_PRESETS} />
        </div>
      )}

      {mode === 'image' && (
        <div className={`space-y-3 border-t border-line ${px} py-3.5`}>
          {image && (
            <>
              <div className="relative h-20 overflow-hidden rounded-lg ring-1 ring-inset ring-white/10" style={{ background: image.color }}>
                {image.assetId && <BackdropPreview assetId={image.assetId} blur={image.blur} dim={image.dim} />}
                {!image.assetId && <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint"><ImageOff size={13} aria-hidden /> Choose a photo below</span>}
              </div>
              <Slider label="Blur" display={image.blur ? `${Math.round(image.blur)} px` : 'Sharp'} min={0} max={120} value={image.blur} onChange={(blur) => setBackground({ ...image, blur })} gesture={gesture} valueText={`${Math.round(image.blur)} pixels`} />
              <Slider label="Darken" display={`${Math.round(image.dim * 100)}%`} min={0} max={0.8} step={0.01} value={image.dim} onChange={(dim) => setBackground({ ...image, dim })} gesture={gesture} valueText={`${Math.round(image.dim * 100)} percent`} />
            </>
          )}
          {slidePhotoIds.length > 0 && image && !slidePhotoIds.includes(image.assetId ?? '') && (
            <button className="btn btn-secondary btn-sm w-full" onClick={() => setBackground({ ...image, assetId: slidePhotoIds[0], blur: Math.max(image.blur, 48) })}>
              <Sparkles size={13} aria-hidden /> Blur this slide’s photo
            </button>
          )}
          <div>
            <p className="field-label mb-1.5">Photo</p>
            {assets.length ? (
              <div className="grid grid-cols-4 gap-1.5">
                {assets.map((a) => <AssetTile key={a.id} asset={a} active={image?.assetId === a.id} onClick={() => setBackground({ kind: 'image', assetId: a.id, blur: image?.blur ?? 0, dim: image?.dim ?? 0, color: image?.color ?? '#111111' })} />)}
              </div>
            ) : (
              <p className="rounded-lg bg-bg-inset px-3 py-2 text-[11px] leading-relaxed text-ink-faint">Import photos in <strong className="text-ink-dim">Media</strong> to use one as the background.</p>
            )}
          </div>
        </div>
      )}

      {mode === 'transparent' && (
        <div className={`border-t border-line ${px} py-3.5`}>
          <div className="h-20 rounded-lg ring-1 ring-inset ring-white/10" style={{ background: backgroundCss({ kind: 'transparent' }) }} aria-hidden />
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">Slides export as PNG with a transparent background. Video slides use white, since MP4 has no transparency.</p>
        </div>
      )}

      {slide && slideCount > 1 && (
        <div className={`mt-auto border-t border-line ${sheet ? 'px-4 py-4' : 'p-4'}`}>
          <button className="btn btn-secondary w-full" onClick={() => setBackgroundForAllSlides(slide.background)}>
            Apply to all {slideCount} slides
          </button>
        </div>
      )}
    </div>
  );
}

function BackdropPreview({ assetId, blur, dim }: { assetId: string; blur: number; dim: number }) {
  const url = useAssets((s) => s.thumbs[assetId]);
  const ensureThumb = useAssets((s) => s.ensureThumb);
  useEffect(() => { if (!url) void ensureThumb(assetId); }, [assetId, ensureThumb, url]);
  // The preview is ~1/4 of a slide's width, so scale the blur to match what the canvas shows.
  return (
    <>
      {url && <img src={url} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover" style={{ filter: `blur(${blur / 4}px)` }} draggable={false} />}
      {dim > 0 && <span className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </>
  );
}
