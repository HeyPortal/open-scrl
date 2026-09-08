import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import type { AssetMeta } from '@/types';

interface Entry { key: string; assetId: string; bitmap: ImageBitmap; bytes: number; refs: number; touched: number }
export interface ImageLease { bitmap: ImageBitmap; release: () => void }
const BUCKETS = [512, 1024, 2048, 4096];

export class ImageResourceManager {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<Entry>>();
  private readonly maxBytes: number;
  constructor(maxBytes = 192 * 1024 * 1024) { this.maxBytes = maxBytes; }

  private bucket(edge: number) { return BUCKETS.find((b) => b >= edge) ?? BUCKETS.at(-1)!; }
  async acquire(
    assetId: string,
    requestedEdge: number,
    knownMetadata?: Pick<AssetMeta, 'width' | 'height'>,
  ): Promise<ImageLease> {
    const bucket = this.bucket(requestedEdge);
    const key = `${assetId}:${bucket}`;
    let entry = this.entries.get(key);
    if (!entry) {
      let work = this.pending.get(key);
      if (!work) {
        const decode = async (): Promise<Entry> => {
          const [blob, meta] = await Promise.all([
            assetRepository.readOriginal(assetId),
            knownMetadata ? Promise.resolve(knownMetadata) : assetRepository.readMetadata(assetId),
          ]);
          if (!blob || !meta) throw new Error('Asset missing.');
          const scale = Math.min(1, bucket / Math.max(meta.width, meta.height));
          const bitmap = await createImageBitmap(blob, {
            resizeWidth: Math.max(1, Math.round(meta.width * scale)),
            resizeHeight: Math.max(1, Math.round(meta.height * scale)), resizeQuality: 'high',
          });
          // Removal invalidates this particular decode without preventing a
          // later acquisition of the same ID from starting its own decode.
          if (this.pending.get(key) !== work) {
            bitmap.close();
            throw new Error('Asset was removed while decoding.');
          }
          const decoded: Entry = { key, assetId, bitmap, bytes: bitmap.width * bitmap.height * 4, refs: 0, touched: performance.now() };
          this.entries.set(key, decoded);
          return decoded;
        };
        work = decode().finally(() => { if (this.pending.get(key) === work) this.pending.delete(key); });
        this.pending.set(key, work);
      }
      entry = await work;
      if (this.entries.get(key) !== entry) throw new Error('Asset was removed while decoding.');
    }
    const owned = entry;
    owned.refs++;
    owned.touched = performance.now();
    this.evict();
    let released = false;
    return {
      bitmap: owned.bitmap,
      release: () => {
        if (released) return;
        released = true;
        owned.refs--;
        owned.touched = performance.now();
        this.evict();
      },
    };
  }

  removeAsset(assetId: string) {
    for (const key of this.pending.keys()) if (key.startsWith(`${assetId}:`)) this.pending.delete(key);
    for (const [key, entry] of this.entries) if (entry.assetId === assetId) {
      entry.bitmap.close();
      this.entries.delete(key);
    }
  }
  get byteSize() { return [...this.entries.values()].reduce((n, e) => n + e.bytes, 0); }
  private evict() {
    let size = this.byteSize;
    if (size <= this.maxBytes) return;
    const candidates = [...this.entries.values()].filter((e) => e.refs === 0).sort((a, b) => a.touched - b.touched);
    for (const entry of candidates) {
      if (size <= this.maxBytes) break;
      entry.bitmap.close();
      this.entries.delete(entry.key);
      size -= entry.bytes;
    }
  }
}

export const imageResourceManager = new ImageResourceManager();
