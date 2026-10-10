import { useCallback, useState } from 'react';
import type { Format } from '@/types';
import type { GridTemplate } from '@/lib/grids';
import { useEditor } from '@/store/editor';
import type { ProjectSummary } from '@/store/editor';

/** Spacing (in canvas px) applied to the first slide when a project starts from a grid. */
export const STARTER_GAP = 16;
export const STARTER_MARGIN = 16;

export const BLANK = 'blank';

/**
 * Create and open flows shared by the desktop and phone home screens. `creating` is 'blank' or a
 * grid template id while a project is being created; only one create/open runs at a time.
 */
export function useHomeActions() {
  const openProject = useEditor((s) => s.openProject);
  const newProject = useEditor((s) => s.newProject);
  const [creating, setCreating] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const busy = creating !== null || openingId !== null;

  const create = useCallback(async (format: Format, name: string, template?: GridTemplate) => {
    if (busy) return;
    setOpenError(null);
    setCreating(template?.id ?? BLANK);
    try {
      await newProject(format, name);
      // The new project is active and its first slide is selected, as on the editor's Grids panel.
      if (template && useEditor.getState().activeProjectId) {
        useEditor.getState().applyGrid(template, STARTER_GAP, STARTER_MARGIN);
      }
    } catch {
      // saveToDisk reports failures through the store's saveError banner.
    } finally {
      setCreating(null);
    }
  }, [busy, newProject]);

  const open = useCallback(async (project: Pick<ProjectSummary, 'id'>) => {
    if (busy) return;
    setOpenError(null);
    setOpeningId(project.id);
    try {
      await openProject(project.id);
      const { activeProjectId, readOnlyError } = useEditor.getState();
      if (!activeProjectId && readOnlyError) setOpenError(readOnlyError);
    } catch {
      setOpenError('This project could not be opened. Your saved data has not been changed.');
    } finally {
      setOpeningId(null);
    }
  }, [busy, openProject]);

  return { creating, openingId, openError, busy, create, open };
}
