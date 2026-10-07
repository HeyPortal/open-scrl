import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { Gradient, GradientStop, ImageMask } from '@/types';
import { parseHex } from '@/render/paint/color';
import { gradientCss } from '@/render/paint/gradient';
import { IMAGE_MASKS, maskPath } from '@/render/paint/masks';
import { RotationDial } from '../RotationDial';
import { ColorField, NumberField, type Gesture } from '../ui';

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line-strong hover:bg-ink-faint/60'}`}
    >
      <span className={`absolute h-3.5 w-3.5 rounded-full bg-white shadow-soft transition-transform ${checked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
    </button>
  );
}

/** An inspector section for an optional effect: a switch in the header, controls only when on. */
export function EffectSection({ title, enabled, onToggle, children, hint }: { title: string; enabled: boolean; onToggle: (on: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <section className="border-b border-line px-3 py-3 last:border-b-0">
      <div className="flex h-5 items-center justify-between gap-2">
        <h3 className={`section-title ${enabled ? '' : 'text-ink-dim'}`}>{title}</h3>
        <Switch checked={enabled} onChange={onToggle} label={`${enabled ? 'Remove' : 'Add'} ${title.toLowerCase()}`} />
      </div>
      {enabled ? <div className="mt-2 space-y-2.5">{children}</div> : hint && <p className="mt-1 text-[11px] leading-snug text-ink-faint">{hint}</p>}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} className={`segmented-btn px-2 text-[11px] font-medium ${value === o.value ? 'segmented-btn-active' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `#rrggbb` and 0–1 alpha from any hex color, for pickers that don't support alpha. */
export function splitAlpha(hex: string) {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return { rgb: `#${h(c.r)}${h(c.g)}${h(c.b)}`, alpha: c.a };
}

export function joinAlpha(rgb: string, alpha: number) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return a >= 255 ? rgb : `${rgb}${a.toString(16).padStart(2, '0')}`;
}

/** Text that reads well on top of `hex`. */
export const contrastingColor = (hex: string) => {
  const c = parseHex(hex);
  if (!c) return '#000000';
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 150 ? '#111111' : '#ffffff';
};

function mix(a: string, b: string, t: number) {
  const x = parseHex(a) ?? { r: 0, g: 0, b: 0, a: 1 }, y = parseHex(b) ?? x;
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(x.r + (y.r - x.r) * t)}${h(x.g + (y.g - x.g) * t)}${h(x.b + (y.b - x.b) * t)}`;
}

function colorAt(stops: GradientStop[], offset: number) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (offset <= sorted[0].offset) return sorted[0].color;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (offset <= b.offset) return mix(a.color, b.color, (offset - a.offset) / Math.max(0.0001, b.offset - a.offset));
  }
  return sorted.at(-1)!.color;
}

/**
 * Edits a gradient: drag stops along the bar, click the bar to add one, pick a stop to change its
 * color. Linear gradients also get an angle.
 */
export function GradientEditor({ value, onChange, gesture, presets }: { value: Gradient; onChange: (g: Gradient) => void; gesture?: Gesture; presets?: Gradient[] }) {
  const [selected, setSelected] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const stops = value.stops;
  const index = Math.min(selected, stops.length - 1);
  const stop = stops[index];
  const setStops = (next: GradientStop[]) => onChange({ ...value, stops: next });
  const offsetAt = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onBarDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const offset = Math.round(offsetAt(e.clientX) * 100) / 100;
    setStops([...stops, { offset, color: colorAt(stops, offset) }]);
    setSelected(stops.length);
  };
  const onStopDown = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(i);
    drag.current = { index: i, moved: false };
  };
  const onStopMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) { d.moved = true; gesture?.begin(); }
    const offset = Math.round(offsetAt(e.clientX) * 100) / 100;
    setStops(stops.map((s, i) => (i === d.index ? { ...s, offset } : s)));
  };
  const onStopUp = () => {
    if (drag.current?.moved) gesture?.end();
    drag.current = null;
  };

  return (
    <div className="space-y-2.5">
      {presets && (
        <div className="grid grid-cols-6 gap-1.5">
          {presets.map((p) => (
            <button key={gradientCss(p)} type="button" className="aspect-square rounded ring-1 ring-inset ring-white/10 transition-transform hover:scale-110" style={{ background: gradientCss(p) }} onClick={() => { onChange(p); setSelected(0); }} aria-label="Use gradient preset" />
          ))}
        </div>
      )}
      <div className="px-2">
        <div
          ref={bar}
          className="relative h-6 cursor-copy rounded-md ring-1 ring-inset ring-white/15"
          style={{ background: gradientCss({ type: 'linear', angle: 90, stops }) }}
          onPointerDown={onBarDown}
          title="Click to add a color stop"
        >
          {stops.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Color stop ${Math.round(s.offset * 100)}%`}
              aria-pressed={i === index}
              className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full ring-2 transition-shadow active:cursor-grabbing ${i === index ? 'ring-white shadow-[0_0_0_4px_rgba(124,92,255,0.6)]' : 'ring-white/80 shadow-soft'}`}
              style={{ left: `${s.offset * 100}%`, background: s.color }}
              onPointerDown={(e) => onStopDown(e, i)}
              onPointerMove={onStopMove}
              onPointerUp={onStopUp}
              onPointerCancel={onStopUp}
            />
          ))}
        </div>
      </div>
      {stop && (
        <div className="flex items-center gap-1.5">
          <ColorField value={stop.color} onChange={(color) => setStops(stops.map((s, i) => (i === index ? { ...s, color } : s)))} label="Stop color" />
          <div className="w-[72px] shrink-0">
            <NumberField ariaLabel="Stop position" suffix="%" value={Math.round(stop.offset * 100)} min={0} max={100} onChange={(v) => setStops(stops.map((s, i) => (i === index ? { ...s, offset: Math.max(0, Math.min(100, v)) / 100 } : s)))} gesture={gesture} />
          </div>
          <button type="button" className="icon-btn danger-hover" title="Remove color stop" aria-label="Remove color stop" disabled={stops.length <= 2} onClick={() => { setStops(stops.filter((_, i) => i !== index)); setSelected(Math.max(0, index - 1)); }}>
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="w-[120px] shrink-0">
          <Segmented label="Gradient type" value={value.type} onChange={(type) => onChange({ ...value, type })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
        </div>
        {value.type === 'linear' && (
          <>
            <div className="min-w-0 flex-1">
              <NumberField prefix="∠" ariaLabel="Gradient angle" suffix="°" value={Math.round(value.angle)} onChange={(angle) => onChange({ ...value, angle: ((angle % 360) + 360) % 360 })} gesture={gesture} />
            </div>
            <RotationDial compact size={28} value={value.angle} onChange={(angle) => onChange({ ...value, angle: Math.round(((angle % 360) + 360) % 360) })} onInteractionStart={gesture?.begin} onInteractionEnd={(cancelled) => (cancelled ? gesture?.cancel() : gesture?.end())} />
          </>
        )}
      </div>
    </div>
  );
}

function MaskGlyph({ mask, active }: { mask: ImageMask; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = 22 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 2 * dpr, 2 * dpr);
    ctx.fillStyle = active ? '#7c5cff' : '#a0a0ab';
    ctx.fill(maskPath(mask, 18, 18, mask === 'rect' ? 4 : 1));
  }, [active, mask]);
  return <canvas ref={ref} style={{ width: 22, height: 22 }} aria-hidden />;
}

export function MaskPicker({ value, onChange }: { value: ImageMask; onChange: (mask: ImageMask) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Photo shape">
      {IMAGE_MASKS.map(({ id, label }) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} title={label} aria-label={label} onClick={() => onChange(id)}
          className={`flex aspect-square items-center justify-center rounded-md transition-colors ${value === id ? 'bg-accent-soft ring-1 ring-inset ring-accent' : 'bg-bg-inset hover:bg-bg-hover'}`}>
          <MaskGlyph mask={id} active={value === id} />
        </button>
      ))}
    </div>
  );
}

