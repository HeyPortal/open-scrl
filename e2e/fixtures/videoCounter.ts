import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Input, BlobSource, MP4, VideoSampleSink } from 'mediabunny';
import { assetRepository } from '../../src/assets/indexeddb/IndexedDbAssetRepository';
import { renderSlideAsVideo } from '../../src/export/video';

export async function exportVideoCounter() {
  if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) return null;
  const supported = await VideoEncoder.isConfigSupported({ codec: 'avc1.64002a', width: 320, height: 240 });
  if (!supported.supported) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_000_000, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: 30 });
  await output.start();
  // Three seconds at 30 fps; the exporter must repeat frames on its 60 fps timeline.
  for (let index = 0; index < 90; index++) {
    ctx.fillStyle = '#777777'; ctx.fillRect(0, 0, 320, 240);
    for (let bit = 0; bit < 8; bit++) {
      ctx.fillStyle = index & (1 << bit) ? '#ffffff' : '#000000';
      ctx.fillRect(bit * 32, 100, 32, 40);
    }
    await source.add(index / 30, 1 / 30);
  }
  source.close(); await output.finalize();
  const blob = new Blob([target.buffer!], { type: 'video/mp4' });
  const asset = await assetRepository.commit({ file: blob, thumbnail: new Blob(), hash: 'mp4-counter', width: 320, height: 240, mime: 'video/mp4', name: 'counter.mp4', mediaKind: 'video', duration: 3 }, 'mp4-export-test');
  const layer: import('../../src/types').ImageLayer = { id: 'video', kind: 'image', name: 'Counter', x: 0, y: 0, width: 320, height: 240, rotation: 0, opacity: 1, visible: true, locked: false, assetId: asset.id, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
  const doc: import('../../src/types').ProjectDocumentV2 = { schemaVersion: 2, revision: 0, id: 'mp4-export-test', name: 'Counter', format: { name: 'Test', width: 320, height: 240 }, slideOrder: ['slide'], slides: { slide: { id: 'slide', background: { kind: 'solid', color: '#ffffff' }, layerOrder: ['video', 'duplicate'] } }, layers: { video: layer, duplicate: { ...layer, id: 'duplicate', opacity: .5 } }, createdAt: 0, updatedAt: 0 };
  // The same clip appears twice; both placements must share one source timeline.
  const originalDecode = VideoDecoder.prototype.decode;
  const originalCreate = document.createElement.bind(document);
  let decoded = 0, videoElements = 0;
  VideoDecoder.prototype.decode = function (chunk) { decoded++; originalDecode.call(this, chunk); };
  document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    if (tag === 'video') videoElements++;
    return originalCreate(tag, options);
  }) as typeof document.createElement;
  const progress: { frame: number; total: number }[] = [];
  let rendered: Blob;
  try { rendered = await renderSlideAsVideo(doc, 'slide', (frame, total) => progress.push({ frame, total })); }
  finally { VideoDecoder.prototype.decode = originalDecode; document.createElement = originalCreate; }
  const input = new Input({ source: new BlobSource(rendered), formats: [MP4] });
  const track = (await input.getPrimaryVideoTrack())!;
  const fps = (await track.computePacketStats()).averagePacketRate;
  const samples = new VideoSampleSink(track);
  const mismatches: { index: number; expected: number; actual: number }[] = [];
  const timestamps: number[] = [];
  let index = 0;
  for await (const sample of samples.samples()) {
    sample.draw(ctx, 0, 0, 320, 240);
    let actual = 0;
    for (let bit = 0; bit < 8; bit++) if (ctx.getImageData(bit * 32 + 16, 120, 1, 1).data[0] > 128) actual |= 1 << bit;
    const expected = Math.floor(index * 30 / fps + 1e-4);
    if (actual !== expected) mismatches.push({ index, expected, actual });
    timestamps.push(sample.timestamp); index++; sample.close();
  }
  input.dispose();
  return { decoded, videoElements, frames: index, fps, timestamps, mismatches, progress, doc };
}

