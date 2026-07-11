const ROOT = 'open-scrl-assets-v2';

async function directory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ROOT, { create: true });
  } catch {
    return null;
  }
}

export async function writeOpfsBlob(key: string, blob: Blob): Promise<boolean> {
  const dir = await directory();
  if (!dir) return false;
  const handle = await dir.getFileHandle(key, { create: true });
  const writer = await handle.createWritable();
  await writer.write(blob);
  await writer.close();
  return true;
}

export async function readOpfsBlob(key: string): Promise<Blob | undefined> {
  try {
    const dir = await directory();
    if (!dir) return undefined;
    return await (await dir.getFileHandle(key)).getFile();
  } catch {
    return undefined;
  }
}

export async function deleteOpfsBlob(key: string): Promise<void> {
  try { await (await directory())?.removeEntry(key); } catch { /* already absent */ }
}
