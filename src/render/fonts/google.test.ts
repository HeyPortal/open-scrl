import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadGoogleFont, fetchGoogleCatalog, googleFileUrl, parseGoogleCatalog, saveGoogleFontsKey, type GoogleFont } from './google';
import { listFonts } from './library';

const font: GoogleFont = { family: 'Example', category: 'serif', files: { regular: 'http://fonts.gstatic.com/s/example/font.woff2' } };
beforeEach(async () => { vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); await saveGoogleFontsKey('test-key'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Google Fonts catalog', () => {
  it('rejects browsing and downloads while offline without making requests', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchGoogleCatalog()).rejects.toThrow('Connect to the internet');
    await expect(downloadGoogleFont(font)).rejects.toThrow('Connect to the internet');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the key out of URLs and caches the catalog until refreshed or the key changes', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [font] }) }); vi.stubGlobal('fetch', fetch);
    expect(await fetchGoogleCatalog()).toEqual([font]);
    expect(await fetchGoogleCatalog()).toEqual([font]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).not.toContain('test-key'); expect(options.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(url.searchParams.getAll('capability')).toEqual(['VF', 'WOFF2']);
    await saveGoogleFontsKey('replacement'); await fetchGoogleCatalog();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns an actionable authorization error without echoing Google response bodies or keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(fetchGoogleCatalog()).rejects.toThrow('Check that the Fonts Developer API is enabled');
    await saveGoogleFontsKey('');
    await expect(fetchGoogleCatalog()).rejects.toThrow('Add a Google Fonts API key');
  });
  it('only downloads from the Google font file host over HTTPS', () => {
    expect(googleFileUrl(font.files.regular)).toBe('https://fonts.gstatic.com/s/example/font.woff2');
    for (const url of ['https://evil.example/font', 'https://fonts.gstatic.com.evil.example/font', 'https://user:pass@fonts.gstatic.com/font', 'ftp://fonts.gstatic.com/font']) expect(() => googleFileUrl(url)).toThrow();
    expect(() => parseGoogleCatalog({ items: [{ ...font, files: { regular: 'https://evil.example/font' } }] })).toThrow();
  });
  it('does not persist partial family downloads', async () => {
    const before = await listFonts();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers: new Headers(), arrayBuffer: async () => new Uint8Array([1]).buffer }).mockResolvedValueOnce({ ok: false, status: 503 }));
    await expect(downloadGoogleFont({ ...font, files: { ...font.files, italic: 'https://fonts.gstatic.com/italic.woff2' } })).rejects.toThrow('Could not download');
    expect(await listFonts()).toEqual(before);
  });
  it('rejects unreadable catalog data before saving it', () => {
    expect(() => parseGoogleCatalog({})).toThrow('unreadable');
    expect(() => parseGoogleCatalog({ items: [{ family: 'Bad', files: {} }] })).toThrow('unreadable');
    expect(() => parseGoogleCatalog({ items: [{ ...font, axes: [{ tag: 'wght', start: 900, end: 100 }] }] })).toThrow('ranges');
  });
});
