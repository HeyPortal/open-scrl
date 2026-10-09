import { expect, test } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('a failed project-library load can be retried without reloading the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = IDBFactory.prototype.open;
    Object.assign(window, { failProjectOpen: true });
    IDBFactory.prototype.open = function (...args) {
      if (args[0] === 'open-scrl' && (window as unknown as { failProjectOpen: boolean }).failProjectOpen) throw new DOMException('Storage temporarily unavailable', 'SecurityError');
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('projects could not be loaded');
  await page.evaluate(() => Object.assign(window, { failProjectOpen: false }));
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByText('Your projects')).toBeVisible();
  expect(errors).toEqual([]);
});

test('failed autosave keeps edits available and retry persists them', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'open-scrl' && args[1] === 'readwrite' && (window as unknown as { failProjectSave?: boolean }).failProjectSave) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await expect(page.getByTitle('Projects')).toBeVisible();
  await page.evaluate(() => Object.assign(window, { failProjectSave: true }));
  await page.locator('input.input').first().fill('Recovered changes');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('autosave-retry.png') });
  await page.getByTitle('Projects').click();
  await expect(page.locator('input.input').first()).toHaveValue('Recovered changes');
  await page.evaluate(() => Object.assign(window, { failProjectSave: false }));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('button', { name: 'Retry saving' })).toHaveCount(0);
  await page.getByTitle('Projects').click();
  await expect(page.getByRole('button', { name: /Recovered changes/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Recovered changes/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('two tabs importing the same file keep one original and both project links', async ({ page, context }) => {
  const other = await context.newPage();
  const errors: string[] = [];
  for (const tab of [page, other]) tab.on('pageerror', (error) => errors.push(error.message));
  await Promise.all([page.goto('/'), other.goto('/')]);
  await Promise.all([page, other].map(async (tab, index) => {
    await tab.getByLabel('Project name').fill(`Tab ${index}`);
    await tab.getByRole('button', { name: /create|start/i }).first().click();
    await expect(tab.getByTitle('Projects')).toBeVisible();
  }));
  await Promise.all([page, other].map((tab) => tab.getByLabel('Import media files').setInputFiles({ name: 'same.png', mimeType: 'image/png', buffer: tinyPng })));
  for (const tab of [page, other]) await expect(tab.getByText('Imported 1 media file.')).toBeVisible();
  const metadata = await page.evaluate(async () => {
    const path = '/src/assets/indexeddb/IndexedDbAssetRepository.ts';
    const { assetRepository } = await import(path);
    return assetRepository.listMetadata();
  });
  expect(metadata).toHaveLength(1);
  await page.evaluate(async (assetId: string) => {
    const repositoryPath = '/src/assets/indexeddb/IndexedDbAssetRepository.ts';
    const storePath = '/src/editor/documentStore.ts';
    const { assetRepository } = await import(repositoryPath);
    const { useDocumentStore } = await import(storePath);
    return assetRepository.remove(assetId, useDocumentStore.getState().activeProjectId);
  }, metadata[0].id);
  expect(await other.evaluate(async (assetId: string) => {
    const repositoryPath = '/src/assets/indexeddb/IndexedDbAssetRepository.ts';
    const storePath = '/src/editor/documentStore.ts';
    const { assetRepository } = await import(repositoryPath);
    const { useDocumentStore } = await import(storePath);
    return { linked: await assetRepository.isLinkedToProject(useDocumentStore.getState().activeProjectId, assetId), size: (await assetRepository.readOriginal(assetId))?.size };
  }, metadata[0].id)).toEqual({ linked: true, size: tinyPng.length });
  expect(errors).toEqual([]);
});

test('a failed media-library load can be retried inside the editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = IDBIndex.prototype.getAll;
    IDBIndex.prototype.getAll = function (...args) {
      if (this.objectStore.name === 'projectAssets' && (window as unknown as { failMediaLoad?: boolean }).failMediaLoad) throw new Error('Temporary media read failure');
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Your projects')).toBeVisible();
  await page.evaluate(() => Object.assign(window, { failMediaLoad: true }));
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await expect(page.getByRole('button', { name: 'Retry media' })).toBeVisible();
  await page.evaluate(() => Object.assign(window, { failMediaLoad: false }));
  await page.getByRole('button', { name: 'Retry media' }).click();
  await expect(page.getByText('No media yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry media' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
