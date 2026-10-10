import { expect, test, type CDPSession, type Page } from '@playwright/test';

// The mobile canvas has its own gesture and text-editing code. These checks make sure unfinished
// work there holds back a waiting app update (editorActivity) exactly like the desktop canvas does.

const dock = (page: Page) => page.getByRole('tablist', { name: 'Editor tools' });
const dockTab = (page: Page, name: string) => dock(page).getByRole('tab', { name, exact: true });
const sheetRegion = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });

async function createCarousel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(dock(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { stages: unknown[] } }).Konva?.stages.length)).toBe(1);
}

async function addRectangle(page: Page) {
  await dockTab(page, 'Shapes').tap();
  await sheetRegion(page, 'Shapes').getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
  await expect(sheetRegion(page, 'Shapes')).toHaveCount(0);
}

async function addText(page: Page) {
  await dockTab(page, 'Text').tap();
  await page.getByRole('button', { name: 'Add text box', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
  await expect(sheetRegion(page, 'Text')).toHaveCount(0);
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const documentPath = '/src/editor/documentStore.ts', activityPath = '/src/editor/activity.ts';
    const { useDocumentStore } = await import(documentPath) as typeof import('../src/editor/documentStore');
    const { editorActivity } = await import(activityPath) as typeof import('../src/editor/activity');
    const editor = useDocumentStore.getState();
    return { doc: editor.doc, selection: editor.selectedLayerIds, history: editor.past.length, activity: editorActivity.getSnapshot() };
  });
}
const activity = async (page: Page) => (await state(page)).activity;

/** The first layer node's centre in client coordinates, and its drawn width. */
async function layerCentre(page: Page, name: '.layer' = '.layer') {
  return page.evaluate((name) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const bounds = stage.findOne(name)!.getClientRect();
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2, width: bounds.width };
  }, name);
}

async function stageCorner(page: Page) {
  return page.evaluate(() => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const container = Konva.stages[0].container().getBoundingClientRect();
    return { x: container.left + 40, y: container.top + 40 };
  });
}

