import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProjectDocumentV2 } from '@/types';
import { slideScene } from '@/render/preview';
import { SlidePreviewCanvas } from '@/components/SlidePreviewCanvas';

/** A single small canvas, even when exporting a long carousel. */
export function ExportSlidePreview({ doc, indexes, current, format }: {
  doc: ProjectDocumentV2;
  indexes: number[];
  current: string;
  format: 'png' | 'jpeg';
}) {
  const [preferred, setPreferred] = useState(current);
  const ids = indexes.map((index) => doc.slideOrder[index]);
  const slideId = ids.includes(preferred) ? preferred : ids.includes(current) ? current : ids[0];
  const position = ids.indexOf(slideId);
  const scene = useMemo(() => slideId ? slideScene(doc, slideId) : null, [doc, slideId]);
  const scale = Math.min(90 / doc.format.width, 90 / doc.format.height);
  const number = doc.slideOrder.indexOf(slideId) + 1;

  return <div className="export-slide-preview">
    <div className="export-slide-artwork" role="img" aria-label={scene ? `Slide ${number} preview` : 'No slides selected'}>
      {scene && <SlidePreviewCanvas key={slideId} scene={scene} format={doc.format} width={doc.format.width * scale} height={doc.format.height * scale} checkerboard={format === 'png'} />}
    </div>
    <div className="export-slide-info">
      <p className="export-project">{doc.name || 'Untitled'}</p>
      <span>{doc.slideOrder.length} {doc.slideOrder.length === 1 ? 'slide' : 'slides'}</span>
      {scene && <div className="export-preview-navigation">
        {indexes.length > 1 && <button type="button" aria-label="Previous slide preview" disabled={position === 0} onClick={() => setPreferred(ids[position - 1])}><ChevronLeft size={16} aria-hidden /></button>}
        <span aria-live="polite">Slide {number}{indexes.length > 1 && <span className="export-preview-count">{position + 1} / {indexes.length}</span>}</span>
        {indexes.length > 1 && <button type="button" aria-label="Next slide preview" disabled={position === indexes.length - 1} onClick={() => setPreferred(ids[position + 1])}><ChevronRight size={16} aria-hidden /></button>}
      </div>}
    </div>
  </div>;
}
