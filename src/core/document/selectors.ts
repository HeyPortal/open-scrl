import type { Layer, ProjectDocumentV2, Slide, SlideRecord } from '@/types';

export function getSlideRecord(doc: ProjectDocumentV2, slideId: string): SlideRecord | undefined {
  return doc.slides[slideId];
}

export function getSlideLayers(doc: ProjectDocumentV2, slideId: string): Layer[] {
  const slide = doc.slides[slideId];
  return slide ? slide.layerOrder.map((id) => doc.layers[id]).filter(Boolean) : [];
}

export function materializeSlide(doc: ProjectDocumentV2, slideId: string): Slide | undefined {
  const slide = doc.slides[slideId];
  if (!slide) return undefined;
  return { id: slide.id, background: slide.background, layers: getSlideLayers(doc, slideId) };
}

export function materializeSlides(doc: ProjectDocumentV2): Slide[] {
  return doc.slideOrder.map((id) => materializeSlide(doc, id)).filter((x): x is Slide => !!x);
}

export function findLayerSlideId(doc: ProjectDocumentV2, layerId: string): string | undefined {
  return doc.slideOrder.find((slideId) => doc.slides[slideId]?.layerOrder.includes(layerId));
}
