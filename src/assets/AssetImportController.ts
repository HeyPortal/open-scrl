import type { AssetMeta } from '@/types';
import { id } from '@/lib/nano';
import type { AssetRepository, PreparedAsset } from './AssetRepository';

export class DuplicateAssetError extends Error {
  readonly existing: AssetMeta;
  constructor(existing: AssetMeta) { super('Media has already been imported.'); this.existing = existing; this.name = 'DuplicateAssetError'; }
}

export class AssetImportController {
  private readonly worker = new Worker(new URL('../workers/asset.worker.ts', import.meta.url), { type: 'module' });
  private active = 0;
  private queue: (() => void)[] = [];

  private readonly repository: AssetRepository;
  private readonly concurrency: number;
  constructor(repository: AssetRepository, concurrency = 2) { this.repository = repository; this.concurrency = concurrency; }

  private acquire() { return new Promise<void>((resolve) => { if (this.active < this.concurrency) { this.active++; resolve(); } else this.queue.push(resolve); }); }
  private release() { this.active--; const next = this.queue.shift(); if (next) { this.active++; next(); } }

  private prepare(file: File): Promise<PreparedAsset> {
    return new Promise((resolve, reject) => {
      const requestId = id();
      const onMessage = (event: MessageEvent<{ id: string; result?: PreparedAsset; error?: string }>) => {
        if (event.data.id !== requestId) return;
        this.worker.removeEventListener('message', onMessage);
        if (event.data.result) resolve(event.data.result); else reject(new Error(event.data.error ?? 'Import failed.'));
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage({ id: requestId, file });
    });
  }

  async import(file: File, projectId: string): Promise<AssetMeta> {
    await this.acquire();
    try {
      const prepared = await this.prepare(file);
      const duplicate = await this.repository.findByHash(prepared.hash);
      if (duplicate) {
        if (await this.repository.isLinkedToProject(projectId, duplicate.id)) throw new DuplicateAssetError(duplicate);
        await this.repository.linkToProject(projectId, duplicate.id);
        return duplicate;
      }
      return await this.repository.commit(prepared, projectId);
    } finally { this.release(); }
  }
}
