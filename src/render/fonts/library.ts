import { openDB, type DBSchema } from 'idb';
import { completeTransaction } from '@/storage/transaction';

export interface FontVariant { weight: string; style: 'normal' | 'italic' }
export interface FontFamily {
  family: string;
  name: string;
  source: 'file' | 'google';
  variants: FontVariant[];
}
export interface FontFile extends FontVariant { bytes: ArrayBuffer }
interface FontDatabase extends DBSchema {
  families: { key: string; value: FontFamily };
  files: { key: string; value: FontFile[] };
  settings: { key: string; value: unknown };
}
let pending: ReturnType<typeof openDB<FontDatabase>> | undefined;
function database() {
  pending ??= openDB<FontDatabase>('open-scrl-fonts', 1, {
    upgrade(db) {
      db.createObjectStore('families');
      db.createObjectStore('files');
      db.createObjectStore('settings');
    },
  }).catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}
export async function listFonts() {
  return (await (await database()).getAll('families')).sort((a, b) => a.name.localeCompare(b.name));
}
export async function readFont(family: string) {
  const db = await database();
  const tx = db.transaction(['families', 'files']);
  const [meta, files] = await Promise.all([tx.objectStore('families').get(family), tx.objectStore('files').get(family)]);
  await tx.done;
  return meta && files ? { meta, files } : undefined;
}
/** Immutable, content-addressed families: an import cannot change an existing project's type. */
export async function saveFont(name: string, source: FontFamily['source'], files: FontFile[]) {
  const hashes = await Promise.all(files.map(async ({ bytes, weight, style }) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `${weight}/${style}/${[...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.sort().join('|')));
  const family = `OpenSCRL_Font_${[...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const db = await database();
  const tx = db.transaction(['families', 'files'], 'readwrite');
  return completeTransaction(tx, async () => {
    const existing = await tx.objectStore('families').get(family);
    const meta: FontFamily = existing ?? { family, name, source, variants: files.map(({ weight, style }) => ({ weight, style })) };
    if (!existing) {
      await tx.objectStore('families').put(meta, family);
      await tx.objectStore('files').put(files, family);
    }
    return meta;
  });
}
export async function readFontSetting<T>(key: string): Promise<T | undefined> {
  return (await (await database()).get('settings', key)) as T | undefined;
}
export async function writeFontSetting(key: string, value: unknown) {
  const db = await database();
  if (value === undefined) await db.delete('settings', key);
  else await db.put('settings', value, key);
}
