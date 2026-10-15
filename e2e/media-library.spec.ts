import { expect, test, type Page } from './fixtures/test';

const MEDIA_NAME = /^IMG_\d+\.(png|jpg)$/;
const IMPORT_ORDER = ['IMG_10.png', 'IMG_2.png', 'IMG_1.png', 'IMG_11.jpg'];

async function files(page: Page, squareOnly = false) {
  return page.evaluate((onlySquares) => {
    const images = [
      { name: 'IMG_10.png', width: 400, height: 300, color: '#a67658', type: 'image/png' },
      { name: 'IMG_2.png', width: 300, height: 450, color: '#667a69', type: 'image/png' },
      { name: 'IMG_1.png', width: 400, height: 400, color: '#728096', type: 'image/png' },
      { name: 'IMG_11.jpg', width: 500, height: 500, color: '#b49c73', type: 'image/jpeg' },
    ];
    return images.filter((image) => !onlySquares || image.width === image.height).map((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = image.color; context.fillRect(0, 0, image.width, image.height);
      return { name: image.name, mimeType: image.type, data: canvas.toDataURL(image.type).split(',')[1] };
    });
  }, squareOnly);
}

async function importMedia(page: Page, squareOnly = false) {
  const media = await files(page, squareOnly);
  await page.locator('input[type=file]').setInputFiles(media.map(({ name, mimeType, data }) => ({ name, mimeType, buffer: Buffer.from(data, 'base64') })));
  for (const image of media) await expect(page.getByAltText(image.name, { exact: true })).toBeVisible();
}

async function createCarousel(page: Page, mobile = false, squareOnly = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  if (mobile) await page.getByRole('tab', { name: 'Photos', exact: true }).tap();
  await importMedia(page, squareOnly);
}

async function libraryNames(page: Page) {
  return page.getByRole('button', { name: MEDIA_NAME }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')));
}

async function editingState(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const state = useDocumentStore.getState();
    return { doc: state.doc, past: state.past.length, future: state.future.length };
  });
}

test('media sorting is natural, groups formats, and leaves document history untouched', async ({ page }) => {
  await createCarousel(page);
  const before = await editingState(page);
  const sort = page.getByRole('combobox', { name: 'Sort media' });
  await expect(sort).toHaveValue('none');
  await expect.poll(() => libraryNames(page)).toEqual(IMPORT_ORDER);

  await sort.selectOption({ label: 'Filename A→Z' });
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_2.png', 'IMG_10.png', 'IMG_11.jpg']);
  await sort.selectOption({ label: 'Filename Z→A' });
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_11.jpg', 'IMG_10.png', 'IMG_2.png', 'IMG_1.png']);
  await sort.selectOption({ label: 'File type' });
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_11.jpg', 'IMG_1.png', 'IMG_2.png', 'IMG_10.png']);
  await sort.selectOption({ label: 'None (import order)' });
  await expect.poll(() => libraryNames(page)).toEqual(IMPORT_ORDER);
  expect(await editingState(page)).toEqual(before);
});

test('shape filters combine with sorting, survive panel remounts, and reset on reload', async ({ page }, testInfo) => {
  await createCarousel(page);
  const before = await editingState(page);
  const sort = page.getByRole('combobox', { name: 'Sort media' });
  await sort.selectOption({ label: 'Filename A→Z' });
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_11.jpg']);
  await page.getByRole('button', { name: 'Vertical', exact: true }).click();
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_2.png', 'IMG_11.jpg']);

  const tools = page.getByRole('navigation', { name: 'Tools', exact: true });
  await tools.getByRole('button', { name: 'Text', exact: true }).click();
  await tools.getByRole('button', { name: 'Media', exact: true }).click();
  await expect(sort).toHaveValue('name-asc');
  await expect(page.getByRole('button', { name: 'Square', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Vertical', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_2.png', 'IMG_11.jpg']);
  expect(await editingState(page)).toEqual(before);
  await page.getByRole('complementary', { name: 'Media panel' }).screenshot({ path: testInfo.outputPath('media-library-desktop.png') });

  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(sort).toHaveValue('name-asc');
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_2.png', 'IMG_10.png', 'IMG_11.jpg']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Untitled/ }).click();
  await expect(sort).toHaveValue('none');
  await expect(page.getByRole('button', { name: 'Square', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => libraryNames(page)).toEqual(IMPORT_ORDER);
});

test('empty filters can be cleared and do not discard newly imported media', async ({ page }) => {
  await createCarousel(page, false, true);
  const before = await editingState(page);
  await page.getByRole('button', { name: 'Horizontal', exact: true }).click();
  await expect(page.getByText('No media matches these filters.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toBeVisible();
  const portrait = (await files(page)).find((image) => image.name === 'IMG_2.png')!;
  await page.locator('input[type=file]').setInputFiles({ name: portrait.name, mimeType: portrait.mimeType, buffer: Buffer.from(portrait.data, 'base64') });
  await expect(page.getByText('1 imported item is hidden by the media filter.')).toBeVisible();
  await expect(page.getByText('No media matches these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByAltText('IMG_2.png', { exact: true })).toBeVisible();
  await expect.poll(() => libraryNames(page)).toEqual(['IMG_1.png', 'IMG_11.jpg', 'IMG_2.png']);
  expect(await editingState(page)).toEqual(before);
});

test.describe('phone media library', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('sort and filter controls stay usable across sheet reopening and narrow screens', async ({ page }, testInfo) => {
    await createCarousel(page, true);
    const before = await editingState(page);
    const sort = page.getByRole('combobox', { name: 'Sort media' });
    await sort.selectOption({ label: 'Filename Z→A' });
    await page.getByRole('button', { name: 'Square', exact: true }).tap();
    await page.getByRole('button', { name: 'Vertical', exact: true }).tap();
    await expect.poll(() => libraryNames(page)).toEqual(['IMG_11.jpg', 'IMG_2.png', 'IMG_1.png']);
    await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();
    await page.getByRole('tab', { name: 'Photos', exact: true }).tap();
    await expect(sort).toHaveValue('name-desc');
    await expect(page.getByRole('button', { name: 'Square', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Expand Photos', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Photos', exact: true })).toHaveAttribute('data-detent', 'full');
    await expect(page.getByAltText('IMG_11.jpg', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('media-library-mobile.png') });

    for (const width of [393, 320]) {
      await page.setViewportSize({ width, height: 852 });
      for (const control of [sort, ...['Square', 'Vertical', 'Horizontal'].map((name) => page.getByRole('button', { name, exact: true }))]) {
        await expect.poll(async () => {
          const box = await control.boundingBox();
          return Boolean(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= width);
        }).toBe(true);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Clear filters', exact: true }).tap();
    await expect.poll(() => libraryNames(page)).toEqual(['IMG_11.jpg', 'IMG_10.png', 'IMG_2.png', 'IMG_1.png']);
    expect(await editingState(page)).toEqual(before);
  });
});
