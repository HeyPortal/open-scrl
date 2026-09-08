import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetImportController } from './AssetImportController';
import type { AssetRepository, PreparedAsset } from './AssetRepository';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  respond(index: number, result?: PreparedAsset) {
    this.onmessage?.({ data: { id: this.postMessage.mock.calls[index][0].id, result, error: 'Unsupported file' } });
  }
}
const prepared: PreparedAsset = { file: new Blob(['photo']), thumbnail: new Blob(['thumb']), hash: 'hash', width: 1, height: 1, name: 'photo', mime: 'image/png' };
const repository = () => ({ findByHash: vi.fn().mockResolvedValue(undefined), commit: vi.fn().mockResolvedValue({ id: 'photo' }) }) as unknown as AssetRepository;
const file = () => new File(['photo'], 'photo.png');
beforeEach(() => { TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker); });
afterEach(() => vi.unstubAllGlobals());

describe('import worker recovery', () => {
  it.each(['error', 'messageerror'])('rejects active imports on %s and restarts for queued imports', async (kind) => {
    const repo = repository();
    const importer = new AssetImportController(repo, 2);
    const first = importer.import(file(), 'project');
    const second = importer.import(file(), 'project');
    const queued = importer.import(file(), 'project');
    const failures = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledTimes(2));
    const old = TestWorker.instances[0];
    if (kind === 'error') old.onerror?.({ message: 'Worker crashed', preventDefault: vi.fn() });
    else old.onmessageerror?.();
    expect((await failures).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(old.onmessage).toBeNull();
    await vi.waitFor(() => expect(TestWorker.instances[1]?.postMessage).toHaveBeenCalledOnce());
    TestWorker.instances[1].respond(0, prepared);
    await expect(queued).resolves.toMatchObject({ id: 'photo' });
    expect(repo.commit).toHaveBeenCalledOnce();
  });

  it('recovers after worker construction fails', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Startup failed'); } });
    const importer = new AssetImportController(repository(), 1);
    await expect(importer.import(file(), 'project')).rejects.toThrow('Startup failed');
    vi.stubGlobal('Worker', TestWorker);
    const next = importer.import(file(), 'project');
    await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
    TestWorker.instances[0].respond(0, prepared);
    await expect(next).resolves.toMatchObject({ id: 'photo' });
  });

  it('a posting failure releases its queue slot without rejecting another import', async () => {
    const importer = new AssetImportController(repository(), 1);
    const first = importer.import(file(), 'project');
    await vi.waitFor(() => expect(TestWorker.instances[0]?.postMessage).toHaveBeenCalledOnce());
    const worker = TestWorker.instances[0];
    worker.respond(0, prepared);
    await first;
    worker.postMessage.mockImplementationOnce(() => { throw new Error('Cannot clone'); });
    await expect(importer.import(file(), 'project')).rejects.toThrow('Cannot clone');
    const next = importer.import(file(), 'project');
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(3));
    worker.respond(2, prepared);
    await expect(next).resolves.toMatchObject({ id: 'photo' });
    expect(worker.terminate).not.toHaveBeenCalled();
  });
});
