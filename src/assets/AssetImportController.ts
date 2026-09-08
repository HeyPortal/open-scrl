import type { AssetMeta } from '@/types';
import { id } from '@/lib/nano';
import type { AssetRepository, PreparedAsset } from './AssetRepository';

export class DuplicateAssetError extends Error {
  readonly existing: AssetMeta;
  constructor(existing: AssetMeta) { super('Media has already been imported.'); this.existing = existing; this.name = 'DuplicateAssetError'; }
}

export class AssetImportController {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (asset: PreparedAsset) => void; reject: (error: unknown) => void }>();
  private active = 0;
  private queue: (() => void)[] = [];

  private readonly repository: AssetRepository;
  private readonly concurrency: number;
  constructor(repository: AssetRepository, concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Import concurrency must be a positive integer.');
    this.repository = repository;
    this.concurrency = concurrency;
  }

  private acquire() { return new Promise<void>((resolve) => { if (this.active < this.concurrency) { this.active++; resolve(); } else this.queue.push(resolve); }); }
  private release() { this.active--; const next = this.queue.shift(); if (next) { this.active++; next(); } }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/asset.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const fail = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      const requests = [...this.pending.values()];
      this.pending.clear();
      for (const request of requests) request.reject(error);
      // The next queued or newly requested import creates a fresh worker.
      // Failed files are not silently retried in a potentially infinite loop.
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'The media import worker stopped unexpectedly.'));
    };
    worker.onmessageerror = () => fail(new Error('Could not read the media import worker response.'));
    worker.onmessage = (event: MessageEvent<{ id: string; result?: PreparedAsset; error?: string }>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      if (event.data.result) request.resolve(event.data.result);
      else request.reject(new Error(event.data.error ?? 'Import failed.'));
    };
    return worker;
  }

  private prepare(file: File): Promise<PreparedAsset> {
    return new Promise((resolve, reject) => {
      const worker = this.getWorker();
      const requestId = id();
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage({ id: requestId, file });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  async import(file: File, projectId: string): Promise<AssetMeta> {
    await this.acquire();
    try {
      const prepared = await this.prepare(file);
      const duplicate = await this.repository.findByHash(prepared.hash);
      if (duplicate) {
        if (await this.repository.isLinkedToProject(projectId, duplicate.id)) throw new DuplicateAssetError(duplicate);
      }
      return await this.repository.commit(prepared, projectId);
    } finally { this.release(); }
  }
}
