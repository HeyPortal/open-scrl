import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocumentV2 } from '../../src/types';

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

async function delayActivation(page: Page) {
  await page.evaluate(() => {
    const gate = { held: [] as (() => void)[], observed: false, pause: true };
    Object.assign(window, { activationGate: gate });
    const original = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (...args: Parameters<ServiceWorker['postMessage']>) {
      if (gate.pause && (args[0] as { type?: string }).type === 'SKIP_WAITING') gate.held.push(() => original.apply(this, args));
      else original.apply(this, args);
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => { gate.observed = true; });
  });
  await deploy(page);
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { activationGate: { held: unknown[] } }).activationGate.held.length)).toBe(1);
}

async function resumeActivation(page: Page) {
  await page.evaluate(() => {
    const gate = (window as unknown as { activationGate: { held: (() => void)[]; pause: boolean } }).activationGate;
    gate.pause = false;
    gate.held.splice(0).forEach((resume) => resume());
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { activationGate?: { observed: boolean } }).activationGate?.observed)).toBe(true);
}

async function canvasPoint(page: Page, anchor = false) {
  return page.evaluate((useAnchor) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const node = useAnchor ? stage.findOne('.bottom-right')! : stage.find('Group').find((item) => item.id())!;
    const bounds = node.getClientRect(), container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
  }, anchor);
}

async function savedLayer(page: Page, name: string) {
  return page.evaluate(async (projectName) => {
    const open = indexedDB.open('open-scrl', 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const request = db.transaction('projects').objectStore('projects').getAll();
      const projects = await new Promise<ProjectDocumentV2[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const project = projects.find((item) => item.name === projectName);
      return project ? Object.values(project.layers)[0] : null;
    } finally { db.close(); }
  }, name);
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

test('Later keeps the waiting update deferred through edits and a failed import', async ({ page }) => {
  await install(page);
  await createProject(page, 'Deferred update');
  await deploy(page);
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await page.getByLabel('Project name').fill('Deferred edits');
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByText(/Couldn't decode/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload to update' })).toHaveCount(0);
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
  // The failed batch must release activity so a subsequent update can proceed.
  await deploy(page);
  await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect(page.getByRole('button', { name: /Deferred edits/ })).toBeVisible();
});

for (const gesture of ['drag', 'transform'] as const) {
  test(`activation waits for a ${gesture} begun after accepting the update`, async ({ page }) => {
    const name = `${gesture} activation race`;
    await install(page);
    await createProject(page, name);
    await page.getByRole('button', { name: 'Add rectangle', exact: true }).click();
    await delayActivation(page);
    const before = await savedLayer(page, name);
    expect(before).not.toBeNull();
    const point = await canvasPoint(page, gesture === 'transform');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 73, point.y + 29, { steps: 10 });
    await resumeActivation(page);
    await expect(page.getByTitle('Projects')).toBeVisible();
    expect(await savedLayer(page, name)).toEqual(before);
    await page.mouse.up();
    await expect(page.getByText('Your projects')).toBeVisible();
    const after = await savedLayer(page, name);
    expect(after).not.toBeNull();
    if (gesture === 'drag') expect(after!.x).not.toBe(before!.x);
    else expect(after!.width).toBeGreaterThan(before!.width);
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByTitle('Zoom out')).toBeVisible();
  });
}

test('activation waits for a text draft and saves its blur commit before reloading', async ({ page }) => {
  const name = 'Text activation race';
  await install(page);
  await createProject(page, name);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await delayActivation(page);
  const point = await canvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  const draft = page.locator('textarea:not([aria-label])');
  await expect(draft).toBeVisible();
  await draft.fill('Saved after worker activation');
  await resumeActivation(page);
  await expect(draft).toHaveValue('Saved after worker activation');
  const before = await savedLayer(page, name);
  expect(before?.kind === 'text' && before.text).not.toBe('Saved after worker activation');
  await draft.evaluate((element) => element.blur());
  await expect(page.getByText('Your projects')).toBeVisible();
  const after = await savedLayer(page, name);
  expect(after?.kind === 'text' && after.text).toBe('Saved after worker activation');
});
