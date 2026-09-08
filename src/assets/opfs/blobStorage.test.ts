import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeOpfsBlob } from './blobStorage';

afterEach(() => vi.unstubAllGlobals());

describe('OPFS write fallback', () => {
  it.each(['getFileHandle', 'createWritable', 'write', 'close'])('allows fallback after %s fails', async (stage) => {
    const failure = () => Promise.reject(new Error('Storage unavailable'));
    const writer = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
    const handle = { createWritable: vi.fn().mockResolvedValue(writer) };
    const directory = { getFileHandle: vi.fn().mockResolvedValue(handle) };
    if (stage === 'getFileHandle') directory.getFileHandle.mockImplementation(failure);
    if (stage === 'createWritable') handle.createWritable.mockImplementation(failure);
    if (stage === 'write') writer.write.mockImplementation(failure);
    if (stage === 'close') writer.close.mockImplementation(failure);
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } });
    expect(await writeOpfsBlob('asset', new Blob(['photo']))).toBe(false);
    expect(writer.abort).toHaveBeenCalledTimes(stage === 'write' || stage === 'close' ? 1 : 0);
  });
});
