const EXPORT_TEMP_DIRECTORY = 'open-scrl-export-temp';

export interface TemporaryExportFile {
  writable: FileSystemWritableFileStream;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
  getFile: () => Promise<File>;
  remove: () => Promise<void>;
}

function temporaryName(extension: string) {
  const token = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${token}.${extension.replace(/^\./, '')}`;
}

export async function createTemporaryExportFile(
  extension: string,
): Promise<TemporaryExportFile | undefined> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return undefined;
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(EXPORT_TEMP_DIRECTORY, { create: true });
    const name = temporaryName(extension);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let open = true;

    return {
      writable,
      close: async () => {
        if (!open) return;
        await writable.close();
        open = false;
      },
      abort: async (reason) => {
        if (!open) return;
        open = false;
        try { await writable.abort(reason); } catch { /* already closed */ }
      },
      getFile: () => handle.getFile(),
      remove: async () => {
        if (open) {
          open = false;
          try { await writable.abort(); } catch { /* already closed */ }
        }
        try { await directory.removeEntry(name); } catch { /* already removed */ }
      },
    };
  } catch {
    return undefined;
  }
}
