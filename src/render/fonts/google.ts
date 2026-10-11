import { readFontSetting, saveFont, writeFontSetting, type FontFile } from './library';
import { loadCustomFont, validateFontFiles } from './custom';
import { MAX_FONT_BYTES, validateWeight } from './import';

export interface GoogleFont {
  family: string;
  category: string;
  files: Record<string, string>;
  axes?: { tag: string; start: number; end: number }[];
}
export const GOOGLE_OFFLINE_MESSAGE = 'Connect to the internet to browse Google Fonts.';
export const defaultGoogleFontsKey = () => (import.meta.env.VITE_GOOGLE_FONTS_API_KEY as string | undefined)?.trim() ?? '';
export async function googleFontsKey() { return await readFontSetting<string>('google-key') ?? defaultGoogleFontsKey(); }
export async function saveGoogleFontsKey(key: string) {
  await writeFontSetting('google-key', key.trim() || undefined);
  await writeFontSetting('google-catalog', undefined);
}
function assertOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error(GOOGLE_OFFLINE_MESSAGE);
}
export function googleFileUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'fonts.gstatic.com' || url.port || url.username || url.password) throw new Error('Google Fonts returned an unsupported font URL.');
  url.protocol = 'https:';
  return url.href;
}
export function parseGoogleCatalog(value: unknown): GoogleFont[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new Error('Google Fonts returned an unreadable catalog. Try again.');
  return value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Google Fonts returned an unreadable catalog.');
    const font = item as GoogleFont;
    if (typeof font.family !== 'string' || !font.family.trim() || typeof font.category !== 'string' || !font.files || typeof font.files !== 'object' || !Object.keys(font.files).length) throw new Error('Google Fonts returned an unreadable catalog.');
    for (const [variant, url] of Object.entries(font.files)) {
      if (!/^(regular|italic|(?:[1-9]00|1000)(?:italic)?)$/.test(variant) || typeof url !== 'string') throw new Error('Google Fonts returned an unsupported variant.');
      googleFileUrl(url);
    }
    if (font.axes && (!Array.isArray(font.axes) || font.axes.some((axis) => typeof axis.tag !== 'string' || !Number.isFinite(axis.start) || !Number.isFinite(axis.end) || axis.start > axis.end))) throw new Error('Google Fonts returned unreadable variable font ranges.');
    return { family: font.family, category: font.category, files: font.files, axes: font.axes };
  });
}
export async function fetchGoogleCatalog(signal?: AbortSignal, refresh = false) {
  assertOnline();
  const key = await googleFontsKey();
  if (!key) throw new Error('Add a Google Fonts API key to browse the catalog.');
  const cached = await readFontSetting<{ at: number; items: GoogleFont[] }>('google-catalog');
  if (!refresh && cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return parseGoogleCatalog({ items: cached.items });
  const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts');
  url.searchParams.set('sort', 'popularity');
  url.searchParams.append('capability', 'VF');
  url.searchParams.append('capability', 'WOFF2');
  // The key stays out of URLs, thrown errors and saved project documents.
  const response = await fetch(url, { headers: { 'X-Goog-Api-Key': key }, signal });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 || response.status === 403 ? 'Google Fonts could not authorize this key. Check that the Fonts Developer API is enabled and the key allows this website.' : response.status === 429 ? 'Google Fonts has reached its request limit. Try again later.' : 'Google Fonts is unavailable. Try again.');
  const items = parseGoogleCatalog(await response.json());
  await writeFontSetting('google-catalog', { at: Date.now(), items });
  return items;
}
export async function downloadGoogleFont(font: GoogleFont, signal?: AbortSignal) {
  assertOnline();
  const variants = Object.entries(font.files);
  if (!variants.length || variants.length > 32) throw new Error('This font has too many files to download.');
  const axis = font.axes?.find((v) => v.tag === 'wght');
  const files: FontFile[] = [];
  let totalBytes = 0;
  // Sequential downloads bound memory and avoid dozens of simultaneous requests.
  for (const [variant, rawUrl] of variants) {
    assertOnline();
    const response = await fetch(googleFileUrl(rawUrl), { signal });
    if (!response.ok) throw new Error(`Could not download ${font.family}. Try again while connected to the internet.`);
    if (Number(response.headers.get('content-length')) > MAX_FONT_BYTES) throw new Error('This font file is larger than 20 MB.');
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FONT_BYTES) throw new Error('This font file is empty or larger than 20 MB.');
    totalBytes += bytes.byteLength;
    if (totalBytes > 50 * 1024 * 1024) throw new Error('This font family is larger than the 50 MB download limit.');
    const weight = validateWeight(axis ? `${axis.start} ${axis.end}` : variant.replace('italic', '') === '' || variant === 'regular' ? '400' : variant.replace('italic', ''));
    files.push({ bytes, weight, style: variant.includes('italic') ? 'italic' : 'normal' });
  }
  signal?.throwIfAborted();
  await validateFontFiles('OpenSCRL_Validation', files);
  signal?.throwIfAborted();
  const saved = await saveFont(font.family, 'google', files);
  await loadCustomFont(saved.family);
  return saved;
}
