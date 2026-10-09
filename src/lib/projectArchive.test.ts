import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { readProject } from '@/storage/database';
import { checksum, createProjectArchive, restoreProjectArchive } from './projectArchive';
import { newDocument } from '@/editor/documentStore';
import type { ImageLayer } from '@/types';
function presetDocument(format: Parameters<typeof newDocument>[0]) {
  const doc = newDocument(format);
  const photo: ImageLayer = { id: 'photo', kind: 'image', name: 'Photo', assetId: null, x: 100, y: 100, width: 600, height: 800, rotation: -5, opacity: 1, visible: true, locked: false, cornerRadius: 0, cropScale: 1, cropOffsetX: 0, cropOffsetY: 0 };
  doc.layers[photo.id] = photo; doc.slides[doc.slideOrder[0]].layerOrder = [photo.id];
  return doc;
}

vi.stubGlobal('Blob', NodeBlob);
vi.stubGlobal('crypto', webcrypto);
const format = { name: 'Test portrait', width: 1080, height: 1350 };
async function fixture() {
  const doc = presetDocument(format);
  doc.name = 'Original HDR post';
  const original = new Blob(['untouched-heic-gain-map-and-exif'], { type: 'image/heic' });
  const preview = new Blob(['jpeg-preview'], { type: 'image/jpeg' });
  const thumbnail = new Blob(['thumb'], { type: 'image/jpeg' });
  const meta = await assetRepository.commit({ file: preview, sourceFile: original, sourceMime: original.type, sourceName: 'iPhone.HEIC', thumbnail, hash: await checksum(original), mime: preview.type, name: 'iPhone.jpg', width: 4000, height: 3000 }, doc.id);
  const layer = doc.layers[doc.slides[doc.slideOrder[0]].layerOrder[0]];
  if (layer.kind === 'image') { layer.assetId = meta.id; layer.cropScale = 1.4; layer.cropOffsetX = .2; layer.cropOffsetY = -.3; layer.strokeWidth = 45; }
  return { doc, meta, original, preview };
}
describe('portable projects and original preservation', () => {
  it('round trips original bytes, preview bytes, crop, frame, rotation, and slide order without overwriting the source project', async () => {
    const { doc, meta, original, preview } = await fixture();
    const archive = await createProjectArchive(doc);
    const restored = await restoreProjectArchive(archive);
    expect(restored.id).not.toBe(doc.id);
    expect(restored.name).toBe('Original HDR post (restored)');
    expect(restored.slideOrder).toEqual(doc.slideOrder);
    expect(restored.layers).toEqual(doc.layers);
    expect(await readProject(restored.id)).toEqual(restored);
    expect(await (await assetRepository.readSource(meta.id))!.text()).toBe(await original.text());
    expect(await (await assetRepository.readOriginal(meta.id))!.text()).toBe(await preview.text());
    expect((await assetRepository.listMetadata(restored.id))[0].sourceName).toBe('iPhone.HEIC');
    await assetRepository.remove(meta.id, restored.id);
    expect(await assetRepository.readSource(meta.id)).toBeDefined();
  });
  it('restores into fresh storage with remapped photo ids', async () => {
    const doc = presetDocument(format);
    const newSource = new Blob(['fresh-device-HDR-original'], { type: 'image/heic' });
    const freshMeta = await assetRepository.commit({ file: new Blob(['fresh-preview'], { type: 'image/jpeg' }), sourceFile: newSource, sourceMime: 'image/heic', sourceName: 'Fresh.HEIC', thumbnail: new Blob(['thumb']), hash: await checksum(newSource), name: 'Fresh.HEIC', mime: 'image/jpeg', width: 1000, height: 1000 }, doc.id);
    const first = doc.layers[doc.slides[doc.slideOrder[0]].layerOrder[0]];
    if (first.kind === 'image') first.assetId = freshMeta.id;
    const freshArchive = await createProjectArchive(doc);
    await assetRepository.remove(freshMeta.id, doc.id);
    const restored = await restoreProjectArchive(freshArchive);
    const layer = restored.layers[restored.slides[restored.slideOrder[0]].layerOrder[0]];
    expect(layer.kind).toBe('image');
    if (layer.kind !== 'image') throw new Error('Expected photo');
    expect(layer.assetId).not.toBe(freshMeta.id);
    expect(await (await assetRepository.readSource(layer.assetId!))!.text()).toBe(await newSource.text());
  });
  it('rejects corrupted media before creating any project or linking any assets', async () => {
    const { doc } = await fixture();
    const archive = await createProjectArchive(doc);
    const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
    const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      if (entry.filename === 'project.json') {
        const header = JSON.parse(await entry.getData!(new TextWriter()));
        header.assets[0].checksum = 'bad-checksum';
        await writer.add(entry.filename, new TextReader(JSON.stringify(header)));
      } else await writer.add(entry.filename, new BlobReader(await entry.getData!(new BlobWriter())), { level: 0 });
    }
    await reader.close();
    await expect(restoreProjectArchive(await writer.close())).rejects.toThrow('integrity check');
  });
});
