import { memo, useCallback } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import type { Slide } from '@/types';
import { materializeSlides } from '@/core/document/selectors';
import { useEditorSession } from '@/editor/sessionStore';
import { useContextMenu } from './Menu';
import { slideMenu } from '@/app/menus';

const THUMB_H = 56;

function SlidePreview({
  slide,
  thumbs,
  thumbW,
  format,
}: {
  slide: Slide;
  thumbs: Record<string, string>;
  thumbW: number;
  format: { width: number; height: number };
}) {
  const bg =
    slide.background.kind === 'solid'
      ? slide.background.color
      : `linear-gradient(${slide.background.angle}deg, ${slide.background.from}, ${slide.background.to})`;
  const scaleX = thumbW / format.width;
  const scaleY = THUMB_H / format.height;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        width: thumbW,
        height: THUMB_H,
        background: bg,
      }}
    >
      {slide.layers.map((layer) => {
        if (!layer.visible) return null;
        const style = {
          left: layer.x * scaleX,
          top: layer.y * scaleY,
          width: layer.width * scaleX,
          height: layer.height * scaleY,
          opacity: layer.opacity,
          transform: `rotate(${layer.rotation}deg)`,
          transformOrigin: 'center',
        };

        if (layer.kind === 'image') {
          const src = layer.assetId ? thumbs[layer.assetId] : undefined;
          return (
            <div
              key={layer.id}
              className="absolute overflow-hidden bg-bg-inset"
              style={{ ...style, borderRadius: layer.cornerRadius * Math.min(scaleX, scaleY) }}
            >
              {src && (
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                  style={{
                    objectPosition: `${50 + layer.cropOffsetX * 100}% ${50 + layer.cropOffsetY * 100}%`,
                  }}
                />
              )}
            </div>
          );
        }

        if (layer.kind === 'shape') {
          return (
            <div
              key={layer.id}
              className="absolute"
              style={{
                ...style,
                background: layer.fill,
                border:
                  layer.strokeWidth > 0
                    ? `${Math.max(1, layer.strokeWidth * Math.min(scaleX, scaleY))}px solid ${layer.stroke}`
                    : undefined,
                borderRadius:
                  layer.shape === 'ellipse' ? '999px' : layer.cornerRadius * Math.min(scaleX, scaleY),
              }}
            />
          );
        }

        return (
          <div
            key={layer.id}
            className="absolute overflow-hidden"
            style={{
              ...style,
              color: layer.fill,
              fontFamily: layer.fontFamily,
              fontSize: Math.max(2, layer.fontSize * scaleY),
              fontWeight: layer.fontWeight,
              fontStyle: layer.italic ? 'italic' : undefined,
              lineHeight: layer.lineHeight,
              textAlign: layer.align,
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </div>
  );
}

interface SlideThumbProps {
  slide: Slide;
  index: number;
  active: boolean;
  thumbW: number;
  thumbs: Record<string, string>;
  format: { width: number; height: number };
  onSelect: (slideId: string) => void;
  onMenu: (slideId: string, x: number, y: number) => void;
}

const SlideThumb = memo(function SlideThumb({ slide, index, active, thumbW, thumbs, format, onSelect, onMenu }: SlideThumbProps) {
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
        <SlidePreview slide={slide} thumbs={thumbs} thumbW={thumbW} format={format} />
      </button>
      <span className={`text-[10px] font-medium tabular-nums ${active ? 'text-ink' : 'text-ink-faint'}`}>{index + 1}</span>
    </div>
  );
});

export function Filmstrip() {
  const doc = useEditor((s) => s.doc);
  const slides = materializeSlides(doc);
  const format = doc.format;
  const thumbs = useAssets((s) => s.thumbs);
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
                index={i}
                active={s.id === selected}
                thumbW={thumbW}
                thumbs={thumbs}
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
