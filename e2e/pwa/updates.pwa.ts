import { expect, test, type Page } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function install(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Your projects')).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function deploy(page: Page) {
  await page.request.post('/__pwa/version');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
}
async function createProject(page: Page, name: string) {
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await expect(page.getByTitle('Projects')).toBeVisible();
}

test('reopens the lazy editor offline and preserves edits through a prompted update', async ({ page, context }, testInfo) => {
  await install(page);
  await createProject(page, 'Offline project');
  await page.getByTitle('Projects').click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Offline project/ }).click();
  await expect(page.getByTitle('Zoom out')).toBeVisible();
  await context.setOffline(false);
  await deploy(page);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Offline project');
  await page.getByLabel('Project name').fill('Saved through update');
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('update-prompt.png') });
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect(page.getByRole('button', { name: /Saved through update/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
});

test('waits for an active import and export before offering reload', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { pauseImport: true, pauseExport: false, held: [] as (() => void)[] };
    Object.assign(window, { workerGate: state });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) {
      const message = args[0] as { type?: string };
      if ((state.pauseImport && message.type === undefined) || (state.pauseExport && message.type === 'start')) state.held.push(() => original.apply(this, args));
      else original.apply(this, args);
    };
  });
  await install(page);
  await createProject(page, 'Busy project');
  await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng });
  await expect.poll(() => page.evaluate(() => (window as unknown as { workerGate: { held: unknown[] } }).workerGate.held.length)).toBe(1);
  await deploy(page);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
  await page.evaluate(() => {
    const gate = (window as unknown as { workerGate: { pauseImport: boolean; pauseExport: boolean; held: (() => void)[] } }).workerGate;
    gate.pauseImport = false;
    gate.pauseExport = true;
    gate.held.splice(0).forEach((resume) => resume());
  });
  await expect(page.getByAltText('tiny.png')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await page.getByRole('button', { name: 'Slide PNG' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { workerGate: { held: unknown[] } }).workerGate.held.length)).toBe(1);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.evaluate(() => {
    const gate = (window as unknown as { workerGate: { pauseExport: boolean; held: (() => void)[] } }).workerGate;
    gate.pauseExport = false;
    gate.held.splice(0).forEach((resume) => resume());
  });
  expect((await download).suggestedFilename()).toMatch(/_01\.png$/);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
});

test('a failed save blocks activation until the existing save retry succeeds', async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === 'open-scrl' && args[1] === 'readwrite' && (window as unknown as { failProjectSave?: boolean }).failProjectSave) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await install(page);
  await createProject(page, 'Recovery project');
  await page.evaluate(() => Object.assign(window, { failProjectSave: true }));
  await page.getByLabel('Project name').fill('Recovered update');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await deploy(page);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
  await expect(page.getByLabel('Project name')).toHaveValue('Recovered update');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
  await page.evaluate(() => Object.assign(window, { failProjectSave: false }));
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect(page.getByRole('button', { name: /Recovered update/ })).toBeVisible();
});

test('another tab activating an update does not reload a busy tab or accept for its user', async ({ page, context }) => {
  await page.addInitScript(() => {
    const gate = { held: [] as (() => void)[] };
    Object.assign(window, { importGate: gate });
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) { gate.held.push(() => original.apply(this, args)); };
  });
  await install(page);
  await createProject(page, 'Other tab project');
  await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng });
  const other = await context.newPage();
  await other.goto('/');
  await deploy(other);
  await expect(other.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await other.getByRole('button', { name: 'Reload to update' }).click();
  await expect(other.getByText('Your projects')).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Other tab project');
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { importGate: { held: (() => void)[] } }).importGate.held.splice(0).forEach((resume) => resume()));
  await expect(page.getByAltText('tiny.png')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('Other tab project');
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect(page.getByRole('button', { name: /Other tab project/ })).toBeVisible();
});

test('caches optional export tools with query strings for later offline use', async ({ page, context }) => {
  await page.addInitScript(() => {
    const OriginalWorker = Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const workerUrl = new URL(url.toString(), location.href);
        if (workerUrl.pathname.includes('export.worker-')) workerUrl.searchParams.set('cache-check', '1');
        super(workerUrl, options);
      }
    };
  });
  await install(page);
  await createProject(page, 'Cached tools');
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Carousel' }).click();
  expect((await firstDownload).suggestedFilename()).toMatch(/_instagram\.zip$/);
  const cached = await page.evaluate(async () => (await (await caches.open('optional-editor-tools')).keys()).map((request) => request.url));
  expect(cached.some((url) => /export\.worker-.*\?cache-check=1$/.test(url))).toBe(true);
  expect(cached.some((url) => /\/zip-[^/]+\.js$/.test(url))).toBe(true);
  await page.getByTitle('Projects').click();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Cached tools/ }).click();
  const offlineDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Carousel' }).click();
  expect((await offlineDownload).suggestedFilename()).toMatch(/_instagram\.zip$/);
});
