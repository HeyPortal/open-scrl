import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import type { AssetMeta } from '@/types';

interface Entry { key: string; assetId: string; bitmap: ImageBitmap; bytes: number; refs: number; touched: number }
const BUCKETS = [512, 1024, 2048, 4096];

export class ImageResourceManager {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<ImageBitmap>>();
  private readonly maxBytes: number;
  constructor(maxBytes = 192 * 1024 * 1024) { this.maxBytes = maxBytes; }

  private bucket(edge: number) { return BUCKETS.find((b) => b >= edge) ?? BUCKETS.at(-1)!; }
  async acquire(
    assetId: string,
    requestedEdge: number,
    knownMetadata?: Pick<AssetMeta, 'width' | 'height'>,
  ): Promise<ImageBitmap> {
    const bucket = this.bucket(requestedEdge); const key = `${assetId}:${bucket}`; const cached = this.entries.get(key);
    if (cached) { cached.refs++; cached.touched = performance.now(); return cached.bitmap; }
    let work = this.pending.get(key);
    if (!work) {
      work = (async () => {
        const [blob, meta] = await Promise.all([
          assetRepository.readOriginal(assetId),
          knownMetadata ? Promise.resolve(knownMetadata) : assetRepository.readMetadata(assetId),
        ]);
        if (!blob || !meta) throw new Error('Asset missing.');
        const scale = Math.min(1, bucket / Math.max(meta.width, meta.height));
        const bitmap = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(meta.width * scale)), resizeHeight: Math.max(1, Math.round(meta.height * scale)), resizeQuality: 'high' });
        this.entries.set(key, { key, assetId, bitmap, bytes: bitmap.width * bitmap.height * 4, refs: 0, touched: performance.now() }); return bitmap;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, work);
    }
    const bitmap = await work; const entry = this.entries.get(key); if (entry) entry.refs++; return bitmap;
  }
  release(assetId: string, requestedEdge: number) { const entry = this.entries.get(`${assetId}:${this.bucket(requestedEdge)}`); if (entry) { entry.refs = Math.max(0, entry.refs - 1); entry.touched = performance.now(); } this.evict(); }
  removeAsset(assetId: string) { for (const [key, entry] of this.entries) if (entry.assetId === assetId) { entry.bitmap.close(); this.entries.delete(key); } }
  get byteSize() { return [...this.entries.values()].reduce((n, e) => n + e.bytes, 0); }
  private evict() { let size = this.byteSize; const candidates = [...this.entries.values()].filter((e) => e.refs === 0).sort((a,b)=>a.touched-b.touched); for (const entry of candidates) { if (size <= this.maxBytes) break; entry.bitmap.close(); this.entries.delete(entry.key); size -= entry.bytes; } }
}

export const imageResourceManager = new ImageResourceManager();
