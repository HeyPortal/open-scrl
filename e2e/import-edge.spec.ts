import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { ProjectDocumentV2 } from '../src/types';

async function createProject(page: Page, name: string) {
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: /create.*open editor/i }).click();
  await expect(page.getByTitle('Projects', { exact: true })).toBeVisible();
}

async function documentState(page: Page): Promise<ProjectDocumentV2> {
  return page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    return useDocumentStore.getState().doc;
  });
}

async function activityCount(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/activity.ts';
    const { editorActivity } = await import(path) as typeof import('../src/editor/activity');
    return editorActivity.getSnapshot();
  });
}

async function png(page: Page, name: string, color: string, width = 40, height = 30) {
  const data = await page.evaluate(({ fill, width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.fillStyle = fill;
    canvas.getContext('2d')!.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { fill: color, width, height });
  return { name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

test('images import, deduplicate and reopen on a plain HTTP network origin', async ({ page, context, baseURL }) => {
  // Route a non-loopback hostname to the test server without changing its
  // browser security context or requiring a machine-specific LAN address.
  const previewOrigin = 'http://scrl-preview.test';
  await context.route(`${previewOrigin}/**`, async (route) => {
    const upstream = new URL(route.request().url());
    upstream.host = new URL(baseURL!).host;
    await route.fulfill({ response: await route.fetch({ url: upstream.href }) });
  });
  await page.goto(previewOrigin);
  expect(await page.evaluate(() => ({ secure: isSecureContext, hashing: typeof crypto.subtle }))).toEqual({ secure: false, hashing: 'undefined' });
  await createProject(page, 'Network import');
  const file = await png(page, 'network.png', '#22c55e');
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByAltText('network.png')).toBeVisible();
  await expect(page.getByText('Imported 1 media file.', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByAltText('network.png')).toHaveCount(1);
  await expect(page.getByText('1 duplicate file was already imported.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open Network import', exact: true }).click();
  await expect(page.getByAltText('network.png')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const path = '/src/assets/indexeddb/IndexedDbAssetRepository.ts';
    const { assetRepository } = await import(path);
    const metadata = await assetRepository.listMetadata();
    return { count: metadata.length, hash: metadata[0].hash, size: (await assetRepository.readOriginal(metadata[0].id))?.size };
  });
  expect(stored).toEqual({ count: 1, hash: createHash('sha256').update(file.buffer).digest('hex'), size: file.buffer.length });
});

test('a pending import as slides stays associated with its original project after switching', async ({ page }) => {
  await page.addInitScript(() => {
    const gate = { held: [] as (() => void)[] };
    Object.assign(window, { importGate: gate });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) {
      const message = args[0] as { type?: string; file?: File };
      if (message.file && message.type === undefined) gate.held.push(() => original.apply(this, args));
      else original.apply(this, args);
    };
  });
  await page.goto('/');
  await createProject(page, 'Import source');
  const source = await documentState(page);
  const file = await png(page, 'source.png', '#ef4444');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import as new slides', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect.poll(() => activityCount(page)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { importGate: { held: unknown[] } }).importGate.held.length)).toBe(1);

  await page.getByTitle('Projects', { exact: true }).click();
  await createProject(page, 'Import destination');
  const destination = await documentState(page);
  await page.evaluate(() => (window as unknown as { importGate: { held: (() => void)[] } }).importGate.held.splice(0).forEach((resume) => resume()));
  await expect.poll(() => activityCount(page)).toBe(0);
  // The caller places returned files in a continuation after the activity release.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await documentState(page)).toEqual(destination);
  await expect(page.getByAltText('source.png')).toHaveCount(0);
  await expect(page.getByText(/Created .*slides? from/)).toHaveCount(0);

  await page.getByTitle('Projects', { exact: true }).click();
  await page.getByRole('button', { name: /Import source/ }).click();
  await expect(page.getByAltText('source.png')).toBeVisible();
  const reopened = await documentState(page);
  expect(reopened.id).toBe(source.id);
  expect(reopened.layers).toEqual(source.layers);
  expect(reopened.slideOrder).toEqual(source.slideOrder);
  await expect.poll(() => activityCount(page)).toBe(0);
});

test('a malformed image does not strand its batch or later imports', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Import recovery');
  const valid = await png(page, 'valid.png', '#22c55e');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    valid,
  ]);
  await expect(page.getByAltText('valid.png')).toBeVisible();
  await expect(page.getByAltText('broken.png')).toHaveCount(0);
  await expect(page.getByText(/Imported 1 media file.*Couldn't decode broken.png/)).toBeVisible();
  await expect.poll(() => activityCount(page)).toBe(0);
  await page.locator('input[type=file]').setInputFiles(await png(page, 'later.png', '#3b82f6'));
  await expect(page.getByAltText('later.png')).toBeVisible();
  await expect(page.getByAltText('valid.png')).toBeVisible();
  await expect.poll(() => activityCount(page)).toBe(0);
});

test('a panorama import action cannot add slides to a different project', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Panorama source');
  await page.locator('input[type=file]').setInputFiles(await png(page, 'panorama.png', '#f97316', 180, 30));
  const action = page.getByRole('button', { name: /Spread across \d+ slides/ });
  await expect(action).toBeVisible();
  await page.getByTitle('Projects', { exact: true }).click();
  await createProject(page, 'Panorama destination');
  const destination = await documentState(page);
  await action.click();
  expect(await documentState(page)).toEqual(destination);
  await expect(page.getByText(/Spread across .* Drag it/)).toHaveCount(0);
  await expect.poll(() => activityCount(page)).toBe(0);
});
