import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';

if (process.platform !== 'darwin') throw new Error('Native HDR checks require macOS.');
const folder = mkdtempSync(path.join(tmpdir(), 'open-scrl-hdr-check-'));
const binary = path.join(folder, 'HDRRenderer');
execFileSync('swiftc', ['-module-cache-path', path.join(tmpdir(), 'open-scrl-swift-cache'), 'native/HDRRenderer.swift', '-o', binary]);
const run = (...args) => execFileSync(binary, args, { encoding: 'utf8' }).trim();
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + x * 4 + 1;
    const pixel = typeof rgba === 'function' ? rgba(x, y) : rgba;
    for (let c = 0; c < 4; c++) raw[offset + c] = pixel[c];
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
run('fixture', path.join(folder, 'original'));
run('fixture', path.join(folder, 'original.heic'));
assert.equal(JSON.parse(run('inspect', path.join(folder, 'original.heic'))).isoGainMap, true);
writeFileSync(path.join(folder, 'original_heic'), readFileSync(path.join(folder, 'original.heic')));
run('preview', path.join(folder, 'original.heic'), path.join(folder, 'preview.jpg'));
assert.equal(JSON.parse(run('inspect', path.join(folder, 'preview.jpg'))).gainMap, false);
const sourceReport = JSON.parse(run('inspect', path.join(folder, 'original')));
assert.equal(sourceReport.isoGainMap, true);
assert(sourceReport.maxLinearHDR > 3);
writeFileSync(path.join(folder, 'mask'), png(1080, 1350, (x, y) => [255,255,255, x >= 110 && x < 970 && y >= 100 && y < 1250 ? 255 : 0]));
writeFileSync(path.join(folder, 'frame'), png(1080, 1350, (x, y) => [255,255,255, (x >= 110 && x < 970 && y >= 100 && y < 1250 && (x < 135 || x >= 945 || y < 125 || y >= 1225)) ? 255 : 0]));
writeFileSync(path.join(folder, 'second_mask'), png(1080, 1350, (x, y) => [255,255,255, x >= 620 && x < 960 && y >= 700 && y < 1040 ? 255 : 0]));
const scene = { width: 1080, height: 1350, pixelRatio: 1, entries: [
  { kind: 'photo', file: 'original', mask: 'mask', crop: { x: 80, y: 60, width: 480, height: 360 }, x: 110, y: 100, width: 860, height: 1150, rotation: 8 },
  { kind: 'raster', file: 'frame' },
  { kind: 'photo', file: 'original_heic', mask: 'second_mask', crop: { x: 100, y: 60, width: 440, height: 360 }, x: 620, y: 700, width: 340, height: 340, rotation: -6 },
] };
writeFileSync(path.join(folder, 'scene.json'), JSON.stringify(scene));
const report = JSON.parse(run('render', path.join(folder, 'scene.json'), path.join(folder, 'export.jpg')));
assert.equal(report.width, 1080); assert.equal(report.height, 1350); assert.equal(report.isoGainMap, true); assert(report.maxLinearHDR > 3);
// Re-cropping to only the source's SDR half must fail instead of attaching a fake HDR label.
scene.entries[0].crop = { x: 0, y: 0, width: 300, height: 480 };
scene.entries[2].crop = { x: 0, y: 0, width: 300, height: 480 };
writeFileSync(path.join(folder, 'scene.json'), JSON.stringify(scene));
assert.throws(() => run('render', path.join(folder, 'scene.json'), path.join(folder, 'sdr.jpg')), /no visible HDR highlights/);
writeFileSync(path.join(folder, 'sdr_original'), readFileSync(path.join(folder, 'preview.jpg')));
scene.entries[0].file = scene.entries[2].file = 'sdr_original';
writeFileSync(path.join(folder, 'scene.json'), JSON.stringify(scene));
assert.throws(() => run('render', path.join(folder, 'scene.json'), path.join(folder, 'sdr.jpg')), /no HDR source photos/);
mkdirSync('test-artifacts', { recursive: true });
writeFileSync('test-artifacts/hdr-export.jpg', readFileSync(path.join(folder, 'export.jpg')));
writeFileSync('test-artifacts/hdr-report.json', JSON.stringify({ source: sourceReport, editedExport: report }, null, 2));
console.log('JPEG/HEIC HDR originals, two-photo crop/resize/rotation/frame composition, ISO gain-map export, extended pixels, and SDR rejection passed.');
console.log(JSON.stringify(report));
