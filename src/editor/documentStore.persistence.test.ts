import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/deferred';
import { newDocument, useDocumentStore } from './documentStore';
import { writeProject } from '@/storage/database';

vi.mock('@/storage/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/storage/database')>(),
  writeProject: vi.fn(),
}));
const write = vi.mocked(writeProject);
beforeEach(() => {
  const doc = newDocument();
  useDocumentStore.setState({ doc, activeProjectId: doc.id, projects: [], saveError: null });
  write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('document persistence', () => {
  it('serializes overlapping snapshots and preserves newly added project summaries', async () => {
    const blocked = deferred();
    write.mockReturnValueOnce(blocked.promise);
    const first = useDocumentStore.getState().saveToDisk();
    await Promise.resolve();
    useDocumentStore.getState().setDocName('Newest revision');
    const doc = useDocumentStore.getState().doc;
    const other = { id: 'other', name: 'Other', format: doc.format, slideCount: 1, createdAt: 0, updatedAt: 0 };
    useDocumentStore.setState({ projects: [other] });
    const second = useDocumentStore.getState().saveToDisk();
    expect(write).toHaveBeenCalledOnce();
    blocked.resolve();
    await Promise.all([first, second]);
    expect(write.mock.calls.map(([snapshot]) => snapshot.name)).toEqual(['Untitled', 'Newest revision']);
    expect(useDocumentStore.getState().projects).toEqual(expect.arrayContaining([other, expect.objectContaining({ id: doc.id, name: 'Newest revision' })]));
  });

  it('retains the active project on save failure and clears the error after retry', async () => {
    write.mockRejectedValueOnce(new Error('Quota exceeded'));
    const id = useDocumentStore.getState().activeProjectId;
    await expect(useDocumentStore.getState().closeProject()).rejects.toThrow('Quota exceeded');
    expect(useDocumentStore.getState().activeProjectId).toBe(id);
    expect(useDocumentStore.getState().saveError).toContain('could not be saved');
    await useDocumentStore.getState().saveToDisk();
    expect(useDocumentStore.getState().saveError).toBeNull();
    await useDocumentStore.getState().closeProject();
    expect(useDocumentStore.getState().activeProjectId).toBeNull();
  });
});
