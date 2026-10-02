import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editor';

const HEADER_HEIGHT = 22;
const HEADER_GAP = 4;
/** Slides narrower than this on screen show only their number. */
const MIN_ACTIONS_WIDTH = 96;

function HeaderButton({ title, label, danger, disabled, onClick, children }: {
  title: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pointer-events-auto inline-flex h-[22px] w-[22px] items-center justify-center rounded-md text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30 ${danger ? 'danger-hover' : ''}`}
      title={title}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Slide numbers above the canvas, with add, duplicate and delete buttons on the selected slide
 * and on the slide under the mouse.
 */
export function SlideHeaders({ containerRef, slides, count, selectedSlideId, offset, slideWidth, slideHeight }: {
  containerRef: RefObject<HTMLDivElement | null>;
  slides: { slideId: string; index: number }[];
  count: number;
  selectedSlideId: string;
  offset: { x: number; y: number };
  slideWidth: number;
  slideHeight: number;
}) {
  const addSlide = useEditor((s) => s.addSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const deleteSlide = useEditor((s) => s.deleteSlide);
  const [hovered, setHovered] = useState<number | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const update = () => {
      const p = pointer.current; if (!p) { setHovered(null); return; }
      const rect = el.getBoundingClientRect();
      const x = p.x - rect.left - offset.x;
      const y = p.y - rect.top - offset.y;
      const index = Math.floor(x / slideWidth);
      // The strip above a slide counts as part of it so the buttons stay reachable.
      const inside = x >= 0 && index < count && y >= -(HEADER_HEIGHT + HEADER_GAP) && y <= slideHeight;
      setHovered(inside ? index : null);
    };
    const onMove = (e: PointerEvent) => {
      // Touch has no hover, and a held button means a layer drag is in progress.
      if (e.pointerType === 'touch' || e.buttons !== 0) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      update();
    };
    const onLeave = () => { pointer.current = null; update(); };
    // Scrolling, zooming and slide changes move the deck under a still pointer.
    update();
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
  }, [containerRef, count, offset.x, offset.y, slideHeight, slideWidth]);

  const showActions = slideWidth >= MIN_ACTIONS_WIDTH;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {slides.map(({ slideId, index }) => {
        const selected = slideId === selectedSlideId;
        const number = index + 1;
        const slideX = offset.x + index * slideWidth;
        // Stay on screen while the slide is partly scrolled out to the left.
        const x = showActions ? Math.min(Math.max(slideX, 0), slideX + slideWidth - MIN_ACTIONS_WIDTH) : slideX;
        return (
          <div
            key={slideId}
            data-testid="slide-header"
            className="absolute left-0 top-0 flex items-center gap-0.5"
            style={{ height: HEADER_HEIGHT, transform: `translate(${x}px, ${offset.y - HEADER_HEIGHT - HEADER_GAP}px)` }}
          >
            <span className={`mr-1 pl-0.5 text-[11px] font-semibold tabular-nums ${selected ? 'text-accent' : 'text-ink-faint'}`}>{number}</span>
            {showActions && (selected || index === hovered) && <>
              <HeaderButton title="New slide after" label={`New slide after slide ${number}`} onClick={() => addSlide(slideId)}>
                <Plus size={14} aria-hidden />
              </HeaderButton>
              <HeaderButton title="Duplicate slide" label={`Duplicate slide ${number}`} onClick={() => duplicateSlide(slideId)}>
                <Copy size={13} aria-hidden />
              </HeaderButton>
              <HeaderButton title="Delete slide" label={`Delete slide ${number}`} danger disabled={count <= 1} onClick={() => deleteSlide(slideId)}>
                <Trash2 size={13} aria-hidden />
              </HeaderButton>
            </>}
          </div>
        );
      })}
    </div>
  );
}
