import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}
async function imageInfo(page: Page, data: Uint8Array) {
  return page.evaluate(async (values) => {
    const blob = new Blob([new Uint8Array(values)]);
    const bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }, [...data]);
}
async function create(page: Page, mobile = false) {
  await page.goto('/');
  await page.getByRole('button', { name: mobile ? 'Create carousel' : 'Create & open editor', exact: true }).click();
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Export Carousel', exact: true }).click();
  return page.getByRole('dialog', { name: 'Export', exact: true });
}

test('selected JPEG exports preserve numbering, dimensions, file naming and the document', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Add slide', exact: true }).click();
  await page.getByRole('button', { name: 'Add slide', exact: true }).click();
  const original = await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    return JSON.stringify((await import(path) as typeof import('../src/editor/documentStore')).useDocumentStore.getState().doc);
  });
  const dialog = await open(page);
  await dialog.getByText('Choose slides', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Export selected slides' })).toBeDisabled();
  await dialog.getByLabel('Slide 3', { exact: true }).check();
  await dialog.getByLabel('Slide 1', { exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Image format', exact: true }).selectOption('jpeg');
  await dialog.getByRole('combobox', { name: 'Image resolution', exact: true }).selectOption('2');
  await dialog.getByRole('slider', { name: /JPEG quality/ }).fill('75');
  await dialog.locator('summary').click();
  await dialog.getByLabel('Export file name', { exact: true }).fill('Vacation / final');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export selected slides' }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe('Vacation_final_instagram.zip');
  const reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(await bytes(result))])));
  try {
    const entries = await reader.getEntries();
    expect(entries.map((entry) => entry.filename)).toEqual(['01.jpg', '03.jpg']);
    for (const entry of entries) {
      if (!entry.getData) throw new Error('Expected a file');
      const blob = await entry.getData(new BlobWriter());
      const data = new Uint8Array(await blob.arrayBuffer());
      expect([...data.slice(0, 2)]).toEqual([0xff, 0xd8]);
      expect(await imageInfo(page, data)).toEqual({ width: 2160, height: 2700 });
    }
  } finally { await reader.close(); }
  await expect(dialog.getByText('Your download is ready.', { exact: true })).toBeVisible();
  const after = await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    return JSON.stringify((await import(path) as typeof import('../src/editor/documentStore')).useDocumentStore.getState().doc);
  });
  expect(after).toBe(original);
});

test('export dialog traps keyboard focus, opens through its shortcut and restores focus', async ({ page }) => {
  await create(page);
  const button = page.getByRole('button', { name: 'Export Carousel', exact: true });
  const dialog = await open(page);
  const close = dialog.getByRole('button', { name: 'Close Export' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Preview on phone' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press('Control+Shift+e');
  await expect(dialog).toBeVisible();
});

test('cancelling a stalled worker prevents downloads and lets the next export succeed', async ({ page }) => {
  await create(page);
  await page.evaluate(() => {
    const Original = Worker;
    const gate = { blocked: true, terminated: 0 };
    Object.assign(window, { exportGate: gate });
    window.Worker = class extends Original {
      private exporting: boolean;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.exporting = url.toString().includes('export.worker');
      }
      postMessage(message: unknown, transfer: Transferable[]) {
        if (!this.exporting || !gate.blocked) super.postMessage(message, transfer ?? []);
      }
      terminate() { if (this.exporting) gate.terminated++; super.terminate(); }
    };
  });
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Export carousel', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(/Slide 1\/1/);
  await dialog.getByRole('button', { name: 'Cancel export' }).click();
  await expect(dialog.getByText(/Export cancelled/)).toBeVisible();
  expect(downloads).toHaveLength(0);
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/editor/activity.ts';
    return (await import(path) as typeof import('../src/editor/activity')).editorActivity.getSnapshot();
  })).toBe(0);
  expect(await page.evaluate(() => {
    const gate = (window as unknown as { exportGate: { blocked: boolean; terminated: number } }).exportGate;
    gate.blocked = false;
    return gate.terminated;
  })).toBe(1);
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export carousel', exact: true }).click();
  await bytes(await download);
  await expect(dialog.getByText('Your download is ready.', { exact: true })).toBeVisible();
});

