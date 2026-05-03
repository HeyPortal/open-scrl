import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useEditor, selectActiveLayer } from '@/store/editor';
import { round } from '@/lib/nano';
import type { Layer, ShapeLayer, TextLayer } from '@/types';
import { AlignCenter, AlignLeft, AlignRight, Droplet, Italic, Lock } from 'lucide-react';
import { RotationDial } from './RotationDial';

function clampNum(n: number, min?: number, max?: number) {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function ValueChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-bg px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink ring-1 ring-line">
      {children}
    </span>
  );
}

function ColorSwatch({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (hex: string) => void;
  'aria-label'?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label className="relative h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line ring-1 ring-line/50">
        <span className="absolute inset-0" style={{ backgroundColor: value }} aria-hidden />
        <input
          type="color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel ?? 'Pick color'}
        />
      </label>
      <span className="truncate font-mono text-[11px] text-ink-dim">{value.toUpperCase()}</span>
    </div>
  );
}

function NumberInput({
  value,
  step = 1,
  min,
  max,
  onChange,
  disabled,
  className = '',
  nudgeWithArrows = false,
}: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  /** When focused, ArrowUp/Right and ArrowDown/Left nudge the value (Shift = 10). */
  nudgeWithArrows?: boolean;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!nudgeWithArrows || disabled) return;
    const delta = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(clampNum(value + delta, min, max));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(clampNum(value - delta, min, max));
    }
  };

  return (
    <input
      type="number"
      className={`input h-8 min-w-0 py-0 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${disabled ? 'cursor-not-allowed opacity-45' : ''} ${className}`}
      value={Number.isFinite(value) ? round(value) : 0}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      onKeyDown={onKeyDown}
    />
  );
}

function LayoutSection({
  layer,
  onPatch,
}: {
  layer: Layer;
  onPatch: (patch: Partial<Layer>) => void;
}) {
  const locked = layer.locked;
  const opacityPct = Math.round(layer.opacity * 100);

  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Layout</h2>
        </div>
        {locked ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-bg-inset px-2 py-1 text-[10px] font-medium text-ink-dim"
            title="This layer is locked. Unlock it in the layer list to move or resize."
          >
            <Lock size={11} strokeWidth={2} className="text-ink-faint" aria-hidden />
            Locked
          </span>
        ) : null}
      </div>

      <div className="rounded-lg border border-line bg-bg-inset/60 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Position</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] text-ink-dim">X</span>
            <NumberInput
              value={layer.x}
              onChange={(v) => onPatch({ x: v })}
              disabled={locked}
              nudgeWithArrows
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] text-ink-dim">Y</span>
            <NumberInput
              value={layer.y}
              onChange={(v) => onPatch({ y: v })}
              disabled={locked}
              nudgeWithArrows
            />
          </label>
        </div>

        <p className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Size</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] text-ink-dim">Width</span>
            <NumberInput value={layer.width} min={1} onChange={(v) => onPatch({ width: v })} disabled={locked} />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] text-ink-dim">Height</span>
            <NumberInput value={layer.height} min={1} onChange={(v) => onPatch({ height: v })} disabled={locked} />
          </label>
        </div>

        <p className="mb-2 mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Transform</p>
        <div className="flex flex-col items-stretch gap-1">
          <span className="text-[10px] text-ink-dim">Rotation</span>
          <div className="flex justify-center py-1">
            <RotationDial
              value={layer.rotation}
              onChange={(v) => onPatch({ rotation: v })}
              disabled={locked}
            />
          </div>
        </div>
        <label className="mt-3 flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] text-ink-dim">
              <Droplet size={12} className="shrink-0 text-accent/85" strokeWidth={2} aria-hidden />
              Opacity
            </span>
            <ValueChip>{opacityPct}%</ValueChip>
          </div>
          <div className="rounded-xl border border-line bg-bg/90 px-2.5 py-2 shadow-inner">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.opacity}
              onChange={(e) => onPatch({ opacity: Number(e.target.value) })}
              className="opacity-range"
              style={{ '--opacity-fill': `${opacityPct}%` } as CSSProperties}
              aria-valuetext={`${opacityPct} percent`}
            />
          </div>
        </label>
      </div>
    </div>
  );
}

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 400;
const LINE_HEIGHT_MIN = 0.8;
const LINE_HEIGHT_MAX = 2.5;
const LETTER_SPACING_MIN = -10;
const LETTER_SPACING_MAX = 50;

