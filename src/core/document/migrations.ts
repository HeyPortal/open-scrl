import type { Document, PersistedDocument, ProjectDocumentV2 } from '@/types';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, isDocumentV2, isLegacyDocument } from './schema';

export class UnsupportedDocumentVersionError extends Error {
  readonly version: number;
  constructor(version: number) {
    super(`This project uses unsupported schema version ${version}.`);
    this.version = version;
    this.name = 'UnsupportedDocumentVersionError';
  }
}

export function migrateV1ToV2(legacy: Document): ProjectDocumentV2 {
  const slides: ProjectDocumentV2['slides'] = {};
  const layers: ProjectDocumentV2['layers'] = {};
  const slideOrder: string[] = [];
  for (const slide of legacy.slides) {
    slideOrder.push(slide.id);
    slides[slide.id] = {
      id: slide.id,
      background: slide.background,
      layerOrder: slide.layers.map((layer) => layer.id),
    };
    for (const layer of slide.layers) layers[layer.id] = layer;
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    id: legacy.id,
    name: legacy.name,
    format: legacy.format,
    slideOrder,
    slides,
    layers,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

function migrateFrameStyles(doc: ProjectDocumentV2): ProjectDocumentV2 {
  // Frames are an additive v2 field. Missing styles retain legacy border/crop
  // geometry; unsupported values fall back to that same legacy behavior.
  const supported = new Set(['polaroid', 'paper', 'film', 'postcard']);
  const invalid = Object.values(doc.layers).filter((layer) => layer.kind === 'image' && layer.frameStyle !== undefined && !supported.has(layer.frameStyle));
  if (!invalid.length) return doc;
  const migrated = structuredClone(doc);
  for (const layer of invalid) {
    const photo = migrated.layers[layer.id];
    if (photo.kind === 'image') delete photo.frameStyle;
  }
  return migrated;
}

export function migrateDocument(value: PersistedDocument | unknown): ProjectDocumentV2 {
  if (isDocumentV2(value)) return migrateFrameStyles(value);
  if (isLegacyDocument(value)) return migrateFrameStyles(migrateV1ToV2(value));
  throw new UnsupportedDocumentVersionError(getSchemaVersion(value));
}
