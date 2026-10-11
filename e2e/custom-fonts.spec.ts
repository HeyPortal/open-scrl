import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures/test';
import type { TextLayer } from '../src/types';

const serifFile = 'node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2';
const interFile = 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2';
const italicFile = 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-italic.woff2';
const sampleCatalog = { items: [
  { family: 'Catalog Sans', category: 'sans-serif', files: { regular: 'https://fonts.gstatic.com/test/normal.woff2', italic: 'https://fonts.gstatic.com/test/italic.woff2' }, axes: [{ tag: 'wght', start: 100, end: 900 }] },
  { family: 'Catalog Serif', category: 'serif', files: { regular: 'https://fonts.gstatic.com/test/serif.woff2' } },
] };

async function setup(page: Page, mobile = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toBeVisible();
  if (mobile) await page.getByRole('tab', { name: 'Text', exact: true }).click();
  else await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Add text box' }).click();
  if (mobile) { await page.getByRole('button', { name: 'Close Text', exact: true }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click(); }
  await page.getByRole('button', { name: 'Manage fonts' }).click();
  await expect(page.getByRole('dialog', { name: 'Fonts', exact: true })).toBeVisible();
}
async function layer(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    return Object.values(useDocumentStore.getState().doc.layers).find((v) => v.kind === 'text') as TextLayer;
  });
}
async function renderComparison(page: Page, italic = false) {
  return page.evaluate(async (italic) => {
    const editorPath = '/src/editor/documentStore.ts', renderPath = '/src/export/canvas2d/render.ts', exportPath = '/src/export/ExportController.ts', textPath = '/src/render/paint/text.ts';
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { renderSlides } = await import(renderPath) as typeof import('../src/export/canvas2d/render');
    const { renderProjectSlides } = await import(exportPath) as typeof import('../src/export/ExportController');
    const { textFont } = await import(textPath) as typeof import('../src/render/paint/text');
    const editor = useDocumentStore.getState();
    const target = Object.values(editor.doc.layers).find((v) => v.kind === 'text')!;
    editor.updateLayer(target.id, { italic, text: 'Hamburgefontsiv 0123456789', fontSize: 48, x: 30, y: 30 });
    const doc = useDocumentStore.getState().doc, text = doc.layers[target.id] as TextLayer;
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
    ctx.font = textFont(text, 48); const width = ctx.measureText('Hamburgefontsiv').width;
    ctx.font = '48px Arial'; const fallback = ctx.measureText('Hamburgefontsiv').width;
    const options = { format: 'png' as const, quality: 1, pixelRatio: 1 };
    const [main] = await renderSlides(doc, [0], async () => undefined, (w, h) => new OffscreenCanvas(w, h), options);
    const [worker] = await renderProjectSlides(doc, [0], options);
    const hash = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const digest = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data);
      return [...new Uint8Array(digest)].join(',');
    };
    return { main: await hash(main), worker: await hash(worker), width, fallback, family: text.fontFamily };
  }, italic);
}

for (const mobile of [false, true]) test.describe(mobile ? 'phone custom fonts' : 'desktop custom fonts', () => {
  test.use({ viewport: mobile ? { width: 393, height: 852 } : { width: 1280, height: 900 } });
  test('imports fonts offline, keeps the Google tab disabled, and restores fonts when reopening', async ({ page, context }) => {
    await setup(page, mobile);
    await context.setOffline(true);
    const google = page.getByRole('tab', { name: 'Google Fonts', exact: true });
    await expect(google).toBeDisabled();
    await expect(google).toHaveCSS('opacity', '0.45');
    await expect(page.getByText('Connect to the internet to browse Google Fonts.', { exact: false })).toBeVisible();
    const file = page.getByLabel('Choose font file');
    await file.setInputFiles({ name: 'Brand-Serif.woff2', mimeType: 'font/woff2', buffer: await readFile(serifFile) });
    await page.getByLabel('Font name', { exact: true }).fill('Brand Serif');
    await page.getByRole('button', { name: 'Import and use font' }).click();
    await expect(page.getByText('Brand Serif is ready to use offline.', { exact: true })).toBeVisible();
    const imported = await layer(page); expect(imported.fontFamily).toMatch(/^OpenSCRL_Font_/); expect(imported.fontWeight).toBe(400);
    await context.setOffline(false);
    await expect(google).toBeEnabled();
    await page.getByRole('button', { name: 'Close Fonts', exact: true }).click();
    const compare = await renderComparison(page);
    expect(compare.width).not.toBe(compare.fallback); expect(compare.worker).toBe(compare.main);
    await page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts'; const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      await useDocumentStore.getState().saveToDisk();
    });
    await page.reload();
    await page.getByRole('button', { name: /Open Untitled/ }).first().click();
    await expect(page.locator('.konvajs-content')).toBeVisible();
    await context.setOffline(true);
    expect(await page.evaluate((family) => document.fonts.check(`400 48px "${family}"`), imported.fontFamily)).toBe(true);
    // Vite serves worker modules without an offline service worker. The production
    // PWA suite separately verifies an actual offline reload and worker export.
    await context.setOffline(false);
    const reopened = await renderComparison(page);
    expect(reopened.family).toBe(imported.fontFamily); expect(reopened.main).toBe(compare.main); expect(reopened.worker).toBe(compare.main);
    // A missing local font must fail export instead of quietly substituting another family.
    const missing = await page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts', renderPath = '/src/export/ExportController.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      const { renderProjectSlides } = await import(renderPath) as typeof import('../src/export/ExportController');
      const state = useDocumentStore.getState(), target = Object.values(state.doc.layers).find((v) => v.kind === 'text')!;
      state.updateLayer(target.id, { fontFamily: `OpenSCRL_Font_${'0'.repeat(64)}` });
      try { await renderProjectSlides(useDocumentStore.getState().doc, [0]); return ''; }
      catch (error) { return (error as Error).message; }
    });
    expect(missing).toContain('font used in this project is missing');
  });
});

