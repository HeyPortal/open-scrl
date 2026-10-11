import { expect, test, type CDPSession, type Page } from './fixtures/test';

async function createCarousel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(page.locator('.konvajs-content')).toBeVisible();
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const documentPath = '/src/editor/documentStore.ts', sessionPath = '/src/editor/sessionStore.ts', activityPath = '/src/editor/activity.ts';
    const { useDocumentStore } = await import(documentPath) as typeof import('../src/editor/documentStore');
    const { useEditorSession } = await import(sessionPath) as typeof import('../src/editor/sessionStore');
    const { editorActivity } = await import(activityPath) as typeof import('../src/editor/activity');
    const editor = useDocumentStore.getState(), session = useEditorSession.getState();
    const stage = (window as unknown as { Konva: typeof import('konva').default }).Konva.stages[0];
    const scroll = document.querySelector<HTMLElement>('[data-testid="canvas-scroll"]')!;
    return { doc: editor.doc, history: editor.past.length, selected: session.selectedSlideId, activity: editorActivity.getSnapshot(), left: scroll.scrollLeft, x: stage.getLayers()[0].getChildren()[0].x(), slidePixels: editor.doc.format.width * session.zoom };
  });
}

async function startPoint(page: Page) {
  const box = (await page.locator('.konvajs-content').boundingBox())!;
  return { x: box.x + Math.min(box.width - 30, 300), y: box.y + 24, id: 1 };
}

