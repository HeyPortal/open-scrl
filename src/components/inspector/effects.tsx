import { FrameGallery } from './FrameGallery';
import { RotateCcw } from 'lucide-react';
import { useEditor } from '@/store/editor';
import type { Gradient, ImageLayer, Layer, Shadow, TextHighlight, TextLayer } from '@/types';
import { maskUsesCornerRadius } from '@/render/paint/masks';
import { ColorField, NumberField, Section, Slider } from '../ui';
import { EffectSection, GradientEditor, MaskPicker, Segmented, contrastingColor, joinAlpha, splitAlpha } from './controls';
import { useLayerGesture } from './useLayerGesture';

const SHADOW_PRESETS: { label: string; shadow: Shadow }[] = [
  { label: 'Soft', shadow: { color: '#000000', opacity: 0.28, blur: 32, offsetX: 0, offsetY: 14 } },
  { label: 'Lifted', shadow: { color: '#000000', opacity: 0.38, blur: 70, offsetX: 0, offsetY: 34 } },
  { label: 'Hard', shadow: { color: '#000000', opacity: 0.9, blur: 0, offsetX: 10, offsetY: 10 } },
  { label: 'Glow', shadow: { color: '#ffffff', opacity: 0.85, blur: 36, offsetX: 0, offsetY: 0 } },
];

const sameShadow = (a: Shadow, b: Shadow) => a.color.toLowerCase() === b.color.toLowerCase() && a.opacity === b.opacity && a.blur === b.blur && a.offsetX === b.offsetX && a.offsetY === b.offsetY;

