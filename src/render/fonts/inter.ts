import normalLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import normalLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import italicLatin from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url';
import italicLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2?url';

// Match fonts.css so DOM text, Canvas 2D, and worker exports use the same files.
const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const latinExt = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
let pending: Promise<void> | undefined;

/** Load before measuring text; export workers have their own independent FontFaceSet. */
export function loadInterFonts(): Promise<void> {
  if (pending) return pending;
  const scope = globalThis as typeof globalThis & { fonts?: FontFaceSet };
  const fonts = typeof document === 'undefined' ? scope.fonts : document.fonts;
  if (!fonts || typeof FontFace === 'undefined') return Promise.resolve();

  pending = (async () => {
    const faces = await Promise.all([
      [normalLatin, 'normal', latin],
      [normalLatinExt, 'normal', latinExt],
      [italicLatin, 'italic', latin],
      [italicLatinExt, 'italic', latinExt],
    ].map(async ([assetUrl, style, unicodeRange]) => {
      const url = new URL(assetUrl, import.meta.url).href;
      const face = new FontFace('Inter Variable', `url("${url}") format("woff2")`, { weight: '100 900', style, unicodeRange });
      return face.load();
    }));
    // Use identical registration in both scopes: mixing CSS-connected faces with
    // worker faces changes kerning across latin/latin-ext boundaries in Chromium.
    for (const face of faces) fonts.add(face);
  })().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
