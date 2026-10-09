import { useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

export type SheetDetent = 'half' | 'full';

/** Drag distance (px) past which releasing the handle changes detent or closes. */
const SNAP_DISTANCE = 56;

interface BottomSheetProps {
  title: string;
  detent: SheetDetent;
  onDetentChange: (detent: SheetDetent) => void;
  onClose: () => void;
  /** Extra controls shown before the close button. */
  headerAction?: ReactNode;
  children: ReactNode;
}

/**
 * An in-flow bottom panel for the mobile editor. It sits between the canvas
 * and the dock, so the canvas shrinks to stay visible above it. Drag the
 * handle up to expand, down to collapse, or further down to close.
 */
export function BottomSheet({ title, detent, onDetentChange, onClose, headerAction, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
    drag.current = { id: event.pointerId, y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    setDragHeight(Math.max(96, start.height - (event.clientY - start.y)));
  };
  const onPointerEnd = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    setDragHeight(null);
    const delta = event.clientY - start.y;
    if (event.type === 'pointercancel') return;
    if (Math.abs(delta) < 6) {
      onDetentChange(detent === 'half' ? 'full' : 'half');
    } else if (delta < -SNAP_DISTANCE) {
      onDetentChange('full');
    } else if (delta > SNAP_DISTANCE) {
      if (detent === 'full' && delta < SNAP_DISTANCE * 3) onDetentChange('half');
      else onClose();
    }
  };

  return (
    <section
      ref={sheetRef}
      aria-label={title}
      data-detent={detent}
      className={`mobile-sheet relative flex shrink-0 flex-col overflow-hidden rounded-t-[22px] border-t border-line-strong bg-bg-panel shadow-[0_-12px_32px_-12px_rgba(0,0,0,0.7)] ${
        dragHeight === null ? 'transition-[height] duration-200 ease-out' : ''
      }`}
      style={{ height: dragHeight ?? (detent === 'full' ? 'var(--sheet-full)' : 'var(--sheet-half)') }}
    >
      <div
        className="flex shrink-0 touch-none cursor-grab flex-col items-center pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <button
          type="button"
          className="h-1.5 w-10 rounded-full bg-line-strong"
          aria-label={detent === 'half' ? `Expand ${title}` : `Collapse ${title}`}
          onClick={(event) => {
            // Pointer handlers already toggle on tap; keep keyboard activation working.
            if (event.detail === 0) onDetentChange(detent === 'half' ? 'full' : 'half');
          }}
        />
        <div className="flex h-11 w-full items-center gap-2 px-4">
          <h2 className="heading-md min-w-0 flex-1 truncate text-ink">{title}</h2>
          {headerAction && <div className="flex items-center gap-2" onPointerDown={(event) => event.stopPropagation()}>{headerAction}</div>}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-inset text-ink-dim active:bg-bg-hover"
            aria-label={`Close ${title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>
      <div className="mobile-sheet-body min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">{children}</div>
    </section>
  );
}
