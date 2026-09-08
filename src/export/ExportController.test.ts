import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNamedBlobZip, renderProjectSlides } from './ExportController';
import { newDocument } from '@/editor/documentStore';

describe('incremental ZIP export', () => {
  it('adds ordered entries without retaining a caller-owned entry array', async () => {
    const archive = await createNamedBlobZip(false);
    await archive.add('01.png', new Blob(['first'], { type: 'image/png' }));
    await archive.add('02.mp4', new Blob(['second'], { type: 'video/mp4' }));
    const result = await archive.close();

    const reader = new ZipReader(new BlobReader(result.blob));
    const entries = await reader.getEntries();
    await reader.close();
    await result.release();

    expect(entries.map((entry) => entry.filename)).toEqual(['01.png', '02.mp4']);
  });
});

class TestWorker {
  static latest: TestWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.latest = this; }
  respond(type: string, extra = {}) {
    this.onmessage?.({ data: { id: this.postMessage.mock.calls[0][0].id, type, ...extra } });
  }
}

describe('export worker lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());
  const start = (signal?: AbortSignal) => {
    vi.stubGlobal('Worker', TestWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    return renderProjectSlides(newDocument(), [0], { signal });
  };

  it('rejects an already cancelled request without starting a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    await expect(renderProjectSlides(newDocument(), [0], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker).not.toHaveBeenCalled();
  });

  it('terminates immediately on cancellation without needing a worker reply', async () => {
    const controller = new AbortController();
    const pending = start(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(TestWorker.latest.terminate).toHaveBeenCalledOnce();
  });

  it.each(['error', 'messageerror', 'response'])('settles a failed export on %s', async (kind) => {
    const pending = start();
    const worker = TestWorker.latest;
    if (kind === 'error') worker.onerror?.({ message: 'Worker crashed', preventDefault: vi.fn() });
    if (kind === 'messageerror') worker.onmessageerror?.();
    if (kind === 'response') worker.respond('error', { error: 'Encoding failed' });
    await expect(pending).rejects.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });

  it('removes cancellation listeners after successful completion', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = start(controller.signal);
    const worker = TestWorker.latest;
    const blobs = [new Blob(['slide'])];
    worker.respond('complete', { blobs });
    await expect(pending).resolves.toEqual(blobs);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('exports through HTML canvas when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('OffscreenCanvas', undefined);
    const blob = new Blob(['png'], { type: 'image/png' });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(blob));
    try {
      await expect(renderProjectSlides(newDocument(), [0])).resolves.toEqual([blob]);
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });
});
