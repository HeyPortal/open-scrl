import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { round } from '@/lib/nano';

/** Title row at the top of a sidebar panel. */
export function PanelHeader({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-3 pb-2.5 pt-3">
      <div className="flex h-7 items-center justify-between gap-2">
        <h2 className="heading-md text-ink">{title}</h2>
        {action}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}

/** A titled group of controls. Sections stack with a divider between them. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3 last:border-b-0">
      <div className="mb-2 flex h-5 items-center justify-between gap-2">
        <h3 className="section-title">{title}</h3>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/**
 * Two stacked sliders joined by a bracket on their right edge, with a link toggle at the bracket's midpoint.
 * The bracket runs from the middle of the top track to the middle of the bottom track and is accent-colored
 * while linked, faded otherwise. The offsets below assume `Slider`'s label row plus its 16px input.
 */
export function LinkedSliders({ linked, onToggle, top, bottom }: { linked: boolean; onToggle: () => void; top: ReactNode; bottom: ReactNode }) {
  const Icon = linked ? Link2 : Link2Off;
  const border = linked ? 'border-accent' : 'border-line-strong';
  const fill = linked ? 'bg-accent' : 'bg-line-strong';
  return (
    <div className="flex items-stretch gap-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">{top}{bottom}</div>
      <div className="mb-3.5 mt-[26px] flex shrink-0 items-stretch">
        <div className={`w-2 rounded-r-[3px] border-y border-r ${border}`} aria-hidden />
        <div className="flex items-center">
          <span className={`h-px w-1.5 ${fill}`} aria-hidden />
          <button
            type="button"
            className={`icon-btn ml-1 ${linked ? 'icon-btn-active' : ''}`}
            title={linked ? 'Unlink gap and outer margin' : 'Link gap and outer margin'}
            aria-label="Link gap and outer margin"
            aria-pressed={linked}
            onClick={onToggle}
          >
            <Icon size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ValueChip({ children }: { children: ReactNode }) {
  return <span className="text-[11px] tabular-nums text-ink-dim">{children}</span>;
}

export function fillPercent(value: number, min: number, max: number) {
  if (max <= min) return '0%';
  return `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%`;
}

export interface Gesture {
  begin: () => void;
  end: () => void;
  cancel: () => void;
}

export function Slider({
  label,
  display,
  value,
  min,
  max,
  step = 1,
  onChange,
  gesture,
  disabled,
  ariaLabel,
  valueText,
}: {
  label?: ReactNode;
  display?: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  gesture?: Gesture;
  disabled?: boolean;
  ariaLabel?: string;
  valueText?: string;
}) {
  return (
    <label className="block min-w-0">
      {(label || display !== undefined) && (
        <span className="mb-0.5 flex items-center justify-between gap-2">
          <span className="field-label">{label}</span>
          {display !== undefined && <ValueChip>{display}</ValueChip>}
        </span>
      )}
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={gesture?.begin}
        onPointerUp={gesture?.end}
        onPointerCancel={gesture?.cancel}
        style={{ '--fill': fillPercent(value, min, max) } as CSSProperties}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
      />
    </label>
  );
}

function clampNum(n: number, min?: number, max?: number) {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/**
 * Compact numeric input with an inline prefix (e.g. "X", "W").
 * Drag the prefix horizontally to scrub the value (Shift = ×10).
 */
export function NumberField({
  prefix,
  value,
  step = 1,
  min,
  max,
  onChange,
  disabled,
  suffix,
  ariaLabel,
  gesture,
}: {
  prefix?: ReactNode;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: ReactNode;
  ariaLabel?: string;
  gesture?: Gesture;
}) {
  const scrub = useRef<{ x: number; value: number } | null>(null);
  // Arrow keys nudge by 1 (Shift = 10) regardless of the browser's spinner behaviour.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const delta = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(clampNum(value + delta, min, max));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(clampNum(value - delta, min, max));
    }
  };
  const onScrubStart = (e: PointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, value };
    gesture?.begin();
  };
  const onScrubMove = (e: PointerEvent<HTMLSpanElement>) => {
    const start = scrub.current;
    if (!start) return;
    const steps = Math.round((e.clientX - start.x) / 2);
    onChange(clampNum(round(start.value + steps * step * (e.shiftKey ? 10 : 1)), min, max));
  };
  const onScrubEnd = (e: PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return;
    scrub.current = null;
    if (e.type === 'pointercancel') gesture?.cancel();
    else gesture?.end();
  };
  return (
    <label
      className={`group flex h-7 min-w-0 items-center gap-1 rounded-md border border-transparent bg-bg-inset pr-1.5 transition-colors focus-within:border-accent hover:border-line-strong ${
        disabled ? 'cursor-not-allowed opacity-45' : ''
      }`}
    >
      {prefix && (
        <span
          className={`flex h-full w-6 shrink-0 items-center justify-center text-[11px] text-ink-faint ${disabled ? '' : 'cursor-ew-resize hover:text-ink'}`}
          onPointerDown={onScrubStart}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
          title={disabled ? undefined : 'Drag to adjust'}
        >
          {prefix}
        </span>
      )}
      <input
        type="number"
        className={`min-w-0 flex-1 bg-transparent text-xs tabular-nums text-ink outline-none [appearance:textfield] focus-visible:ring-0 disabled:cursor-not-allowed [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${prefix ? '' : 'pl-2'}`}
        value={Number.isFinite(value) ? round(value) : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
      />
      {suffix && <span className="shrink-0 text-[11px] text-ink-faint">{suffix}</span>}
    </label>
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <label className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-transparent bg-bg-inset px-1 transition-colors hover:border-line-strong focus-within:border-accent">
      <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded ring-1 ring-inset ring-white/15" style={{ backgroundColor: value }}>
        <input
          type="color"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
      </span>
      <span className="truncate font-mono text-[11px] uppercase text-ink-dim">{value}</span>
    </label>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 py-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-bg-inset text-ink-dim ring-1 ring-line-strong">{icon}</div>
      <p className="heading-sm text-ink">{title}</p>
      {children && <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">{children}</div>}
    </div>
  );
}