test('searches the Google catalog, downloads variable/italic faces, and reuses them offline without network requests', async ({ page, context }) => {
  const apiCalls: { url: string; key?: string }[] = [], fileCalls: string[] = [];
  await page.route('https://www.googleapis.com/webfonts/v1/webfonts**', async (route) => {
    apiCalls.push({ url: route.request().url(), key: route.request().headers()['x-goog-api-key'] });
    await route.fulfill({ json: sampleCatalog });
  });
  await page.route('https://fonts.gstatic.com/test/**', async (route) => {
    fileCalls.push(route.request().url());
    await route.fulfill({ contentType: 'font/woff2', body: await readFile(route.request().url().includes('italic') ? italicFile : interFile) });
  });
  await setup(page);
  await page.getByRole('tab', { name: 'Google Fonts', exact: true }).click();
  await page.getByLabel('Google Fonts API key').fill('test-only-key');
  await page.getByRole('button', { name: 'Save key and browse' }).click();
  await expect(page.getByRole('button', { name: 'Download Catalog Sans', exact: true })).toBeVisible();
  expect(apiCalls).toHaveLength(1); expect(apiCalls[0].url).not.toContain('test-only-key'); expect(apiCalls[0].key).toBe('test-only-key');
  await page.getByRole('combobox', { name: 'Font category' }).selectOption('serif');
  await expect(page.getByRole('button', { name: 'Download Catalog Sans', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download Catalog Serif', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Font category' }).selectOption('');
  await page.getByRole('searchbox', { name: 'Search Google Fonts' }).fill('Sans');
  await expect(page.getByRole('button', { name: 'Download Catalog Serif', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Download Catalog Sans', exact: true }).click();
  await expect(page.getByText('Catalog Sans is ready to use offline.', { exact: true })).toBeVisible();
  expect(fileCalls).toHaveLength(2);
  const family = (await layer(page)).fontFamily;
  await context.setOffline(true);
  await expect(page.getByRole('tab', { name: 'Google Fonts', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Use font Catalog Sans', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use font Catalog Sans', exact: true }).click();
  await expect(page.getByText('Catalog Sans is ready to use offline.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Fonts', exact: true }).click();
  await context.setOffline(false);
  const normal = await renderComparison(page), italic = await renderComparison(page, true);
  expect(normal.family).toBe(family); expect(normal.main).toBe(normal.worker); expect(italic.main).toBe(italic.worker); expect(italic.main).not.toBe(normal.main);
  await page.getByRole('button', { name: 'Manage fonts' }).click();
  await page.getByRole('tab', { name: 'Google Fonts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use font Catalog Sans', exact: true })).toBeVisible();
  expect(apiCalls).toHaveLength(1); expect(fileCalls).toHaveLength(2);
});

test('shows an actionable key error and keeps failed downloads out of the library', async ({ page }) => {
  let validKey = false;
  await page.route('https://www.googleapis.com/webfonts/v1/webfonts**', async (route) => { await route.fulfill(validKey ? { json: sampleCatalog } : { status: 403, json: { error: { message: 'Sensitive server text should not be shown' } } }); });
  await page.route('https://fonts.gstatic.com/test/**', async (route) => { await route.fulfill({ status: 503 }); });
  await setup(page);
  await page.getByRole('tab', { name: 'Google Fonts', exact: true }).click();
  await page.getByLabel('Google Fonts API key').fill('invalid-key');
  await page.getByRole('button', { name: 'Save key and browse' }).click();
  await expect(page.getByRole('alert')).toContainText('Fonts Developer API is enabled');
  await expect(page.getByRole('alert')).not.toContainText('Sensitive server text');
  validKey = true;
  await page.getByLabel('Google Fonts API key').fill('test-key');
  await page.getByRole('button', { name: 'Save key and browse' }).click();
  await page.getByRole('button', { name: 'Download Catalog Sans', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not download Catalog Sans');
  expect((await layer(page)).fontFamily).toBe('Inter');
  await page.getByRole('tab', { name: 'Your fonts', exact: true }).click();
  await expect(page.getByText('Your library is empty.', { exact: false })).toBeVisible();
});

test('going offline cancels an active download and releases activity without saving a partial font', async ({ page, context }) => {
  await page.route('https://www.googleapis.com/webfonts/v1/webfonts**', async (route) => { await route.fulfill({ json: sampleCatalog }); });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route('https://fonts.gstatic.com/test/**', async (route) => { started(); await gate; await route.abort(); });
  try {
    await setup(page);
    await page.getByRole('tab', { name: 'Google Fonts', exact: true }).click();
    await page.getByLabel('Google Fonts API key').fill('test-key');
    await page.getByRole('button', { name: 'Save key and browse' }).click();
    await page.getByRole('button', { name: 'Download Catalog Sans', exact: true }).click();
    await requested;
    const activity = () => page.evaluate(async () => {
      const path = '/src/editor/activity.ts'; const { editorActivity } = await import(path) as typeof import('../src/editor/activity');
      return editorActivity.getSnapshot();
    });
    expect(await activity()).toBe(1);
    await context.setOffline(true);
    await expect(page.getByRole('tab', { name: 'Google Fonts', exact: true })).toBeDisabled();
    await expect(page.getByText('Connect to the internet to browse Google Fonts.', { exact: false })).toBeVisible();
    await expect.poll(activity).toBe(0);
    await expect(page.getByText('Your library is empty.', { exact: false })).toBeVisible();
    expect((await layer(page)).fontFamily).toBe('Inter');
  } finally { release(); }
});
