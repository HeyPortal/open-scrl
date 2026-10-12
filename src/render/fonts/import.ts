import { saveFont, type FontVariant } from './library';
import { loadCustomFont, validateFontFiles } from './custom';

export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export function validateWeight(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2 || parts.some((v) => !/^\d{1,4}$/.test(v) || +v < 1 || +v > 1000) || (parts.length === 2 && +parts[0] > +parts[1])) {
    throw new Error('Enter a weight from 1 to 1000, or a variable range such as 100 900.');
  }
  return parts.map(Number).join(' ');
}

/** Read SFNT metadata without a font-rendering dependency. Compressed files use editable filename defaults. */
export function fontFileDefaults(bytes: ArrayBuffer, filename: string): { name: string } & FontVariant {
  const result = {
    name: filename.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]/g, ' '),
    weight: /bold/i.test(filename) ? '700' : /light/i.test(filename) ? '300' : '400',
    style: /italic|oblique/i.test(filename) ? 'italic' as const : 'normal' as const,
  };
  try {
    const view = new DataView(bytes);
    const signature = view.getUint32(0);
    if (signature !== 0x00010000 && signature !== 0x4f54544f) return result;
    const tables = new Map<string, { offset: number; length: number }>();
    for (let i = 0; i < view.getUint16(4); i++) {
      const start = 12 + i * 16;
      const tag = String.fromCharCode(...new Uint8Array(bytes, start, 4));
      const offset = view.getUint32(start + 8), length = view.getUint32(start + 12);
      if (offset + length <= bytes.byteLength) tables.set(tag, { offset, length });
    }
    const os2 = tables.get('OS/2');
    if (os2 && os2.length >= 64) {
      const weight = view.getUint16(os2.offset + 4);
      if (weight >= 1 && weight <= 1000) result.weight = String(weight);
      result.style = view.getUint16(os2.offset + 62) & 1 ? 'italic' : 'normal';
    }
    const fvar = tables.get('fvar');
    if (fvar && fvar.length >= 16) {
      const start = fvar.offset + view.getUint16(fvar.offset + 4);
      const size = view.getUint16(fvar.offset + 10);
      for (let i = 0; i < view.getUint16(fvar.offset + 8); i++) {
        const axis = start + i * size;
        if (axis + 20 > fvar.offset + fvar.length) break;
        if (view.getUint32(axis) === 0x77676874) result.weight = `${view.getInt32(axis + 4) / 65536} ${view.getInt32(axis + 12) / 65536}`;
      }
    }
    const names = tables.get('name');
    if (names && names.length >= 6) {
      const found: { value: string; rank: number }[] = [];
      for (let i = 0; i < view.getUint16(names.offset + 2); i++) {
        const entry = names.offset + 6 + i * 12;
        if (entry + 12 > names.offset + names.length) break;
        const platform = view.getUint16(entry), language = view.getUint16(entry + 4), id = view.getUint16(entry + 6);
        if ((id !== 1 && id !== 16) || (platform !== 0 && platform !== 3)) continue;
        const length = view.getUint16(entry + 8);
        const offset = names.offset + view.getUint16(names.offset + 4) + view.getUint16(entry + 10);
        if (offset + length > names.offset + names.length) continue;
        const value = new TextDecoder('utf-16be').decode(new Uint8Array(bytes, offset, length)).replace(/\0/g, '').trim();
        if (value) found.push({ value, rank: (id === 16 ? 2 : 0) + (language === 0x409 ? 1 : 0) });
      }
      found.sort((a, b) => b.rank - a.rank);
      if (found[0]) result.name = found[0].value;
    }
  } catch {
    // FontFace validates the entire file before anything is saved.
  }
  return result;
}

export async function importFontFile(file: File, name: string, variant: FontVariant) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Choose a TTF, OTF, WOFF or WOFF2 font file.');
  if (!file.size || file.size > MAX_FONT_BYTES) throw new Error('Choose a font file smaller than 20 MB.');
  const label = name.trim();
  if (!label || label.length > 128) throw new Error('Enter a font name of up to 128 characters.');
  const files = [{ bytes: await file.arrayBuffer(), weight: validateWeight(variant.weight), style: variant.style }];
  await validateFontFiles('OpenSCRL_Validation', files);
  const font = await saveFont(label, 'file', files);
  await loadCustomFont(font.family);
  return font;
}
