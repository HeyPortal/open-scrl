import type { ProjectDocumentV2 } from '@/types';

// Import validation is stricter than the legacy migration check: no partially
// written projects or nonfinite geometry may enter the editor through an archive.
export function validateProject(value: unknown): asserts value is ProjectDocumentV2 {
  const fail = () => { throw new Error('The project contains invalid or unsupported editing data.'); };
  if (!value || typeof value !== 'object') return fail();
  const doc = value as ProjectDocumentV2;
  if (doc.schemaVersion !== 2 || typeof doc.id !== 'string' || typeof doc.name !== 'string' || !doc.format || !Array.isArray(doc.slideOrder) || !doc.slides || !doc.layers || typeof doc.format.name !== 'string') return fail();
  if (!Number.isInteger(doc.format.width) || !Number.isInteger(doc.format.height) || doc.format.width <= 0 || doc.format.height <= 0 || doc.format.width * doc.format.height > 24_000_000 || !doc.slideOrder.length || doc.slideOrder.length > 100 || new Set(doc.slideOrder).size !== doc.slideOrder.length) return fail();
  if (Object.keys(doc.layers).length > 5000) return fail();
  const seen = new Set<string>();
  for (const sid of doc.slideOrder) {
    const slide = doc.slides[sid];
    if (!slide || slide.id !== sid || !Array.isArray(slide.layerOrder) || !slide.background || !['solid', 'gradient', 'image', 'transparent'].includes(slide.background.kind)) return fail();
    for (const lid of slide.layerOrder) {
      const layer = doc.layers[lid];
      if (!layer || seen.has(lid) || layer.id !== lid || !['image', 'text', 'shape'].includes(layer.kind) || typeof layer.name !== 'string') return fail();
      seen.add(lid);
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) if (!Number.isFinite(layer[key])) return fail();
      if (layer.width <= 0 || layer.height <= 0 || layer.opacity < 0 || layer.opacity > 1) return fail();
      if (layer.kind === 'image' && [layer.cropScale, layer.cropOffsetX, layer.cropOffsetY, layer.cornerRadius].some((n) => !Number.isFinite(n))) return fail();
      if (layer.kind === 'image' && (layer.cropScale < 1 || Math.abs(layer.cropOffsetX) > 0.5 || Math.abs(layer.cropOffsetY) > 0.5)) return fail();
      if (layer.kind === 'text' && (typeof layer.text !== 'string' || typeof layer.fontFamily !== 'string')) return fail();
    }
  }
  // Reject nonfinite values anywhere, including background/effect settings.
  const visit = (item: unknown, depth = 0): void => {
    if (depth > 30 || typeof item === 'number' && !Number.isFinite(item)) return fail();
    if (item && typeof item === 'object') for (const next of Object.values(item)) visit(next, depth + 1);
  };
  visit(doc);
}