test('animated slides can export still images and video cancellation releases its activity', async ({ page }) => {
  await create(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'tiny.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
  await page.getByAltText('tiny.gif').click();
  const dialog = await open(page);
  await expect(dialog.getByLabel('Animated slides')).toBeVisible();
  await dialog.getByRole('button', { name: 'Export carousel', exact: true }).click();
  // Chromium builds without H.264 must report the real limitation and allow
  // a still-image retry. On builds with encoding, exercise cancellation.
  await expect(dialog.getByRole('status').filter({ hasText: /Slide 1\/1 · \d+%/ }).or(dialog.getByRole('alert').filter({ hasText: /WebCodecs support|cannot encode an Instagram-compatible/ }))).toBeVisible();
  if (await dialog.getByRole('button', { name: 'Cancel export' }).isVisible()) {
    await dialog.getByRole('button', { name: 'Cancel export' }).click();
    await expect(dialog.getByText(/Export cancelled/)).toBeVisible();
  }
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/editor/activity.ts';
    return (await import(path) as typeof import('../src/editor/activity')).editorActivity.getSnapshot();
  })).toBe(0);
  await dialog.getByText('This slide', { exact: true }).click();
  await dialog.getByLabel('Animated slides').selectOption('still');
  await dialog.getByLabel('Image resolution').selectOption('2');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save this slide' }).click();
  const result = await download;
  expect(result.suggestedFilename()).toMatch(/_01\.png$/);
  expect(await imageInfo(page, await bytes(result))).toEqual({ width: 2160, height: 2700 });
});

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test.describe(`phone export at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    test('keeps the action visible and saves the current slide as JPEG', async ({ page }) => {
      await create(page, true);
      await page.getByRole('button', { name: 'Export', exact: true }).tap();
      const sheet = page.getByRole('region', { name: 'Export', exact: true });
      await sheet.getByText('This slide', { exact: true }).tap();
      await sheet.getByRole('combobox', { name: 'Image format', exact: true }).selectOption('jpeg');
      await sheet.getByRole('combobox', { name: 'Image resolution', exact: true }).selectOption('2');
      const button = sheet.getByRole('button', { name: 'Save this slide' });
      await expect(button).toBeInViewport();
      const bounds = await button.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      const download = page.waitForEvent('download');
      await button.tap();
      const result = await download;
      expect(result.suggestedFilename()).toMatch(/_01\.jpg$/);
      expect(await imageInfo(page, await bytes(result))).toEqual({ width: 2160, height: 2700 });
    });
  });
}

for (const mobile of [false, true]) {
  test.describe(`${mobile ? 'phone' : 'desktop'} export preview`, () => {
    test.use(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
    test('renders selected slides and browses without changing the editor or document', async ({ page }) => {
      await create(page, mobile);
      const original = await page.evaluate(async () => {
        const path = '/src/editor/documentStore.ts';
        const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
        const store = () => useDocumentStore.getState();
        store().setBackground({ kind: 'solid', color: '#ff0000' });
        store().addSlide();
        store().setBackground({ kind: 'solid', color: '#0000ff' });
        store().addSlide();
        store().setBackground({ kind: 'solid', color: '#00ff00' });
        store().selectSlide(store().doc.slideOrder[1]);
        return { doc: JSON.stringify(store().doc), selected: store().selectedSlideId };
      });
      if (mobile) await page.getByRole('button', { name: 'Export', exact: true }).tap();
      else await open(page);
      const surface = mobile ? page.getByRole('region', { name: 'Export', exact: true }) : page.getByRole('dialog', { name: 'Export', exact: true });
      const preview = surface.locator('.export-slide-artwork canvas');
      const pixel = () => preview.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return [...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      });
      await expect(surface.getByRole('img', { name: 'Slide 2 preview' })).toBeVisible();
      await expect.poll(pixel).toEqual([0, 0, 255, 255]);
      await surface.getByRole('button', { name: 'Next slide preview' }).click();
      await expect(surface.getByRole('img', { name: 'Slide 3 preview' })).toBeVisible();
      await expect.poll(pixel).toEqual([0, 255, 0, 255]);
      await expect(surface.getByRole('button', { name: 'Next slide preview' })).toBeDisabled();
      await surface.getByText('Choose slides', { exact: true }).click();
      await surface.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(preview).toHaveCount(0);
      await surface.getByLabel('Slide 1', { exact: true }).check();
      await surface.getByLabel('Slide 3', { exact: true }).check();
      await surface.getByRole('button', { name: 'Previous slide preview' }).click();
      await expect.poll(pixel).toEqual([255, 0, 0, 255]);
      await surface.getByText('This slide', { exact: true }).click();
      await expect(surface.getByRole('img', { name: 'Slide 2 preview' })).toBeVisible();
      await expect.poll(pixel).toEqual([0, 0, 255, 255]);
      await expect(surface.getByRole('button', { name: 'Next slide preview' })).toHaveCount(0);
      const after = await page.evaluate(async () => {
        const path = '/src/editor/documentStore.ts';
        const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
        return { doc: JSON.stringify(useDocumentStore.getState().doc), selected: useDocumentStore.getState().selectedSlideId };
      });
      expect(after).toEqual(original);
    });
  });
}
