import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { completeTransaction } from './transaction';
import type { PersistedDocument, ProjectDocumentV2 } from '@/types';

export interface StoredProjectSummary {
  id: string;
  name: string;
  format: ProjectDocumentV2['format'];
  slideCount: number;
  createdAt: number;
  updatedAt: number;
}

interface OpenScrlDb extends DBSchema {
  documents: { key: string; value: PersistedDocument | StoredProjectSummary[] | string };
  projects: { key: string; value: ProjectDocumentV2 };
  projectIndex: { key: string; value: StoredProjectSummary };
  legacyBackups: { key: string; value: PersistedDocument };
}

let dbPromise: Promise<IDBPDatabase<OpenScrlDb>> | null = null;

export function getDatabase() {
  if (!dbPromise) {
    dbPromise = openDB<OpenScrlDb>('open-scrl', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents');
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
        if (!db.objectStoreNames.contains('projectIndex')) db.createObjectStore('projectIndex');
        if (!db.objectStoreNames.contains('legacyBackups')) db.createObjectStore('legacyBackups');
      },
    }).catch((error) => { dbPromise = null; throw error; });
  }
  return dbPromise;
}

export async function listProjectSummaries(): Promise<StoredProjectSummary[]> {
  const db = await getDatabase();
  const tx = db.transaction(['projectIndex', 'documents']);
  const [current, legacy] = await Promise.all([
    tx.objectStore('projectIndex').getAll(),
    tx.objectStore('documents').get('projectIndex'),
  ]);
  await tx.done;
  // Projects migrate individually as they are opened. Keep the untouched
  // legacy projects visible while preferring current summaries by ID.
  const summaries = new Map<string, StoredProjectSummary>();
  if (Array.isArray(legacy)) for (const project of legacy) summaries.set(project.id, project);
  for (const project of current) summaries.set(project.id, project);
  return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<PersistedDocument | undefined> {
  const db = await getDatabase();
  return (await db.get('projects', id)) ?? (await db.get('documents', `project:${id}`)) as PersistedDocument | undefined;
}

export async function preserveLegacyBackup(id: string, doc: PersistedDocument): Promise<void> {
  const db = await getDatabase();
  if (!(await db.get('legacyBackups', id))) await db.put('legacyBackups', doc, id);
}

export async function writeProject(doc: ProjectDocumentV2, summary: StoredProjectSummary): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(['projects', 'projectIndex'], 'readwrite');
  await completeTransaction(tx, async () => {
    await tx.objectStore('projects').put(doc, doc.id);
    await tx.objectStore('projectIndex').put(summary, doc.id);
  });
}
