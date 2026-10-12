/** Keep the document's portable font names separate from bundled browser faces. */
export const isCustomFont = (family: string) => /^OpenSCRL_Font_[a-f0-9]{64}$/.test(family);

export function resolveFontFamily(family: string): string {
  return family === 'Inter' ? '"Inter Variable"' : isCustomFont(family) ? `"${family}"` : family;
}

/** Keep font storage and browser loading out of the initial app chunk. */
export async function ensureLayerFonts(layers: Iterable<import('@/types').Layer>) {
  const custom = [...layers].filter((layer) => layer.kind === 'text' && isCustomFont(layer.fontFamily));
  if (custom.length) await (await import('./custom')).ensureCustomFonts(custom);
}
