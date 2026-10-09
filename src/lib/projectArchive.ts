import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import type { AssetMeta, ProjectDocumentV2 } from '@/types';
import { assetRepository } from '@/assets/indexeddb/IndexedDbAssetRepository';
import { id } from './nano';
import { writeProject } from '@/storage/database';
import { validateProject } from './validateProject';

interface ArchivedAsset {
  id: string; name: string; mime: string; width: number; height: number;
  mediaKind?: AssetMeta['mediaKind']; duration?: number;
  preview: string; thumbnail: string; source?: string; sourceMime?: string; sourceName?: string;
  checksum: string; previewChecksum: string;
}
interface Manifest { kind: 'open-scrl-project'; version: 1; document: ProjectDocumentV2; assets: ArchivedAsset[] }
const MAX_BYTES = 1024 * 1024 * 1024;
export async function checksum(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
export async function createProjectArchive(doc: ProjectDocumentV2): Promise<Blob> {
  validateProject(doc);
  const snapshot = structuredClone(doc);
  const metadata = await assetRepository.listMetadata(doc.id);
  const referenced = new Set(Object.values(doc.layers).flatMap((layer) => layer.kind === 'image' && layer.assetId ? [layer.assetId] : []));
  for (const slide of Object.values(doc.slides)) if (slide.background.kind === 'image' && slide.background.assetId) referenced.add(slide.background.assetId);
  for (const assetId of referenced) if (!metadata.some((meta) => meta.id === assetId)) throw new Error('A used photo is missing. Restore it before making a backup.');
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  const assets: ArchivedAsset[] = [];
  try {
    for (const [i, meta] of metadata.entries()) {
      const preview = await assetRepository.readOriginal(meta.id);
      const source = await assetRepository.readSource(meta.id);
      const thumb = await assetRepository.readThumbnail(meta.id);
      if (!preview || !source || !thumb) throw new Error(`“${meta.sourceName || meta.name}” is missing from storage. The backup was not created.`);
      const record: ArchivedAsset = { id: meta.id, name: meta.name, mime: meta.mime, width: meta.width, height: meta.height, mediaKind: meta.mediaKind, duration: meta.duration, preview: `media/${i}/preview`, thumbnail: `media/${i}/thumbnail`, sourceMime: meta.sourceMime, sourceName: meta.sourceName, checksum: await checksum(source), previewChecksum: await checksum(preview) };
      await writer.add(record.preview, new BlobReader(preview), { level: 0 });
      await writer.add(record.thumbnail, new BlobReader(thumb), { level: 0 });
      if (meta.sourceKey) { record.source = `media/${i}/original`; await writer.add(record.source, new BlobReader(source), { level: 0 }); }
      assets.push(record);
    }
    await writer.add('project.json', new TextReader(JSON.stringify({ kind: 'open-scrl-project', version: 1, document: snapshot, assets } satisfies Manifest)));
    return await writer.close();
  } catch (error) { await writer.close().catch(() => undefined); throw error; }
}
export async function restoreProjectArchive(archive: Blob): Promise<ProjectDocumentV2> {
  if (archive.size > MAX_BYTES) throw new Error('Project backups must be smaller than 1 GB.');
  const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
  const committed: string[] = [];
  const projectId = id();
  try {
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    if (entries.length > 4000 || byName.size !== entries.length || entries.reduce((total, entry) => total + entry.uncompressedSize, 0) > MAX_BYTES) throw new Error('The project archive is too large or contains duplicate entries.');
    const header = byName.get('project.json');
    if (!header || header.directory || header.uncompressedSize > 8 * 1024 * 1024) throw new Error('This is not an Open-SCRL project backup.');
    const manifest = JSON.parse(await header.getData!(new TextWriter())) as Manifest;
    if (manifest.kind !== 'open-scrl-project' || manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 1000) throw new Error('This backup version is not supported.');
    validateProject(manifest.document);
    const ids = new Set<string>();
    const read = async (name: string, mime: string) => {
      const entry = byName.get(name);
      if (!entry || entry.directory) throw new Error('The project backup is missing a media file.');
      return entry.getData!(new BlobWriter(mime), { checkSignature: true });
    };
    // Validate all bytes and references before changing browser storage.
    const prepared = [];
    for (const asset of manifest.assets) {
      if (!asset || typeof asset.id !== 'string' || ids.has(asset.id) || typeof asset.name !== 'string' || typeof asset.mime !== 'string' || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) throw new Error('Invalid photo metadata in the backup.');
      ids.add(asset.id);
      const preview = await read(asset.preview, asset.mime);
      const source = asset.source ? await read(asset.source, asset.sourceMime || asset.mime) : preview;
      const thumbnail = await read(asset.thumbnail, 'image/jpeg');
      if (await checksum(source) !== asset.checksum || await checksum(preview) !== asset.previewChecksum) throw new Error(`The backup photo “${asset.name}” failed its integrity check.`);
      prepared.push({ asset, preview, source, thumbnail });
    }
    for (const layer of Object.values(manifest.document.layers)) if (layer.kind === 'image' && layer.assetId && !ids.has(layer.assetId)) throw new Error('A used photo is missing from the backup.');
    for (const slide of Object.values(manifest.document.slides)) if (slide.background.kind === 'image' && slide.background.assetId && !ids.has(slide.background.assetId)) throw new Error('A background photo is missing from the backup.');
    const remap = new Map<string, string>();
    for (const { asset, preview, source, thumbnail } of prepared) {
      const stored = await assetRepository.commit({ file: preview, sourceFile: asset.source ? source : undefined, sourceMime: asset.sourceMime, sourceName: asset.sourceName, thumbnail, hash: asset.checksum, name: asset.name, mime: asset.mime, width: asset.width, height: asset.height, mediaKind: asset.mediaKind, duration: asset.duration }, projectId);
      committed.push(stored.id); remap.set(asset.id, stored.id);
    }
    const doc = structuredClone(manifest.document);
    doc.id = projectId; doc.name = `${doc.name} (restored)`; doc.revision = 0; doc.createdAt = doc.updatedAt = Date.now();
    for (const layer of Object.values(doc.layers)) if (layer.kind === 'image' && layer.assetId) layer.assetId = remap.get(layer.assetId)!;
    for (const slide of Object.values(doc.slides)) if (slide.background.kind === 'image' && slide.background.assetId) slide.background.assetId = remap.get(slide.background.assetId)!;
    await writeProject(doc, { id: doc.id, name: doc.name, format: doc.format, slideCount: doc.slideOrder.length, createdAt: doc.createdAt, updatedAt: doc.updatedAt });
    return doc;
  } catch (error) {
    for (const assetId of committed) await assetRepository.remove(assetId, projectId).catch(() => undefined);
    throw error;
  } finally { await reader.close(); }
}