function fontSizeFillPct(size: number) {
  const span = FONT_SIZE_MAX - FONT_SIZE_MIN;
  return `${Math.min(100, Math.max(0, ((size - FONT_SIZE_MIN) / span) * 100))}%`;
}

function lineHeightFillPct(h: number) {
  const span = LINE_HEIGHT_MAX - LINE_HEIGHT_MIN;
  return `${Math.min(100, Math.max(0, ((h - LINE_HEIGHT_MIN) / span) * 100))}%`;
}

function letterSpacingFillPct(s: number) {
  const span = LETTER_SPACING_MAX - LETTER_SPACING_MIN;
  return `${Math.min(100, Math.max(0, ((s - LETTER_SPACING_MIN) / span) * 100))}%`;
}

function cornerRadiusFillPct(radius: number, max: number) {
  if (max <= 0) return '0%';
  return `${Math.min(100, Math.max(0, (radius / max) * 100))}%`;
}

function TextInspector({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const u = (patch: Partial<TextLayer>) => updateLayer(layer.id, patch);

  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Text</h2>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Content</p>
          <textarea
            className="input min-h-[4.5rem] resize-y"
            rows={3}
            value={layer.text}
            onChange={(e) => u({ text: e.target.value })}
          />
        </div>

        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Typography</p>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] text-ink-dim">Font</span>
            <select
              className="input"
              value={layer.fontFamily}
              onChange={(e) => u({ fontFamily: e.target.value })}
            >
              {[
                'Inter',
                'Helvetica',
                'Arial',
                'Georgia',
                'Times New Roman',
                'Courier New',
                'system-ui',
              ].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] text-ink-dim">Weight</span>
              <select
                className="input"
                value={layer.fontWeight}
                onChange={(e) => u({ fontWeight: Number(e.target.value) })}
              >
                {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-ink-dim">Size</span>
                <ValueChip>{layer.fontSize}</ValueChip>
              </div>
              <div className="rounded-xl border border-line bg-bg/90 px-2 py-1.5 shadow-inner">
                <input
                  type="range"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  value={layer.fontSize}
                  onChange={(e) => u({ fontSize: Number(e.target.value) })}
                  className="inspector-range"
                  style={{ '--range-fill': fontSizeFillPct(layer.fontSize) } as CSSProperties}
                  aria-valuetext={`${layer.fontSize} pixels`}
                />
              </div>
            </div>
          </div>
          <div className="mt-2">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                layer.italic
                  ? 'border-accent bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]'
                  : 'border-transparent bg-bg-inset hover:border-line hover:bg-bg-hover text-ink'
              }`}
              onClick={() => u({ italic: !layer.italic })}
              aria-pressed={layer.italic}
            >
              <Italic size={14} strokeWidth={2} aria-hidden />
              Italic
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Alignment</p>
          <div
            className="grid grid-cols-3 gap-1 rounded-md border border-line/80 bg-bg-rail/40 p-1.5"
            role="group"
            aria-label="Text alignment"
          >
            {(
              [
                { align: 'left' as const, Icon: AlignLeft, label: 'Align left' },
                { align: 'center' as const, Icon: AlignCenter, label: 'Align center' },
                { align: 'right' as const, Icon: AlignRight, label: 'Align right' },
              ] as const
            ).map(({ align, Icon, label }) => {
              const active = layer.align === align;
              return (
                <button
                  key={align}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={active}
                  className={`flex min-h-[30px] items-center justify-center rounded-md border transition-all ${
                    active
                      ? 'border-accent bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]'
                      : 'border-transparent bg-bg/60 text-ink-faint hover:border-line hover:bg-bg-hover hover:text-ink-dim'
                  }`}
                  onClick={() => u({ align })}
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden />
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Color & spacing</p>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[10px] text-ink-dim shrink-0">Fill</span>
            <ColorSwatch value={layer.fill} onChange={(hex) => u({ fill: hex })} aria-label="Text color" />
          </div>
          <label className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-dim">Line height</span>
              <ValueChip>{layer.lineHeight.toFixed(2)}</ValueChip>
            </div>
            <div className="rounded-xl border border-line bg-bg/90 px-2.5 py-2 shadow-inner">
              <input
                type="range"
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={0.05}
                value={layer.lineHeight}
                onChange={(e) => u({ lineHeight: Number(e.target.value) })}
                className="inspector-range"
                style={{ '--range-fill': lineHeightFillPct(layer.lineHeight) } as CSSProperties}
                aria-valuetext={String(layer.lineHeight)}
              />
            </div>
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-dim">Letter spacing</span>
              <ValueChip>{layer.letterSpacing}</ValueChip>
            </div>
            <div className="rounded-xl border border-line bg-bg/90 px-2.5 py-2 shadow-inner">
              <input
                type="range"
                min={LETTER_SPACING_MIN}
                max={LETTER_SPACING_MAX}
                value={layer.letterSpacing}
                onChange={(e) => u({ letterSpacing: Number(e.target.value) })}
                className="inspector-range"
                style={{ '--range-fill': letterSpacingFillPct(layer.letterSpacing) } as CSSProperties}
                aria-valuetext={`${layer.letterSpacing} pixels`}
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

function ShapeInspector({ layer }: { layer: ShapeLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const u = (patch: Partial<ShapeLayer>) => updateLayer(layer.id, patch);
  const strokePickerValue = layer.stroke === 'transparent' ? '#000000' : layer.stroke;
  const cornerMax = Math.min(layer.width, layer.height) / 2;
  const cornerFill = cornerRadiusFillPct(layer.cornerRadius, cornerMax);

  return (
    <div className="border-b border-line px-3 py-3">
      <div className="mb-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Shape</h2>
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Fill</p>
          <div className="flex items-center gap-2">
            <ColorSwatch value={layer.fill} onChange={(hex) => u({ fill: hex })} aria-label="Shape fill" />
          </div>
        </div>

        <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">Stroke</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] text-ink-dim">Color</span>
              <ColorSwatch
                value={strokePickerValue}
                onChange={(hex) => u({ stroke: hex })}
                aria-label="Stroke color"
              />
            </div>
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[10px] text-ink-dim">Width</span>
              <NumberInput value={layer.strokeWidth} min={0} onChange={(v) => u({ strokeWidth: v })} />
            </label>
          </div>
        </div>

        {layer.shape === 'rect' && (
          <div className="rounded-lg border border-line/90 bg-bg-inset/50 px-3 py-2.5 shadow-inner">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Corner radius</span>
              <ValueChip>{Math.round(layer.cornerRadius)} px</ValueChip>
            </div>
            <div className="rounded-xl border border-line bg-bg/90 px-2.5 py-2 shadow-inner">
              <input
                type="range"
                min={0}
                max={cornerMax}
                value={layer.cornerRadius}
                onChange={(e) => u({ cornerRadius: Number(e.target.value) })}
                className="inspector-range"
                style={{ '--range-fill': cornerFill } as CSSProperties}
                aria-valuetext={`${Math.round(layer.cornerRadius)} pixels`}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Inspector() {
  const layer = useEditor(selectActiveLayer);
  const updateLayer = useEditor((s) => s.updateLayer);

  if (!layer) {
    return (
      <div className="p-3 text-xs text-ink-faint">
        Nothing selected. Click a layer to edit its properties.
      </div>
    );
  }

  const u = (patch: Parameters<typeof updateLayer>[1]) => updateLayer(layer.id, patch);

  return (
    <div className="overflow-auto text-ink scrollbar-thin">
      <LayoutSection layer={layer} onPatch={u} />

      {layer.kind === 'text' && <TextInspector layer={layer} />}
      {layer.kind === 'shape' && <ShapeInspector layer={layer} />}
    </div>
  );
}