async function handle(page: Page, anchor: string) {
  return page.evaluate((anchor) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const position = stage.findOne<import('konva').default.Transformer>('Transformer')!.findOne(anchor)!.getAbsolutePosition();
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + position.x, y: container.top + position.y };
  }, anchor);
}

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: { x: number; y: number; id: number }[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

const fingersAround = (centre: { x: number; y: number }, spread: number) => [
  { x: centre.x - spread, y: centre.y, id: 1 },
  { x: centre.x + spread, y: centre.y, id: 2 },
];

test.describe('mobile editor pending work', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('a two-finger layer transform holds back updates until the fingers lift, then commits once', async ({ page }) => {
    await createCarousel(page);
    await addRectangle(page);
    const before = await state(page);
    expect(before.activity).toBe(0);
    const centre = await layerCentre(page);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', fingersAround(centre, 14).slice(0, 1));
    await touch(cdp, 'touchStart', fingersAround(centre, 14));
    for (let spread = 20; spread <= 44; spread += 8) await touch(cdp, 'touchMove', fingersAround(centre, spread));
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    expect((await state(page)).doc.layers).toEqual(before.doc.layers);
    await touch(cdp, 'touchEnd', fingersAround(centre, 44).slice(0, 1));
    // One finger is still down: the gesture is not over.
    expect(await activity(page)).toBeGreaterThan(0);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(() => activity(page)).toBe(0);
    const after = await state(page);
    const [id] = Object.keys(before.doc.layers);
    expect(after.doc.layers[id].width).toBeGreaterThan(before.doc.layers[id].width);
    expect(after.history).toBe(before.history + 1);
    await cdp.detach();
  });

  test('pinching the canvas holds back updates and a cancelled touch releases them', async ({ page }) => {
    await createCarousel(page);
    await addRectangle(page);
    const before = await state(page);
    const corner = await stageCorner(page);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', fingersAround(corner, 12).slice(0, 1));
    await touch(cdp, 'touchStart', fingersAround(corner, 12));
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    for (let spread = 20; spread <= 44; spread += 8) await touch(cdp, 'touchMove', fingersAround(corner, spread));
    expect(await activity(page)).toBeGreaterThan(0);
    await touch(cdp, 'touchCancel', []);
    await expect.poll(() => activity(page)).toBe(0);
    // A pan or pinch never edits the document.
    const after = await state(page);
    expect(after.doc.layers).toEqual(before.doc.layers);
    expect(after.history).toBe(before.history);
    await cdp.detach();
  });

  test('a single finger panning empty canvas holds back updates until it lifts', async ({ page }) => {
    await createCarousel(page);
    const corner = await stageCorner(page);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ ...corner, id: 1 }]);
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    await touch(cdp, 'touchMove', [{ x: corner.x + 30, y: corner.y + 6, id: 1 }]);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(() => activity(page)).toBe(0);
    await cdp.detach();
  });

  test('losing window focus mid-transform rolls the preview back and releases updates', async ({ page }) => {
    await createCarousel(page);
    await addRectangle(page);
    const before = await state(page);
    const centre = await layerCentre(page);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', fingersAround(centre, 14).slice(0, 1));
    await touch(cdp, 'touchStart', fingersAround(centre, 14));
    for (let spread = 20; spread <= 44; spread += 8) await touch(cdp, 'touchMove', fingersAround(centre, spread));
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    expect((await layerCentre(page)).width).toBeGreaterThan(centre.width);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(() => activity(page)).toBe(0);
    // The layer is back where the document has it.
    await expect.poll(async () => (await layerCentre(page)).width).toBeCloseTo(centre.width, 0);
    await touch(cdp, 'touchEnd', []);
    const after = await state(page);
    expect(after.doc.layers).toEqual(before.doc.layers);
    expect(after.history).toBe(before.history);
    await cdp.detach();
  });

  test('a native layer drag holds back updates and a cancelled touch discards the move', async ({ page }) => {
    await createCarousel(page);
    await addRectangle(page);
    const before = await state(page);
    const centre = await layerCentre(page);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ ...centre, id: 1 }]);
    for (let step = 1; step <= 4; step++) await touch(cdp, 'touchMove', [{ x: centre.x + step * 8, y: centre.y + step * 5, id: 1 }]);
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    expect((await state(page)).doc.layers).toEqual(before.doc.layers);
    await touch(cdp, 'touchCancel', []);
    await expect.poll(() => activity(page)).toBe(0);
    const after = await state(page);
    expect(after.doc.layers).toEqual(before.doc.layers);
    expect(after.history).toBe(before.history);
    await cdp.detach();
  });

  test('a handle resize holds back updates until the finger lifts', async ({ page }) => {
    await createCarousel(page);
    await addRectangle(page);
    const before = await state(page);
    const corner = await handle(page, '.bottom-right');
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ ...corner, id: 1 }]);
    for (let step = 1; step <= 4; step++) await touch(cdp, 'touchMove', [{ x: corner.x + step * 6, y: corner.y + step * 6, id: 1 }]);
    await expect.poll(() => activity(page)).toBeGreaterThan(0);
    expect((await state(page)).doc.layers).toEqual(before.doc.layers);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(() => activity(page)).toBe(0);
    const [id] = Object.keys(before.doc.layers);
    expect((await state(page)).doc.layers[id].width).toBeGreaterThan(before.doc.layers[id].width);
    await cdp.detach();
  });

  test.describe('inline text drafts', () => {
    const inline = (page: Page) => page.getByRole('textbox', { name: 'Edit text', exact: true });

    async function openEditor(page: Page) {
      await addText(page);
      const point = await layerCentre(page);
      await page.touchscreen.tap(point.x, point.y);
      await page.touchscreen.tap(point.x, point.y);
      await expect(inline(page)).toBeFocused();
    }

    test('Done commits the draft and Escape discards it, both releasing updates', async ({ page }) => {
      await createCarousel(page);
      await openEditor(page);
      const before = await state(page);
      const [id] = Object.keys(before.doc.layers);
      expect(await activity(page)).toBeGreaterThan(0);

      await page.keyboard.insertText('Discard me');
      await expect(inline(page)).toHaveValue('Discard me');
      expect((await state(page)).doc.layers[id]).toEqual(before.doc.layers[id]);
      expect(await activity(page)).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(inline(page)).toHaveCount(0);
      await expect.poll(() => activity(page)).toBe(0);
      const discarded = await state(page);
      expect(discarded.doc.layers[id].text).toBe(before.doc.layers[id].text);
      expect(discarded.history).toBe(before.history);

      const point = await layerCentre(page);
      await page.touchscreen.tap(point.x, point.y);
      await page.touchscreen.tap(point.x, point.y);
      await expect(inline(page)).toBeFocused();
      await page.keyboard.insertText('Keep me');
      expect(await activity(page)).toBeGreaterThan(0);
      await page.getByRole('button', { name: 'Done editing text', exact: true }).tap();
      await expect(inline(page)).toHaveCount(0);
      await expect.poll(() => activity(page)).toBe(0);
      expect((await state(page)).doc.layers[id].text).toBe('Keep me');
    });

    test('a draft survives its field going away within the project', async ({ page }) => {
      await createCarousel(page);
      await openEditor(page);
      const before = await state(page);
      const [id] = Object.keys(before.doc.layers);
      await page.keyboard.insertText('Kept without a blur');
      // Selecting another layer unmounts the field; iOS does not always blur it first.
      await page.evaluate(async () => {
        const path = '/src/editor/sessionStore.ts';
        const { useEditorSession } = await import(path) as typeof import('../src/editor/sessionStore');
        useEditorSession.getState().selectLayer(null);
      });
      await expect(inline(page)).toHaveCount(0);
      await expect.poll(() => activity(page)).toBe(0);
      expect((await state(page)).doc.layers[id].text).toBe('Kept without a blur');
    });

    test('switching projects drops the draft without touching either document', async ({ page }) => {
      await createCarousel(page);
      await openEditor(page);
      await page.keyboard.insertText('Stale source draft');
      expect(await activity(page)).toBeGreaterThan(0);
      const source = await state(page);
      const destination = await page.evaluate(async (sourceId) => {
        const path = '/src/editor/documentStore.ts';
        const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
        await useDocumentStore.getState().newProject({ name: 'Square', width: 640, height: 640 }, 'Mobile destination');
        const next = useDocumentStore.getState().doc;
        await useDocumentStore.getState().openProject(sourceId);
        return next;
      }, source.doc.id);
      // The first switch away from the open draft already dropped it.
      await expect.poll(async () => (await state(page)).doc.id).toBe(source.doc.id);
      await expect(inline(page)).toHaveCount(0);
      await expect.poll(() => activity(page)).toBe(0);
      const [id] = Object.keys(source.doc.layers);
      expect((await state(page)).doc.layers[id].text).toBe(source.doc.layers[id].text);
      await page.evaluate(async (destinationId) => {
        const path = '/src/editor/documentStore.ts';
        const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
        await useDocumentStore.getState().openProject(destinationId);
      }, destination.id);
      await expect.poll(async () => (await state(page)).doc.id).toBe(destination.id);
      expect((await state(page)).doc).toEqual(destination);
      expect(await activity(page)).toBe(0);
    });
  });
});
