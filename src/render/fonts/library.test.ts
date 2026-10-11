import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listFonts, readFont, saveFont, type FontFile } from './library';
import { loadCustomFont } from './custom';
import { isCustomFont } from './families';
import { fontFileDefaults, importFontFile, validateWeight } from './import';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Reflect.deleteProperty(document, 'fonts'); });
const face = (value: number, weight = '400', style: 'normal' | 'italic' = 'normal'): FontFile => ({ bytes: new Uint8Array([value]).buffer, weight, style });

describe('local font library', () => {
  it('deduplicates identical bytes and descriptors without changing an existing font', async () => {
    const saved = await saveFont('Original name', 'file', [face(11)]);
    const again = await saveFont('Renamed', 'google', [face(11)]);
    expect(isCustomFont(saved.family)).toBe(true);
    expect(again).toEqual(saved);
    expect((await readFont(saved.family))?.files[0].bytes).toEqual(face(11).bytes);
    expect((await listFonts()).filter((f) => f.family === saved.family)).toHaveLength(1);
  });
  it('uses different identities for variants and preserves a family regardless of face order', async () => {
    const normal = await saveFont('Normal', 'file', [face(12)]);
    const bold = await saveFont('Bold', 'file', [face(12, '700')]);
    const family = await saveFont('Family', 'google', [face(13), face(14, '400', 'italic')]);
    expect(bold.family).not.toBe(normal.family);
    expect(await saveFont('Family again', 'google', [face(14, '400', 'italic'), face(13)])).toEqual(family);
  });
  it('reports missing fonts and retries a transient font-loading failure', async () => {
    const saved = await saveFont('Retry', 'file', [face(15)]);
    const load = vi.fn().mockRejectedValueOnce(new Error('Temporary font load failure')).mockResolvedValue({});
    const add = vi.fn();
    vi.stubGlobal('FontFace', class { load = load; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add } });
    await expect(loadCustomFont(`OpenSCRL_Font_${'0'.repeat(64)}`)).rejects.toThrow('missing');
    await expect(loadCustomFont(saved.family)).rejects.toThrow('Temporary font load failure');
    await loadCustomFont(saved.family);
    await loadCustomFont(saved.family);
    expect(load).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
  });
  it('validates before persisting unsupported or corrupt files', async () => {
    const before = await listFonts();
    await expect(importFontFile(new File(['bad'], 'font.svg'), 'Bad', { weight: '400', style: 'normal' })).rejects.toThrow('Choose a TTF');
    await expect(importFontFile(new File(['bad'], 'font.ttf'), '', { weight: '400', style: 'normal' })).rejects.toThrow('font name');
    expect(await listFonts()).toEqual(before);
  });
});

describe('font file descriptors', () => {
  it('normalizes weights and rejects invalid variable ranges', () => {
    expect(validateWeight(' 100   900 ')).toBe('100 900');
    for (const value of ['0', '1001', 'bold', '900 100', '100 500 900', '400px']) expect(() => validateWeight(value)).toThrow();
  });
  it('provides editable defaults for compressed files and truncated SFNT metadata', () => {
    expect(fontFileDefaults(new Uint8Array([0]).buffer, 'Example-BoldItalic.woff2')).toEqual({ name: 'Example BoldItalic', weight: '700', style: 'italic' });
    expect(fontFileDefaults(new Uint8Array([0, 1, 0, 0]).buffer, 'Example-Light.ttf').weight).toBe('300');
  });
  it('reads weight, italic style and a variable weight range from SFNT tables', () => {
    const bytes = new ArrayBuffer(200), view = new DataView(bytes);
    view.setUint32(0, 0x00010000); view.setUint16(4, 2);
    view.setUint32(12, 0x4f532f32); view.setUint32(20, 64); view.setUint32(24, 64);
    view.setUint16(68, 700); view.setUint16(126, 1);
    view.setUint32(28, 0x66766172); view.setUint32(36, 128); view.setUint32(40, 36);
    view.setUint16(132, 16); view.setUint16(136, 1); view.setUint16(138, 20);
    view.setUint32(144, 0x77676874); view.setInt32(148, 100 * 65536); view.setInt32(156, 900 * 65536);
    expect(fontFileDefaults(bytes, 'Variable.ttf')).toEqual({ name: 'Variable', weight: '100 900', style: 'italic' });
  });
});
