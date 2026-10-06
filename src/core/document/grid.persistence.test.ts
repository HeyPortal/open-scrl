import { describe, expect, it } from 'vitest';
import { newDocument } from '@/editor/documentStore';
import { readProject, writeProject } from '@/storage/database';
import { migrateDocument } from './migrations';

const roundTrip = async (doc: ReturnType<typeof newDocument>) => {
  await writeProject(doc, { id: doc.id, name: doc.name, format: doc.format, slideCount: doc.slideOrder.length, createdAt: 0, updatedAt: 0 });
  return migrateDocument(await readProject(doc.id));
};

describe('slide grid persistence', () => {
  it('round-trips a slide grid through storage and migration', async () => {
    const doc = newDocument();
    const grid = { templateId: 'two-h', gap: 24, margin: 40, slotIds: ['a', 'b'] };
    const sid = doc.slideOrder[0];
    doc.slides[sid] = { ...doc.slides[sid], grid };
    expect((await roundTrip(doc)).slides[sid].grid).toEqual(grid);
  });

  it('loads a document without a grid with no grid key on its slides', async () => {
    const back = await roundTrip(newDocument());
    for (const slide of Object.values(back.slides)) expect('grid' in slide).toBe(false);
  });
});