/** Builds VP9's separate color/alpha packets without external binary fixtures. */
export async function exportTransparentVideo() {
  if (!('VideoEncoder' in window)) return null;
  for (const codec of ['avc1.64002a', 'vp09.00.10.08']) {
    if (!(await VideoEncoder.isConfigSupported({ codec, width: 64, height: 64 })).supported) return null;
  }
  const { EncodedPacket, EncodedVideoPacketSource, WebMOutputFormat } = await import('mediabunny');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  async function plane(alpha: boolean) {
    ctx.fillStyle = alpha ? '#ffffff' : '#ff0000'; ctx.fillRect(0, 0, 64, 64);
    if (alpha) { ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 32, 64); }
    let packet: { data: Uint8Array; metadata: EncodedVideoChunkMetadata } | undefined;
    let failure: DOMException | undefined;
    const encoder = new VideoEncoder({ output: (chunk, metadata) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); packet = { data, metadata: metadata ?? {} }; }, error: (error) => { failure = error; } });
    encoder.configure({ codec: 'vp09.00.10.08', width: 64, height: 64, bitrate: 100_000, framerate: 30 });
    const alphaPixels = new Uint8Array(64 * 64 * 3 / 2).fill(128);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) alphaPixels[y * 64 + x] = x < 32 ? 0 : 255;
    const frame = alpha
      ? new VideoFrame(alphaPixels, { format: 'I420', codedWidth: 64, codedHeight: 64, timestamp: 0, duration: 33_333, colorSpace: { fullRange: true, matrix: 'bt709', primaries: 'bt709', transfer: 'bt709' } })
      : new VideoFrame(canvas, { timestamp: 0, duration: 33_333 });
    try { encoder.encode(frame, { keyFrame: true }); await encoder.flush(); }
    finally { frame.close(); if (encoder.state !== 'closed') encoder.close(); }
    if (failure) throw failure;
    if (!packet) throw new Error('VP9 encoder produced no packet');
    return packet;
  }
  const color = await plane(false), alpha = await plane(true);
  const target = new BufferTarget(), output = new Output({ format: new WebMOutputFormat(), target });
  const source = new EncodedVideoPacketSource('vp9');
  output.addVideoTrack(source, { frameRate: 30, canBeTransparent: true }); await output.start();
  for (let index = 0; index < 90; index++) await source.add(new EncodedPacket(color.data, 'key', index / 30, 1 / 30, index, undefined, { alpha: alpha.data }), index === 0 ? color.metadata : undefined);
  source.close(); await output.finalize();
  const blob = new Blob([target.buffer!], { type: 'video/webm' });
  const asset = await assetRepository.commit({ file: blob, thumbnail: new Blob(), hash: 'alpha-video', width: 64, height: 64, mime: 'video/webm', name: 'alpha.webm', mediaKind: 'video', duration: 3 }, 'alpha-export-test');
  const layer: import('../../src/types').ImageLayer = { id: 'video', kind: 'image', name: 'Alpha', x: 0, y: 0, width: 1280, height: 720, rotation: 0, opacity: 1, visible: true, locked: false, assetId: asset.id, cornerRadius: 0, cropOffsetX: 0, cropOffsetY: 0, cropScale: 1 };
  const doc: import('../../src/types').ProjectDocumentV2 = { schemaVersion: 2, revision: 0, id: 'alpha-export-test', name: 'Alpha', format: { name: 'Test', width: 1280, height: 720 }, slideOrder: ['slide'], slides: { slide: { id: 'slide', background: { kind: 'solid', color: '#00ff00' }, layerOrder: ['video'] } }, layers: { video: layer }, createdAt: 0, updatedAt: 0 };
  const url = URL.createObjectURL(blob), video = document.createElement('video'); video.muted = true; video.src = url;
  await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Native WebM decode failed')); });
  const presented = new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
  await video.play(); await presented; video.pause();
  ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 64, 64); ctx.drawImage(video, 0, 0);
  const editor = [16, 48].map(x => [...ctx.getImageData(x, 32, 1, 1).data]);
  video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  const rendered = await renderSlideAsVideo(doc, 'slide');
  const input = new Input({ source: new BlobSource(rendered), formats: [MP4] });
  const sample = await new VideoSampleSink((await input.getPrimaryVideoTrack())!).getSample(0);
  if (!sample) throw new Error('Exported MP4 has no first frame');
  sample.draw(ctx, 0, 0, 64, 64);
  const exported = [16, 48].map(x => [...ctx.getImageData(x, 32, 1, 1).data]);
  sample.close(); input.dispose();
  return { editor, exported };
}
