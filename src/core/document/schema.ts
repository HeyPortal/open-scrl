import type { Document, PersistedDocument, ProjectDocumentV2 } from '@/types';

export const CURRENT_SCHEMA_VERSION = 2 as const;

export function isDocumentV2(value: unknown): value is ProjectDocumentV2 {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ProjectDocumentV2>;
  return (
    doc.schemaVersion === CURRENT_SCHEMA_VERSION &&
    typeof doc.id === 'string' &&
    Array.isArray(doc.slideOrder) &&
    !!doc.slides &&
    !!doc.layers
  );
}

export function isLegacyDocument(value: unknown): value is Document {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<Document>;
  return typeof doc.id === 'string' && Array.isArray(doc.slides) && !('schemaVersion' in doc);
}

export function getSchemaVersion(value: PersistedDocument | unknown): number {
  if (isDocumentV2(value)) return value.schemaVersion;
  if (isLegacyDocument(value)) return 1;
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  return typeof version === 'number' ? version : 0;
}
