import { memo, useCallback, useMemo } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import type { Slide } from '@/types';
import { materializeSlides } from '@/core/document/selectors';
import { useEditorSession } from '@/editor/sessionStore';
import { useContextMenu } from './Menu';
import { slideMenu } from '@/app/menus';
import { slideScene, type SlideScene } from '@/render/preview';
import { SlidePreviewImage } from './SlidePreviewCanvas';

const THUMB_H = 56;

interface SlideThumbProps {
  slide: Slide;
  scene: SlideScene;
  index: number;
  active: boolean;
  thumbW: number;
  format: { width: number; height: number };
  onSelect: (slideId: string) => void;
  onMenu: (slideId: string, x: number, y: number) => void;
}

const SlideThumb = memo(function SlideThumb({ slide, scene, index, active, thumbW, format, onSelect, onMenu }: SlideThumbProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className="flex shrink-0 flex-col items-center gap-1.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onSelect(slide.id)}
        onContextMenu={(e) => { e.preventDefault(); onMenu(slide.id, e.clientX, e.clientY); }}
        className={`relative overflow-hidden rounded-md border-2 transition-all ${
          active ? 'border-accent' : 'border-transparent ring-1 ring-line-strong hover:ring-ink-faint'
        } ${isDragging ? 'scale-105 cursor-grabbing shadow-lift' : 'cursor-pointer'}`}
        style={{ width: thumbW + 4, height: THUMB_H + 4 }}
        title={`Slide ${index + 1}`}
        aria-current={active ? 'true' : undefined}
      >
        <SlidePreviewImage scene={scene} format={format} width={thumbW} height={THUMB_H} delay={150} className="absolute inset-0" />
      </button>
      <span className={`text-[10px] font-medium tabular-nums ${active ? 'text-ink' : 'text-ink-faint'}`}>{index + 1}</span>
    </div>
  );
});

export function Filmstrip() {
  const doc = useEditor((s) => s.doc);
  const slides = materializeSlides(doc);
  const format = doc.format;
  const scenes = useMemo(() => new Map(doc.slideOrder.map((id) => [id, slideScene(doc, id)])), [doc]);
  const selected = useEditorSession((s) => s.selectedSlideId);
  const focusSlide = useEditorSession((s) => s.focusSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const dup = useEditor((s) => s.duplicateSlide);
  const del = useEditor((s) => s.deleteSlide);
  const moveSlide = useEditor((s) => s.moveSlide);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const openMenu = useContextMenu((s) => s.open);
  const onMenu = useCallback((slideId: string, x: number, y: number) => {
    focusSlide(slideId);
    openMenu(x, y, slideMenu(), 'Slide actions');
  }, [focusSlide, openMenu]);

  const ratio = format.width / format.height;
  const thumbW = THUMB_H * ratio;
  const index = Math.max(0, doc.slideOrder.indexOf(selected));
  const count = slides.length;
  const selectedId = doc.slideOrder[index];

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = doc.slideOrder.indexOf(String(e.active.id));
    const to = doc.slideOrder.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) moveSlide(from, to);
  };

  return (
    <div className="flex h-[100px] shrink-0 items-stretch border-t border-line bg-bg-rail">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto px-4 scrollbar-thin">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={doc.slideOrder} strategy={horizontalListSortingStrategy}>
            {slides.map((s, i) => (
              <SlideThumb
                key={s.id}
                slide={s}
                scene={scenes.get(s.id)!}
                index={i}
                active={s.id === selected}
                thumbW={thumbW}
                format={format}
                onSelect={focusSlide}
                onMenu={onMenu}
              />
            ))}
          </SortableContext>
        </DndContext>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <button
            type="button"
            className="flex items-center justify-center rounded-md border border-dashed border-line-strong text-ink-faint transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
            style={{ width: thumbW + 4, height: THUMB_H + 4 }}
            onClick={() => addSlide()}
            title="Add slide"
          >
            <Plus size={20} aria-hidden />
          </button>
          <span className="text-[10px] text-transparent" aria-hidden>+</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col justify-center gap-1.5 border-l border-line px-3">
        <p className="px-1 text-[11px] text-ink-faint">
          Slide <span className="font-semibold tabular-nums text-ink">{index + 1}</span>
          <span className="tabular-nums text-ink-faint"> / {count}</span>
        </p>
        <div className="flex items-center gap-0.5 rounded-md bg-bg-inset p-0.5">
          <button className="icon-btn" type="button" title="Move slide left" aria-label="Move slide left" disabled={index === 0} onClick={() => moveSlide(index, index - 1)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button className="icon-btn" type="button" title="Move slide right" aria-label="Move slide right" disabled={index >= count - 1} onClick={() => moveSlide(index, index + 1)}>
            <ChevronRight size={16} aria-hidden />
          </button>
          <button className="icon-btn" type="button" title="Duplicate slide" aria-label="Duplicate slide" onClick={() => selectedId && dup(selectedId)}>
            <Copy size={15} aria-hidden />
          </button>
          <button className="icon-btn danger-hover" type="button" title="Delete slide" aria-label="Delete slide" disabled={count <= 1} onClick={() => selectedId && del(selectedId)}>
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
