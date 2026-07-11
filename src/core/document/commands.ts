import type { Draft } from 'immer';
import type { ProjectDocumentV2 } from '@/types';

export interface EditorCommand {
  label: string;
  mergeKey?: string;
  apply(draft: Draft<ProjectDocumentV2>): void;
}

export function command(
  label: string,
  apply: EditorCommand['apply'],
  mergeKey?: string,
): EditorCommand {
  return { label, apply, mergeKey };
}
