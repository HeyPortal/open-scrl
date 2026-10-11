import { readFile } from 'node:fs/promises';
import { expect, test } from '../fixtures/test';

test('restores imported fonts and exports identical pixels after an offline PWA reload', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByLabel('Project name').fill('Offline font project');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Add text box' }).click();
  await page.getByRole('button', { name: 'Manage fonts' }).click();
  await page.getByLabel('Choose font file').setInputFiles({ name: 'Brand-Serif.woff2', mimeType: 'font/woff2', buffer: await readFile('node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2') });
  await page.getByLabel('Font name', { exact: true }).fill('Offline Brand Serif');
  await page.getByRole('button', { name: 'Import and use font' }).click();
  await expect(page.getByText('Offline Brand Serif is ready to use offline.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Fonts', exact: true }).click();
  const family = await page.getByRole('combobox', { name: 'Font', exact: true }).inputValue();
  const onlineDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Slide PNG', exact: true }).click();
  const online = await onlineDownload;
  expect(await online.failure()).toBeNull();
  const original = await readFile((await online.path())!);
  // The optional export worker is cached after its first online use.
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('optional-editor-tools');
    return (await cache.keys()).some((request) => request.url.includes('export.worker-'));
  })).toBe(true);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Offline font project', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Open Offline font project', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toBeVisible();
  expect(await page.evaluate((value) => [...document.fonts].some((face) => face.family === value && face.status === 'loaded'), family)).toBe(true);
  const offlineDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Slide PNG', exact: true }).click();
  const offline = await offlineDownload;
  expect(await offline.failure()).toBeNull();
  expect(await readFile((await offline.path())!)).toEqual(original);
});
