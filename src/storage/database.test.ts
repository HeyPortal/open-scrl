import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, listProjectSummaries, type StoredProjectSummary } from './database';

const project = (id: string, updatedAt: number): StoredProjectSummary => ({
  id, name: id, format: { name: 'Square', width: 100, height: 100 },
  slideCount: 1, createdAt: 0, updatedAt,
});

describe('project index migration', () => {
  beforeEach(async () => {
    const db = await getDatabase();
    await db.clear('documents');
    await db.clear('projectIndex');
  });

  it('keeps unmigrated projects and prefers updated summaries without duplicates', async () => {
    const db = await getDatabase();
    await db.put('documents', [project('old-a', 1), project('old-b', 2)], 'projectIndex');
    await db.put('projectIndex', { ...project('old-a', 4), name: 'Renamed' }, 'old-a');
    await db.put('projectIndex', project('new', 3), 'new');
    expect(await listProjectSummaries()).toEqual([
      { ...project('old-a', 4), name: 'Renamed' }, project('new', 3), project('old-b', 2),
    ]);
  });

  it('handles an empty project library', async () => {
    expect(await listProjectSummaries()).toEqual([]);
  });
});
