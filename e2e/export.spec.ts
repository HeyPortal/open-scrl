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
  await dialog.getByRole('radio', { name: 'Choose slides', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Export selected slides' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Slide 3', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Slide 1', exact: true }).check();
  await dialog.getByRole('radio', { name: 'JPEG', exact: true }).check();
  await dialog.getByRole('radio', { name: '2×', exact: true }).check();
  await dialog.getByRole('slider', { name: /JPEG quality/ }).fill('75');
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
  await expect(dialog.getByRole('radiogroup', { name: 'Animated slides' })).toBeVisible();
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
  await dialog.getByRole('radio', { name: 'This slide', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Still', exact: true }).check();
  await dialog.getByRole('radio', { name: '2×', exact: true }).check();
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
      await sheet.getByRole('radio', { name: 'This slide', exact: true }).tap();
      await sheet.getByRole('radio', { name: 'JPEG', exact: true }).tap();
      await sheet.getByRole('radio', { name: '2×', exact: true }).tap();
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
    test('lays the carousel out as a panorama and picks slides from it without changing the editor or document', async ({ page }) => {
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
      const tiles = surface.locator('.export-pano-slide');
      const pixels = () => surface.locator('.export-pano-slide canvas').evaluateAll((elements) => elements.map((element) => {
        const canvas = element as HTMLCanvasElement;
        return [...canvas.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      }));
      await expect(surface.getByRole('img', { name: 'Carousel preview, 3 of 3 slides included' })).toBeVisible();
      await expect.poll(pixels).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]]);
      // The slides sit edge to edge in one strip that fits the surface.
      const boxes = await tiles.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect));
      expect(boxes[1].left).toBeCloseTo(boxes[0].right, 0);
      expect(boxes[2].left).toBeCloseTo(boxes[1].right, 0);
      const stage = await surface.locator('.export-pano').evaluate((element) => [element.scrollWidth, element.clientWidth]);
      expect(stage[0]).toBeLessThanOrEqual(stage[1]);
      await surface.getByRole('radio', { name: 'This slide', exact: true }).click();
      await expect(tiles.nth(1)).toHaveAttribute('data-included', 'true');
      await expect(tiles.nth(0)).toHaveAttribute('data-included', 'false');
      await expect(tiles.nth(2)).toHaveAttribute('data-included', 'false');
      await surface.getByRole('radio', { name: 'Choose slides', exact: true }).click();
      await surface.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(surface.getByRole('button', { name: 'Export selected slides' })).toBeDisabled();
      await surface.getByRole('checkbox', { name: 'Slide 1', exact: true }).check();
      await surface.getByRole('checkbox', { name: 'Slide 3', exact: true }).check();
      await expect(tiles.nth(0)).toHaveAttribute('data-included', 'true');
      await expect(tiles.nth(1)).toHaveAttribute('data-included', 'false');
      await expect(surface.getByText('2 of 3 slides', { exact: false })).toBeVisible();
      await expect(surface.getByText('2 numbered files in a ZIP')).toBeVisible();
      const after = await page.evaluate(async () => {
        const path = '/src/editor/documentStore.ts';
        const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
        return { doc: JSON.stringify(useDocumentStore.getState().doc), selected: useDocumentStore.getState().selectedSlideId };
      });
      expect(after).toEqual(original);
    });
  });
}