const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: { x: number; y: number; id: number }[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

async function pull(page: Page, cdp: CDPSession, travel: number) {
  const point = await startPoint(page);
  await touch(cdp, 'touchStart', [point]);
  await touch(cdp, 'touchMove', [{ ...point, x: point.x - travel }]);
  return point;
}

test.describe('swipe to append on phones', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('previews one slide and settles continuously onto it as a single undo step', async ({ page }) => {
    await createCarousel(page);
    const before = await state(page);
    const cdp = await page.context().newCDPSession(page);
    const time = new Date();
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await pull(page, cdp, 150);
    await page.clock.runFor(32);
    await expect(page.getByTestId('slide-append-hint')).toHaveText('Release to add slide');
    const preview = await state(page);
    expect(preview.doc.slideOrder).toEqual(before.doc.slideOrder);
    expect(preview.history).toBe(before.history);
    expect(preview.x).toBeLessThan(before.x - 60);
    expect(preview.activity).toBeGreaterThan(0);
    await touch(cdp, 'touchEnd', []);
    const added = await state(page);
    expect(added.doc.slideOrder).toHaveLength(2);
    expect(added.doc.slideOrder[0]).toBe(before.doc.slideOrder[0]);
    expect(added.history).toBe(before.history + 1);
    expect(added.selected).toBe(added.doc.slideOrder[1]);
    expect(added.left).toBeCloseTo(before.x - preview.x, 0);
    expect(added.activity).toBeGreaterThan(0);
    const positions = [added.left];
    for (const ticks of [90, 90, 180, 32]) {
      await page.clock.runFor(ticks);
      positions.push((await state(page)).left);
    }
    expect(positions[1]).toBeGreaterThan(positions[0]);
    expect(positions[1]).toBeLessThan(positions.at(-1)!);
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    const settled = await state(page);
    expect(settled.left).toBeCloseTo(settled.slidePixels, 0);
    expect(settled.x + settled.left).toBeCloseTo(before.x, 0);
    expect(settled.activity).toBe(0);
    await expect(page.getByTestId('slide-append-hint')).toHaveCount(0);
    await page.clock.resume();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect.poll(async () => (await state(page)).doc.slideOrder.length).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).tap();
    await expect.poll(async () => (await state(page)).doc.slideOrder).toEqual(added.doc.slideOrder);
    await cdp.detach();
  });

  for (const ending of ['short pull', 'reverse', 'touch cancel', 'window blur'] as const) {
    test(`${ending} leaves the document unchanged and releases its activity`, async ({ page }) => {
      await createCarousel(page);
      const before = await state(page);
      const cdp = await page.context().newCDPSession(page);
      const point = await pull(page, cdp, ending === 'short pull' ? 30 : 150);
      await expect(page.getByTestId('slide-append-hint')).toBeVisible();
      if (ending === 'reverse') await touch(cdp, 'touchMove', [{ ...point, x: point.x - 20 }]);
      if (ending === 'window blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await touch(cdp, ending === 'touch cancel' ? 'touchCancel' : 'touchEnd', []);
      await expect(page.getByTestId('slide-append-hint')).toHaveCount(0);
      await expect.poll(async () => (await state(page)).activity).toBe(0);
      const after = await state(page);
      expect(after.doc).toEqual(before.doc);
      expect(after.history).toBe(before.history);
      expect(after.left).toBe(before.left);
      await cdp.detach();
    });
  }

  test('swiping from an earlier slide navigates to the last without appending', async ({ page }) => {
    await createCarousel(page);
    await page.getByRole('button', { name: 'Add slide', exact: true }).tap();
    await page.getByRole('button', { name: 'Slide 1', exact: true }).tap();
    const before = await state(page);
    const cdp = await page.context().newCDPSession(page);
    await pull(page, cdp, 230);
    await touch(cdp, 'touchEnd', []);
    await expect.poll(async () => (await state(page)).selected).toBe(before.doc.slideOrder[1]);
    expect((await state(page)).doc).toEqual(before.doc);
    await expect(page.getByTestId('slide-append-hint')).toHaveCount(0);
    await cdp.detach();
  });

  test('a second finger cancels the add preview and zoomed panning cannot add slides', async ({ page }) => {
    await createCarousel(page);
    const before = await state(page);
    const cdp = await page.context().newCDPSession(page);
    const point = await pull(page, cdp, 150);
    await expect(page.getByTestId('slide-append-hint')).toBeVisible();
    const fingers = [{ ...point, x: point.x - 150 }, { ...point, x: point.x - 50, id: 2 }];
    await touch(cdp, 'touchStart', fingers);
    await touch(cdp, 'touchMove', [{ ...fingers[0], x: fingers[0].x - 40 }, { ...fingers[1], x: fingers[1].x + 40 }]);
    await touch(cdp, 'touchEnd', []);
    await expect(page.getByTestId('slide-append-hint')).toHaveCount(0);
    await pull(page, cdp, 150);
    await touch(cdp, 'touchEnd', []);
    expect((await state(page)).doc).toEqual(before.doc);
    await expect.poll(async () => (await state(page)).activity).toBe(0);
    await cdp.detach();
  });

  test('reduced motion adds and centers the slide without a settling tween', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createCarousel(page);
    const cdp = await page.context().newCDPSession(page);
    await pull(page, cdp, 150);
    await expect(page.getByTestId('slide-append-hint')).toHaveText('Release to add slide');
    await touch(cdp, 'touchEnd', []);
    const after = await state(page);
    expect(after.doc.slideOrder).toHaveLength(2);
    expect(after.left).toBeCloseTo(after.slidePixels, 0);
    expect(after.activity).toBe(0);
    await cdp.detach();
  });

  test('vertical panning and panning with a selected layer do not append', async ({ page }) => {
    await createCarousel(page);
    const cdp = await page.context().newCDPSession(page);
    const point = await startPoint(page);
    const before = await state(page);
    await touch(cdp, 'touchStart', [point]);
    await touch(cdp, 'touchMove', [{ ...point, x: point.x - 20, y: point.y + 120 }]);
    await touch(cdp, 'touchEnd', []);
    expect((await state(page)).doc).toEqual(before.doc);
    await page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      useDocumentStore.getState().addShapeLayer('rect');
    });
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    const selected = await state(page);
    await pull(page, cdp, 150);
    await touch(cdp, 'touchEnd', []);
    expect((await state(page)).doc).toEqual(selected.doc);
    await expect(page.getByTestId('slide-append-hint')).toHaveCount(0);
    await expect.poll(async () => (await state(page)).activity).toBe(0);
    await cdp.detach();
  });

  test('interrupting the settling animation keeps the added slide and releases its activity', async ({ page }) => {
    await createCarousel(page);
    const cdp = await page.context().newCDPSession(page);
    const time = new Date();
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await pull(page, cdp, 150);
    await expect(page.getByTestId('slide-append-hint')).toHaveText('Release to add slide');
    await touch(cdp, 'touchEnd', []);
    expect((await state(page)).activity).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect((await state(page)).activity).toBe(0);
    expect((await state(page)).doc.slideOrder).toHaveLength(2);
    await page.clock.runFor(500);
    expect((await state(page)).activity).toBe(0);
    await page.clock.resume();
    await cdp.detach();
  });
});

test.describe('swipe to append in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('successive pulls append at the end and center each new slide', async ({ page }) => {
    await createCarousel(page);
    const first = (await state(page)).doc.slideOrder[0];
    const cdp = await page.context().newCDPSession(page);
    for (const count of [2, 3]) {
      await pull(page, cdp, 150);
      await expect(page.getByTestId('slide-append-hint')).toHaveText('Release to add slide');
      await touch(cdp, 'touchEnd', []);
      await expect.poll(async () => (await state(page)).activity).toBe(0);
      const added = await state(page);
      expect(added.doc.slideOrder).toHaveLength(count);
      expect(added.doc.slideOrder[0]).toBe(first);
      expect(added.selected).toBe(added.doc.slideOrder.at(-1));
      expect(added.left).toBeCloseTo((count - 1) * added.slidePixels, 0);
    }
    await cdp.detach();
  });
});
