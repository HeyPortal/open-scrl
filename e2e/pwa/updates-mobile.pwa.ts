import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocumentV2 } from '../../src/types';

// The touch editor runs its own gestures and text editor. An accepted update must wait for them
// exactly as it waits for the desktop canvas: no reload while a finger is down or a draft is open.

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const dock = (page: Page) => page.getByRole('tablist', { name: 'Editor tools' });

async function install(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function deploy(page: Page) {
  await page.request.post('/__pwa/version');
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
}

async function createCarousel(page: Page) {
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(dock(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: unknown[] } }).Konva?.stages.length)).toBe(1);
}

/** Holds the service worker's SKIP_WAITING message so activation can be released at a chosen moment. */
async function holdActivation(page: Page) {
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
}

async function delayActivation(page: Page) {
  await holdActivation(page);
  await deploy(page);
  await page.getByRole('button', { name: 'Reload to update' }).click();
  await expect.poll(() => heldActivations(page)).toBe(1);
}

const heldActivations = (page: Page) => page.evaluate(() => (window as unknown as { activationGate: { held: unknown[] } }).activationGate.held.length);

async function resumeActivation(page: Page) {
  await page.evaluate(() => {
    const gate = (window as unknown as { activationGate: { held: (() => void)[]; pause: boolean } }).activationGate;
    gate.pause = false;
    gate.held.splice(0).forEach((resume) => resume());
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { activationGate?: { observed: boolean } }).activationGate?.observed)).toBe(true);
}

async function layerCentre(page: Page) {
  return page.evaluate(() => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const bounds = stage.findOne('.layer')!.getClientRect();
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
  });
}

/** The first layer of the only saved project, read straight from IndexedDB. */
async function savedLayer(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open('open-scrl', 2);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const request = db.transaction('projects').objectStore('projects').getAll();
      const projects = await new Promise<ProjectDocumentV2[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return projects.length === 1 ? Object.values(projects[0].layers)[0] ?? null : null;
    } finally { db.close(); }
  });
}