/** Drop shadow for any layer kind. */
export function ShadowSection({ layer }: { layer: Layer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const gesture = useLayerGesture(layer.id, 'Change shadow');
  const shadow = layer.shadow;
  const set = (patch: Partial<Shadow>) => shadow && updateLayer(layer.id, { shadow: { ...shadow, ...patch } });
  return (
    <EffectSection title="Shadow" enabled={!!shadow} onToggle={(on) => updateLayer(layer.id, { shadow: on ? SHADOW_PRESETS[0].shadow : null })} hint="A drop shadow that follows the layer’s outline.">
      {shadow && (
        <>
          <div className="grid grid-cols-4 gap-1">
            {SHADOW_PRESETS.map((p) => {
              const active = sameShadow(p.shadow, shadow);
              return (
                <button key={p.label} type="button" aria-pressed={active} onClick={() => updateLayer(layer.id, { shadow: p.shadow })}
                  className={`insp-chip h-7 rounded-md text-[11px] font-medium transition-colors ${active ? 'bg-accent-soft text-accent ring-1 ring-inset ring-accent' : 'bg-bg-inset text-ink-dim hover:bg-bg-hover hover:text-ink'}`}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <ColorField value={shadow.color} onChange={(color) => set({ color })} label="Shadow color" />
          <Slider label="Opacity" display={`${Math.round(shadow.opacity * 100)}%`} min={0} max={1} step={0.01} value={shadow.opacity} onChange={(opacity) => set({ opacity })} gesture={gesture} valueText={`${Math.round(shadow.opacity * 100)} percent`} />
          <Slider label="Blur" display={`${Math.round(shadow.blur)} px`} min={0} max={160} value={shadow.blur} onChange={(blur) => set({ blur })} gesture={gesture} valueText={`${Math.round(shadow.blur)} pixels`} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField prefix="X" ariaLabel="Shadow horizontal offset" suffix="px" value={shadow.offsetX} onChange={(offsetX) => set({ offsetX })} gesture={gesture} />
            <NumberField prefix="Y" ariaLabel="Shadow vertical offset" suffix="px" value={shadow.offsetY} onChange={(offsetY) => set({ offsetY })} gesture={gesture} />
          </div>
        </>
      )}
    </EffectSection>
  );
}

/** Solid or gradient text color. */
export function TextFillSection({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const gesture = useLayerGesture(layer.id, 'Change text gradient');
  const gradient = layer.fillGradient && layer.fillGradient.stops.length >= 2 ? layer.fillGradient : null;
  const startGradient = (): Gradient => ({ type: 'linear', angle: 90, stops: [{ offset: 0, color: layer.fill.slice(0, 7) }, { offset: 1, color: '#7c5cff' }] });
  return (
    <Section title="Fill" action={<div className="w-[132px]"><Segmented label="Text fill" value={gradient ? 'gradient' : 'solid'} onChange={(mode) => updateLayer(layer.id, { fillGradient: mode === 'gradient' ? startGradient() : null })} options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]} /></div>}>
      {gradient
        ? <GradientEditor value={gradient} onChange={(fillGradient) => updateLayer(layer.id, { fillGradient })} gesture={gesture} />
        : <ColorField value={layer.fill} onChange={(fill) => updateLayer(layer.id, { fill })} label="Text color" />}
    </Section>
  );
}

export function TextOutlineSection({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const gesture = useLayerGesture(layer.id, 'Change outline');
  const width = layer.strokeWidth ?? 0;
  const enabled = width > 0;
  return (
    <EffectSection title="Outline" enabled={enabled}
      onToggle={(on) => updateLayer(layer.id, on ? { strokeWidth: Math.max(2, Math.round(layer.fontSize * 0.05)), stroke: layer.stroke && layer.stroke !== layer.fill ? layer.stroke : contrastingColor(layer.fill) } : { strokeWidth: 0 })}
      hint="A stroke around every letter. Great on busy photos.">
      <ColorField value={layer.stroke ?? '#000000'} onChange={(stroke) => updateLayer(layer.id, { stroke })} label="Outline color" />
      <Slider label="Width" display={`${Math.round(width)} px`} min={1} max={Math.max(24, Math.round(layer.fontSize * 0.25))} value={width} onChange={(strokeWidth) => updateLayer(layer.id, { strokeWidth })} gesture={gesture} valueText={`${Math.round(width)} pixels`} />
    </EffectSection>
  );
}

export function TextHighlightSection({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const gesture = useLayerGesture(layer.id, 'Change highlight');
  const h = layer.highlight;
  const set = (patch: Partial<TextHighlight>) => h && updateLayer(layer.id, { highlight: { ...h, ...patch } });
  const color = h ? splitAlpha(h.color) : null;
  return (
    <EffectSection title="Highlight" enabled={!!h}
      onToggle={(on) => updateLayer(layer.id, { highlight: on ? { style: 'lines', color: contrastingColor(layer.fill), padding: Math.round(layer.fontSize * 0.25), radius: Math.round(layer.fontSize * 0.16) } : null })}
      hint="A colored box behind the text, around each line or the whole block.">
      {h && color && (
        <>
          <Segmented label="Highlight style" value={h.style} onChange={(style) => set({ style })} options={[{ value: 'lines', label: 'Each line' }, { value: 'box', label: 'One box' }]} />
          <ColorField value={color.rgb} onChange={(rgb) => set({ color: joinAlpha(rgb, color.alpha) })} label="Highlight color" />
          <Slider label="Opacity" display={`${Math.round(color.alpha * 100)}%`} min={0.05} max={1} step={0.01} value={color.alpha} onChange={(alpha) => set({ color: joinAlpha(color.rgb, alpha) })} gesture={gesture} valueText={`${Math.round(color.alpha * 100)} percent`} />
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Padding" display={`${Math.round(h.padding)} px`} min={0} max={Math.max(60, Math.round(layer.fontSize * 0.8))} value={h.padding} onChange={(padding) => set({ padding })} gesture={gesture} />
            <Slider label="Corners" display={`${Math.round(h.radius)} px`} min={0} max={Math.max(60, Math.round(layer.fontSize * 0.6))} value={h.radius} onChange={(radius) => set({ radius })} gesture={gesture} />
          </div>
        </>
      )}
    </EffectSection>
  );
}

/** Photo shape, corner radius and border. */
export function ImageFrameSection({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const radiusGesture = useLayerGesture(layer.id, 'Change corner radius');
  const borderGesture = useLayerGesture(layer.id, 'Change border');
  const mask = layer.mask ?? 'rect';
  const border = layer.strokeWidth ?? 0;
  const radiusMax = Math.max(1, Math.min(layer.width, layer.height) / (mask === 'rect' ? 2 : 4));
  return (
    <>
      <Section title="Shape" action={
        <button type="button" className="insp-link inline-flex items-center gap-1 text-xs font-medium text-ink-dim hover:text-ink" title="Reset crop, shape and corners"
          onClick={() => updateLayer(layer.id, { mask: 'rect', cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 })}>
          <RotateCcw size={12} aria-hidden /> Reset photo
        </button>
      }>
        <MaskPicker value={mask} onChange={(next) => updateLayer(layer.id, { mask: next, frameStyle: undefined })} />
        {maskUsesCornerRadius(mask) && (
          <Slider label="Corner radius" display={`${Math.round(layer.cornerRadius)} px`} min={0} max={radiusMax} value={Math.min(layer.cornerRadius, radiusMax)} onChange={(cornerRadius) => updateLayer(layer.id, { cornerRadius })} gesture={radiusGesture} valueText={`${Math.round(layer.cornerRadius)} pixels`} />
        )}
      </Section>
      <FrameGallery layer={layer}/>
      <EffectSection title="Border" enabled={border > 0}
        onToggle={(on) => updateLayer(layer.id, on ? { strokeWidth: Math.max(4, Math.round(Math.min(layer.width, layer.height) * 0.02)), stroke: layer.stroke ?? '#ffffff' } : { strokeWidth: 0 })}
        hint="A frame inside the photo’s outline.">
        <ColorField value={layer.stroke ?? '#ffffff'} onChange={(stroke) => updateLayer(layer.id, { stroke })} label="Border color" />
        <Slider label="Width" display={`${Math.round(border)} px`} min={1} max={Math.max(40, Math.round(Math.min(layer.width, layer.height) * 0.1))} value={border} onChange={(strokeWidth) => updateLayer(layer.id, { strokeWidth })} gesture={borderGesture} valueText={`${Math.round(border)} pixels`} />
      </EffectSection>
    </>
  );
}
