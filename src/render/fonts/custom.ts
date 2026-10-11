import type { Layer } from '@/types';
import { isCustomFont } from './families';
import { invalidateTextLayoutCache } from '@/render/paint/text';
import { readFont, type FontFile } from './library';

const pending = new Map<string, Promise<void>>();
function fontSet() {
  const scope = globalThis as typeof globalThis & { fonts?: FontFaceSet };
  return typeof document === 'undefined' ? scope.fonts : document.fonts;
}
export async function validateFontFiles(family: string, files: FontFile[]) {
  if (!fontSet() || typeof FontFace === 'undefined') throw new Error('This browser cannot load custom fonts. Try Chrome, Edge, Firefox or Safari.');
  return Promise.all(files.map(({ bytes, weight, style }) => new FontFace(family, bytes, { weight, style }).load()));
}
export function loadCustomFont(family: string): Promise<void> {
  if (!isCustomFont(family)) return Promise.resolve();
  let work = pending.get(family);
  if (!work) {
    work = (async () => {
      const stored = await readFont(family);
      if (!stored) throw new Error('A font used in this project is missing. Reimport its original font file on this device.');
      const faces = await validateFontFiles(family, stored.files);
      for (const face of faces) fontSet()!.add(face);
      invalidateTextLayoutCache();
    })().catch((error: unknown) => { pending.delete(family); throw error; });
    pending.set(family, work);
  }
  return work;
}
export async function ensureCustomFonts(layers: Iterable<Layer>) {
  const families = new Set<string>();
  for (const layer of layers) if (layer.kind === 'text' && isCustomFont(layer.fontFamily)) families.add(layer.fontFamily);
  const results = await Promise.allSettled([...families].map(loadCustomFont));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