test('activation waits for a two-finger layer transform begun after accepting the update', async ({ page }) => {
  await install(page);
  await createCarousel(page);
  await dock(page).getByRole('tab', { name: 'Shapes', exact: true }).tap();
  await page.getByRole('region', { name: 'Shapes', exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
  await expect.poll(() => savedLayer(page)).not.toBeNull();
  const before = await savedLayer(page);
  await delayActivation(page);

  const centre = await layerCentre(page);
  const fingers = (spread: number) => [{ x: centre.x - spread, y: centre.y, id: 1 }, { x: centre.x + spread, y: centre.y, id: 2 }];
  const cdp = await page.context().newCDPSession(page);
  const send = (type: string, touchPoints: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', fingers(14).slice(0, 1));
  await send('touchStart', fingers(14));
  for (let spread = 20; spread <= 48; spread += 7) await send('touchMove', fingers(spread));
  await resumeActivation(page);
  // The worker is active now, but the page stays open and the saved layer is untouched.
  await expect(dock(page).or(page.getByRole('toolbar', { name: 'Selection actions' }))).toBeVisible();
  expect(await savedLayer(page)).toEqual(before);

  await send('touchEnd', fingers(48).slice(0, 1));
  await send('touchEnd', []);
  await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
  const after = await savedLayer(page);
  expect(after!.width).toBeGreaterThan(before!.width);
  await cdp.detach();
});

test('activation waits for an inline text draft and saves it before reloading', async ({ page }) => {
  await install(page);
  await createCarousel(page);
  await dock(page).getByRole('tab', { name: 'Text', exact: true }).tap();
  await page.getByRole('button', { name: 'Add text box', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
  await expect.poll(() => savedLayer(page)).not.toBeNull();
  await delayActivation(page);

  const point = await layerCentre(page);
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  const draft = page.getByRole('textbox', { name: 'Edit text', exact: true });
  await expect(draft).toBeFocused();
  await page.keyboard.insertText('Saved after worker activation');
  await resumeActivation(page);
  await expect(draft).toHaveValue('Saved after worker activation');
  const before = await savedLayer(page);
  expect(before?.kind === 'text' && before.text).not.toBe('Saved after worker activation');

  await page.getByRole('button', { name: 'Done editing text', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
  const after = await savedLayer(page);
  expect(after?.kind === 'text' && after.text).toBe('Saved after worker activation');
});

/** Geometry of the update prompt, its message and its actions, in CSS pixels. */
async function promptLayout(page: Page) {
  const prompt = page.locator('[role="status"]').filter({ has: page.getByRole('button', { name: /updat/i }) });
  await expect(prompt).toHaveCount(1);
  return prompt.evaluate((element) => {
    const box = (target: Element) => { const { left, top, right, bottom, width, height } = target.getBoundingClientRect(); return { left, top, right, bottom, width, height }; };
    const dock = document.querySelector('[role="tablist"][aria-label="Editor tools"]');
    return {
      prompt: box(element),
      message: box(element.querySelector('span')!),
      buttons: [...element.querySelectorAll('button')].map((button) => ({ name: button.textContent ?? '', ...box(button) })),
      dockTop: dock ? dock.getBoundingClientRect().top : null,
      view: { width: window.innerWidth, height: window.innerHeight },
      overflow: { prompt: element.scrollWidth - element.clientWidth, document: document.documentElement.scrollWidth - window.innerWidth },
    };
  });
}

test.describe('update prompt layout at 320px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('is a readable full-width card above the dock with 44px actions', async ({ page }, testInfo) => {
    await install(page);
    await createCarousel(page);
    await holdActivation(page);
    await deploy(page);
    await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();
    await expect(dock(page)).toBeVisible();

    const ready = await promptLayout(page);
    const attach = async (name: string) => {
      const path = testInfo.outputPath(name);
      await page.screenshot({ path });
      await testInfo.attach(name, { path, contentType: 'image/png' });
    };
    await attach('update-prompt-320-ready.png');
    expect(ready.view.width).toBe(320);
    // Contained in the screen and clear of the tool dock.
    expect(ready.prompt.left).toBeGreaterThanOrEqual(0);
    expect(ready.prompt.right).toBeLessThanOrEqual(ready.view.width);
    expect(ready.prompt.top).toBeGreaterThanOrEqual(0);
    expect(ready.dockTop).not.toBeNull();
    expect(ready.prompt.bottom).toBeLessThanOrEqual(ready.dockTop!);
    expect(ready.overflow).toEqual({ prompt: 0, document: 0 });
    // The message is a real line of text, not a sliver beside the buttons.
    expect(ready.prompt.width).toBeGreaterThan(ready.view.width * 0.85);
    expect(ready.message.width).toBeGreaterThanOrEqual(240);
    expect(ready.message.height).toBeLessThanOrEqual(44);
    expect(ready.message.bottom).toBeLessThanOrEqual(Math.min(...ready.buttons.map((button) => button.top)));
    // Both actions are finger-sized and stay inside the card.
    expect(ready.buttons.map((button) => button.name)).toEqual(['Reload to update', 'Later']);
    for (const button of ready.buttons) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.left).toBeGreaterThanOrEqual(ready.prompt.left);
      expect(button.right).toBeLessThanOrEqual(ready.prompt.right);
      expect(button.bottom).toBeLessThanOrEqual(ready.prompt.bottom);
    }

    // The busy copy is longer and must wrap inside the same card.
    await page.getByRole('button', { name: 'Reload to update' }).click();
    await expect.poll(() => heldActivations(page)).toBe(1);
    await expect(page.getByRole('button', { name: 'Updating…' })).toBeVisible();
    const busy = await promptLayout(page);
    await attach('update-prompt-320-updating.png');
    expect(busy.prompt.left).toBeGreaterThanOrEqual(0);
    expect(busy.prompt.right).toBeLessThanOrEqual(busy.view.width);
    expect(busy.prompt.bottom).toBeLessThanOrEqual(busy.dockTop!);
    expect(busy.overflow).toEqual({ prompt: 0, document: 0 });
    expect(busy.message.width).toBeGreaterThanOrEqual(240);
    expect(busy.buttons.map((button) => button.name)).toEqual(['Updating…']);
    expect(busy.buttons[0].height).toBeGreaterThanOrEqual(44);
    expect(busy.buttons[0].right).toBeLessThanOrEqual(busy.prompt.right);
  });
});

test.describe('update prompt layout on desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test('stays a single compact row', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Your projects')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.getByLabel('Project name').fill('Desktop prompt');
    await page.getByRole('button', { name: /create|start/i }).first().click();
    await expect(page.getByTitle('Projects')).toBeVisible();
    await deploy(page);
    await expect(page.getByRole('button', { name: 'Reload to update' })).toBeVisible();

    const layout = await promptLayout(page);
    expect(layout.prompt.height).toBeLessThan(64);
    expect(layout.prompt.width).toBeLessThan(480);
    expect(layout.buttons.map((button) => button.height)).toEqual([28, 28]);
    const [reload, later] = layout.buttons;
    expect(layout.message.right).toBeLessThanOrEqual(reload.left);
    expect(reload.right).toBeLessThanOrEqual(later.left);
    expect(Math.abs((layout.message.top + layout.message.bottom) / 2 - (reload.top + reload.bottom) / 2)).toBeLessThan(2);
  });
});
