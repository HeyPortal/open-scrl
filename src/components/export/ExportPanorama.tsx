import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ProjectDocumentV2 } from '@/types';
import { slideScene } from '@/render/preview';
import { SlidePreviewCanvas } from '@/components/SlidePreviewCanvas';

/**
 * The whole carousel as one continuous strip, drawn with the export painter so panoramas read
 * across the seams. Slides left out of the export are dimmed; while choosing, each slide is a
 * checkbox. Browsing it never touches the editor selection or the document.
 */
export function ExportPanorama({ doc, included, choosing, checkerboard, onToggle }: {
  doc: ProjectDocumentV2;
  included: ReadonlySet<number>;
  choosing: boolean;
  checkerboard: boolean;
  onToggle: (slideId: string, on: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setAvailable(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scenes = useMemo(() => doc.slideOrder.map((slideId) => slideScene(doc, slideId)), [doc]);
  const count = doc.slideOrder.length;
  const ratio = doc.format.width / doc.format.height;
  const tallest = available && available < 420 ? 132 : 176;
  // Fill the stage when the carousel fits; long carousels keep a readable size and scroll.
  const width = Math.floor(Math.max(40, Math.min(tallest * ratio, available > 0 ? available / Math.max(1, count) : tallest * ratio)));
  const height = Math.round(width / ratio);
  const first = doc.slideOrder.findIndex((_, index) => included.has(index));

  useEffect(() => {
    const el = ref.current;
    if (!el || first < 0 || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: Math.max(0, first * width - el.clientWidth / 2 + width / 2) });
  }, [first, width]);

  return <div ref={ref} className="export-pano scrollbar-thin" {...(choosing ? { role: 'group', 'aria-label': 'Choose slides to export' } : { role: 'img', 'aria-label': `Carousel preview, ${included.size} of ${count} ${count === 1 ? 'slide' : 'slides'} included` })}>
    <div className="export-pano-strip" style={{ height }}>
      {doc.slideOrder.map((slideId, index) => {
        const on = included.has(index);
        const art = <>
          <SlidePreviewCanvas scene={scenes[index]} format={doc.format} width={width} height={height} checkerboard={checkerboard} />
          <span className="export-pano-number" aria-hidden>{index + 1}</span>
          {choosing && <span className="export-pano-check" aria-hidden>{on && <Check size={12} strokeWidth={3} />}</span>}
        </>;
        return choosing
          ? <label key={slideId} className="export-pano-slide" data-included={on} style={{ width }}>
            <input type="checkbox" className="export-pano-input" checked={on} onChange={(event) => onToggle(slideId, event.target.checked)} />
            <span className="sr-only">Slide {index + 1}</span>
            {art}
          </label>
          : <span key={slideId} className="export-pano-slide" data-included={on} style={{ width }}>{art}</span>;
      })}
    </div>
  </div>;
}
