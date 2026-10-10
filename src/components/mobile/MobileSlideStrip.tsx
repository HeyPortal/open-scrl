import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useEditorSession } from '@/editor/sessionStore';
import { materializeSlides } from '@/core/document/selectors';
import { slideScene, type SlideScene } from '@/render/preview';
import type { Slide } from '@/types';
import { SlidePreviewImage } from '../SlidePreviewCanvas';

const MIN_TILE_W = 44;

interface SlideTileProps {
  slide: Slide;
  scene: SlideScene;
  index: number;
  active: boolean;
  thumbW: number;
  thumbH: number;
  format: { width: number; height: number };
  onSelect: (slideId: string) => void;
}

const SlideTile = memo(function SlideTile({ slide, scene, index, active, thumbW, thumbH, format, onSelect }: SlideTileProps) {
  return (
    <button
      type="button"
      data-slide-id={slide.id}
      onClick={() => onSelect(slide.id)}
      aria-label={`Slide ${index + 1}${active ? ', selected. Tap for slide actions' : ''}`}
      aria-current={active ? 'true' : undefined}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg transition-shadow duration-150 ${
        active ? 'shadow-[0_0_0_2px_#7c5cff]' : 'shadow-[0_0_0_1px_#34343c]'
      }`}
      style={{ width: Math.max(thumbW, MIN_TILE_W), height: thumbH }}
    >
      <SlidePreviewImage scene={scene} format={format} width={thumbW} height={thumbH} delay={150} />
      {active && (
        <span className="absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold tabular-nums leading-none text-white shadow">
          {index + 1}
        </span>
      )}
    </button>
  );
});

function ActionButton({ label, Icon, onClick, disabled, danger }: { label: string; Icon: LucideIcon; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-14 w-[68px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors active:bg-bg-hover disabled:pointer-events-none disabled:opacity-35 ${
        danger ? 'text-red-300' : 'text-ink'
      }`}
    >
      <Icon size={19} aria-hidden />
      {label}
    </button>
  );
}

/** Horizontal slide thumbnails. Tapping the selected one opens duplicate / move / delete. */
export function MobileSlideStrip({ visible = true }: { visible?: boolean }) {
  const liveDoc = useEditor((s) => s.doc);
  // While a sheet hides the strip, keep the last document so thumbnails aren't repainted for nothing.
  const [shown, setShown] = useState(liveDoc);
  if (visible && shown !== liveDoc) setShown(liveDoc);
  const doc = shown;

  const selected = useEditorSession((s) => s.selectedSlideId);
  const focusSlide = useEditorSession((s) => s.focusSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const duplicateSlide = useEditor((s) => s.duplicateSlide);
  const deleteSlide = useEditor((s) => s.deleteSlide);
  const moveSlide = useEditor((s) => s.moveSlide);

  const slides = materializeSlides(doc);
  const scenes = useMemo(() => new Map(doc.slideOrder.map((id) => [id, slideScene(doc, id)])), [doc]);
  const format = doc.format;
  const count = slides.length;
  const index = Math.max(0, doc.slideOrder.indexOf(selected));
  const selectedId = doc.slideOrder[index];

  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const [caretLeft, setCaretLeft] = useState(0);

  const thumbH = 56;
  const thumbW = Math.round(thumbH * (format.width / format.height));

  const activeTile = () => scrollerRef.current?.querySelector<HTMLElement>(`[data-slide-id="${selectedId}"]`) ?? null;

  // Keep the selected thumbnail centred.
  useEffect(() => {
    if (!visible) return;
    const scroller = scrollerRef.current;
    const tile = activeTile();
    if (!scroller || !tile) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ left: tile.offsetLeft - (scroller.clientWidth - tile.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, index, visible, thumbW]);

  // Anchor the action bar over the selected thumbnail, kept inside the screen.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const wrap = wrapRef.current;
    const tile = activeTile();
    const menu = popoverRef.current;
    if (!wrap || !tile || !menu) return;
    const place = () => {
      const wrapBox = wrap.getBoundingClientRect();
      const tileBox = tile.getBoundingClientRect();
      const width = menu.offsetWidth;
      const centre = tileBox.left - wrapBox.left + tileBox.width / 2;
      const left = Math.max(8, Math.min(centre - width / 2, wrapBox.width - width - 8));
      setMenuLeft(left);
      setCaretLeft(Math.max(18, Math.min(centre - left, width - 18)));
    };
    place();
    const scroller = scrollerRef.current;
    scroller?.addEventListener('scroll', place, { passive: true });
    return () => scroller?.removeEventListener('scroll', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, selectedId, index, count, thumbW]);

  useEffect(() => { setMenuOpen(false); }, [selectedId, visible]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || activeTile()?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, selectedId]);

  const onSelect = (slideId: string) => {
    if (slideId === selectedId) setMenuOpen((open) => !open);
    else focusSlide(slideId);
  };

  const onAdd = () => {
    addSlide(selectedId);
    focusSlide(useEditorSession.getState().selectedSlideId);
  };

  return (
    <div ref={wrapRef} className="mobile-strip relative shrink-0 border-t border-line bg-bg-rail/90 backdrop-blur" hidden={!visible}>
      {menuOpen && (
        <div
          ref={popoverRef}
          role="menu"
          aria-label="Slide actions"
          className="absolute bottom-[calc(100%+10px)] z-30 flex rounded-2xl border border-line-strong bg-bg-overlay p-1 shadow-[0_-6px_24px_-8px_rgba(0,0,0,0.7)]"
          style={{ left: menuLeft }}
        >
          <ActionButton label="Duplicate" Icon={Copy} onClick={() => { setMenuOpen(false); duplicateSlide(selectedId); }} />
          <ActionButton label="Move left" Icon={ChevronLeft} disabled={index === 0} onClick={() => moveSlide(index, index - 1)} />
          <ActionButton label="Move right" Icon={ChevronRight} disabled={index >= count - 1} onClick={() => moveSlide(index, index + 1)} />
          <ActionButton label="Delete" Icon={Trash2} danger disabled={count <= 1} onClick={() => { setMenuOpen(false); deleteSlide(selectedId); }} />
          <span
            aria-hidden
            className="absolute -bottom-[5px] h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-line-strong bg-bg-overlay"
            style={{ left: caretLeft }}
          />
        </div>
      )}
      <div ref={scrollerRef} className="no-scrollbar relative flex items-center gap-2.5 overflow-x-auto px-4" style={{ height: 'var(--mobile-strip-h)' }}>
        {slides.map((slide, i) => (
          <SlideTile
            key={slide.id}
            slide={slide}
            scene={scenes.get(slide.id)!}
            index={i}
            active={slide.id === selectedId}
            thumbW={thumbW}
            thumbH={thumbH}
            format={format}
            onSelect={onSelect}
          />
        ))}
        <button
          type="button"
          aria-label="Add slide"
          onClick={onAdd}
          className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-ink-dim transition-colors active:border-accent active:bg-accent-soft active:text-accent"
          style={{ width: Math.max(thumbW, MIN_TILE_W), height: thumbH }}
        >
          <Plus size={22} aria-hidden />
        </button>
      </div>
    </div>
  );
}
