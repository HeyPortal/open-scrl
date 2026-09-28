import { useCallback, useRef } from 'react';

const norm360 = (deg: number) => {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
};

/** Angle in degrees: 0° = top, 90° = right, clockwise (matches dial math below). */
const pointerToDegrees = (clientX: number, clientY: number, rect: DOMRect) => {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return norm360(deg);
};

type Props = {
  value: number;
  onChange: (degrees: number) => void;
  disabled?: boolean;
  size?: number;
  onInteractionStart?: () => void;
  onInteractionEnd?: (cancelled: boolean) => void;
  /** Hide the degree readout (the caller shows its own). */
  compact?: boolean;
};

export function RotationDial({ value, onChange, disabled, size = 92, onInteractionStart, onInteractionEnd, compact = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const display = norm360(value);
  const r = compact ? size / 2 - 2 : (size / 2) * 0.72;
  const cx = size / 2;
  const cy = size / 2;
  const handRad = ((display - 90) * Math.PI) / 180;
  const hx = cx + r * Math.cos(handRad);
  const hy = cy + r * Math.sin(handRad);

  const applyFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = rootRef.current;
      if (!el || disabled) return;
      const deg = pointerToDegrees(clientX, clientY, el.getBoundingClientRect());
      onChange(Math.round(deg));
    },
    [disabled, onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    onInteractionStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    applyFromClient(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    applyFromClient(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    onInteractionEnd?.(e.type === 'pointercancel');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 15 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.round(value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.round(value - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    }
  };

  const ticks = [0, 90, 180, 270].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const r1 = r + 4;
    const r2 = r + 10;
    return (
      <line
        key={deg}
        x1={cx + r1 * Math.cos(rad)}
        y1={cy + r1 * Math.sin(rad)}
        x2={cx + r2 * Math.cos(rad)}
        y2={cy + r2 * Math.sin(rad)}
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-line-strong"
      />
    );
  });

  return (
    <div className={`flex flex-col items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}>
      <span className="sr-only">Rotation in degrees. Drag the dial or use arrow keys to adjust.</span>
      <div
        ref={rootRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(display)}
        aria-valuetext={`${Math.round(display)} degrees`}
        aria-disabled={disabled}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-panel ${
          disabled ? '' : 'cursor-pointer'
        }`}
      >
        <svg width={size} height={size} className="text-ink-dim" aria-hidden>
          {!compact && <circle
            cx={cx}
            cy={cy}
            r={r + 6}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeWidth={1}
          />}
          {!compact && ticks}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
          <line
            x1={cx}
            y1={cy}
            x2={hx}
            y2={hy}
            stroke="#7c5cff"
            strokeWidth={compact ? 2 : 2.5}
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={compact ? 3 : 5} fill="#18181c" stroke="#7c5cff" strokeWidth={1.5} />
        </svg>
      </div>
      {!compact && (
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-ink-dim">
          <span className="font-medium text-ink">{Math.round(display)}°</span>
          <span className="text-ink-faint">· drag dial</span>
        </div>
      )}
    </div>
  );
}
