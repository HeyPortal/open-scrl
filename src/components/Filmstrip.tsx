import { memo } from 'react';
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { useAssets } from '@/store/assets';
import type { Slide } from '@/types';

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
  const scaleY = 56 / format.height;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        width: thumbW,
        height: 56,
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
  slideCount: number;
  thumbW: number;
  thumbs: Record<string, string>;
  format: { width: number; height: number };
  onSelect: (slideId: string) => void;
  onDuplicate: (slideId: string) => void;
  onDelete: (slideId: string) => void;
  onMove: (from: number, to: number) => void;
}

const SlideThumb = memo(function SlideThumb({
  slide,
  index,
  active,
  slideCount,
  thumbW,
  thumbs,
  format,
  onSelect,
  onDuplicate,
  onDelete,
  onMove,
}: SlideThumbProps) {
  return (
    <div className="relative group flex flex-col items-center">
      <button
        type="button"
        onClick={() => onSelect(slide.id)}
        className={`relative rounded border-2 transition-colors ${
          active ? 'border-accent' : 'border-line hover:border-ink-faint'
        }`}
        style={{
          width: thumbW,
          height: 56,
        }}
        title={`Slide ${index + 1}`}
      >
        <SlidePreview slide={slide} thumbs={thumbs} thumbW={thumbW} format={format} />
        <span className="absolute -top-2 -left-2 z-10 rounded bg-bg-inset px-1.5 text-[10px] font-medium tabular-nums text-ink-dim ring-1 ring-line">
          {index + 1}
        </span>
      </button>
      <div className="mt-1 flex h-5 items-center justify-center">
        <div
          className={`flex items-center gap-0.5 transition-opacity ${
            active
              ? 'opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
          }`}
        >
          <button
            className="icon-btn !h-5 !w-5"
            type="button"
            title="Move left"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ChevronLeft size={12} aria-hidden />
          </button>
          <button
            className="icon-btn !h-5 !w-5"
            type="button"
            title="Duplicate"
            onClick={() => onDuplicate(slide.id)}
          >
            <Copy size={12} aria-hidden />
          </button>
          <button
            className="icon-btn !h-5 !w-5 disabled:opacity-30"
            type="button"
            title="Delete"
            disabled={slideCount <= 1}
            onClick={() => onDelete(slide.id)}
          >
            <Trash2 size={12} aria-hidden />
          </button>
          <button
            className="icon-btn !h-5 !w-5"
            type="button"
            title="Move right"
            disabled={index === slideCount - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ChevronRight size={12} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
});

export function Filmstrip() {
  const doc = useEditor((s) => s.doc);
  const slides = doc.slides;
  const format = doc.format;
  const thumbs = useAssets((s) => s.thumbs);
  const selected = useEditor((s) => s.selectedSlideId);
  const select = useEditor((s) => s.selectSlide);
  const addSlide = useEditor((s) => s.addSlide);
  const dup = useEditor((s) => s.duplicateSlide);
  const del = useEditor((s) => s.deleteSlide);
  const moveSlide = useEditor((s) => s.moveSlide);

  const ratio = format.width / format.height;
  const thumbW = 56 * ratio;

  return (
    <div className="h-24 bg-bg-rail border-t border-line flex items-center px-3 gap-2 overflow-x-auto scrollbar-thin">
      {slides.map((s, i) => (
        <SlideThumb
          key={s.id}
          slide={s}
          index={i}
          active={s.id === selected}
          slideCount={slides.length}
          thumbW={thumbW}
          thumbs={thumbs}
          format={format}
          onSelect={select}
          onDuplicate={dup}
          onDelete={del}
          onMove={moveSlide}
        />
      ))}
      <div className="ml-2 flex flex-col items-center">
        <button
          type="button"
          className="flex items-center justify-center rounded border border-dashed border-line text-ink-faint transition-colors hover:border-accent hover:text-accent"
          style={{ width: thumbW, height: 56 }}
          onClick={() => addSlide()}
          title="Add slide"
        >
          <Plus size={18} aria-hidden />
        </button>
        <div className="mt-1 h-5 shrink-0" aria-hidden />
      </div>
    </div>
  );
}
