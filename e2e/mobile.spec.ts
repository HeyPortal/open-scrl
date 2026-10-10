import { expect, test, type Page } from '@playwright/test';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
/** Dock tab labels, in order. */
const TOOL_TAB_LABELS = ['Photos', 'Grids', 'Text', 'Shapes', 'Canvas', 'Layers'];

/** Collects uncaught page errors; each test asserts the list is empty at the end. */
function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  return errors;
}

const dock = (page: Page) => page.getByRole('tablist', { name: 'Editor tools' });
const dockTab = (page: Page, name: string) => dock(page).getByRole('tab', { name, exact: true });
const sheetRegion = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection actions' });
const addSlideButton = (page: Page) => page.getByRole('button', { name: 'Add slide', exact: true });
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });

/** Home screen -> "Create carousel" -> mobile editor. */
async function createCarousel(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  await expect(dock(page)).toBeVisible();
}

/** Adds a rectangle from the Shapes sheet and closes the sheet, leaving the new shape selected. */
async function addRectangle(page: Page) {
  await dockTab(page, 'Shapes').tap();
  await sheetRegion(page, 'Shapes').getByRole('button', { name: 'Rectangle', exact: true }).tap();
  await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
  await expect(sheetRegion(page, 'Shapes')).toHaveCount(0);
}

test.describe('mobile editor', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('fresh profile shows the mobile home and "Create carousel" opens the mobile editor', async ({ page }) => {
    const errors = trackPageErrors(page);

    await test.step('Mobile home instead of the desktop landing page', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Open-SCRL', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No carousels yet' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New project' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create & open editor' })).toHaveCount(0);
    });

    await test.step('"Create carousel" opens the mobile editor', async () => {
      await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
      await expect(page.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
      await expect(dock(page).getByRole('tab')).toHaveText(TOOL_TAB_LABELS);
      await expect(page.getByRole('heading', { name: 'No carousels yet' })).toHaveCount(0);
    });

    expect(errors).toEqual([]);
  });

  test('dock tabs open, switch, and close their sheets; the slide strip hides while a sheet is open', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(addSlideButton(page)).toBeVisible();

    for (const name of TOOL_TAB_LABELS) {
      await test.step(`${name} tab opens its sheet, and tapping it again closes the sheet`, async () => {
        await dockTab(page, name).tap();
        await expect(dockTab(page, name)).toHaveAttribute('aria-selected', 'true');
        await expect(sheetRegion(page, name)).toBeVisible();
        await expect(addSlideButton(page)).toBeHidden();

        await dockTab(page, name).tap();
        await expect(sheetRegion(page, name)).toHaveCount(0);
        await expect(dockTab(page, name)).toHaveAttribute('aria-selected', 'false');
        await expect(addSlideButton(page)).toBeVisible();
      });
    }

    await test.step('Tapping another tab switches the sheet', async () => {
      await dockTab(page, 'Photos').tap();
      await expect(sheetRegion(page, 'Photos')).toBeVisible();
      await dockTab(page, 'Text').tap();
      await expect(sheetRegion(page, 'Text')).toBeVisible();
      await expect(sheetRegion(page, 'Photos')).toHaveCount(0);
      await expect(dockTab(page, 'Photos')).toHaveAttribute('aria-selected', 'false');
      await expect(dockTab(page, 'Text')).toHaveAttribute('aria-selected', 'true');
    });

    await test.step('The sheet close button closes it', async () => {
      await dockTab(page, 'Shapes').tap();
      await expect(sheetRegion(page, 'Shapes')).toBeVisible();
      await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
      await expect(sheetRegion(page, 'Shapes')).toHaveCount(0);
      await expect(dockTab(page, 'Shapes')).toHaveAttribute('aria-selected', 'false');
      await expect(addSlideButton(page)).toBeVisible();
    });

    expect(errors).toEqual([]);
  });

  test('adding a shape selects it; the selection bar replaces the dock and Done restores it', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Shape added from the Shapes sheet is selected and the selection bar shows', async () => {
      await addRectangle(page);
      await expect(selectionBar(page)).toBeVisible();
      await expect(page.getByRole('status', { name: 'Selected: Shape' })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible();
      await expect(selectionBar(page).getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
      await expect(dock(page)).toHaveCount(0);
    });

    await test.step('Duplicate adds a second layer', async () => {
      await selectionBar(page).getByRole('button', { name: 'Duplicate', exact: true }).tap();
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(selectionBar(page)).toHaveCount(0);
      await expect(dock(page)).toBeVisible();

      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByRole('option')).toHaveCount(2);
      // Selecting a row from the Layers sheet brings the selection bar back once the sheet closes.
      await sheetRegion(page, 'Layers').getByRole('option').first().tap();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers')).toHaveCount(0);
      await expect(selectionBar(page)).toBeVisible();
    });

    await test.step('Edit opens the inspector; Done clears the selection and restores the dock', async () => {
      await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
      await expect(sheetRegion(page, 'Shape')).toBeVisible();
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(selectionBar(page)).toHaveCount(0);
      await expect(sheetRegion(page, 'Shape')).toHaveCount(0);
      await expect(dock(page)).toBeVisible();
      await expect(dockTab(page, 'Layers')).toHaveAttribute('aria-selected', 'false');
    });

    expect(errors).toEqual([]);
  });

  test('top bar undo and redo revert and restore an added shape', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(undoButton(page)).toBeDisabled();

    await test.step('Adding a shape enables Undo', async () => {
      await addRectangle(page);
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(undoButton(page)).toBeEnabled();
      await expect(redoButton(page)).toBeDisabled();
    });

    await test.step('Undo removes the shape and enables Redo', async () => {
      await undoButton(page).tap();
      await expect(redoButton(page)).toBeEnabled();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByText('Empty slide')).toBeVisible();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers')).toHaveCount(0);
    });

    await test.step('Redo restores the shape', async () => {
      await redoButton(page).tap();
      await expect(redoButton(page)).toBeDisabled();
      await dockTab(page, 'Layers').tap();
      await expect(sheetRegion(page, 'Layers').getByRole('option')).toHaveCount(1);
      await dockTab(page, 'Layers').tap();
    });

    expect(errors).toEqual([]);
  });

  test('the slide strip adds a slide and the slide actions menu deletes it again', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await expect(page.getByRole('status', { name: 'Slide 1 of 1' })).toBeVisible();

    await test.step('"+" tile adds a second slide', async () => {
      await addSlideButton(page).tap();
      await expect(page.getByRole('status', { name: 'Slide 2 of 2' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Slide \d/ })).toHaveCount(2);
    });

    await test.step('Tapping the selected thumbnail opens slide actions', async () => {
      await page.getByRole('button', { name: /^Slide 2, selected/ }).tap();
      const menu = page.getByRole('menu', { name: 'Slide actions' });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
    });

    await test.step('Delete returns the project to one slide', async () => {
      await page.getByRole('menu', { name: 'Slide actions' }).getByRole('menuitem', { name: 'Delete', exact: true }).tap();
      await expect(page.getByRole('menu', { name: 'Slide actions' })).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Slide 1 of 1' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Slide \d/ })).toHaveCount(1);
    });

    expect(errors).toEqual([]);
  });

  test('text can be edited by double-tapping the canvas and through its properties', async ({ page }) => {
    await createCarousel(page);
    await dockTab(page, 'Text').tap();
    await page.getByRole('button', { name: 'Add text box', exact: true }).tap();
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    const point = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const bounds = stage.findOne('.layer')!.getClientRect();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await page.touchscreen.tap(point.x, point.y);
    const inline = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await expect(inline).toBeVisible();
    await expect(inline).toBeFocused();
    await page.keyboard.insertText('Edited on the canvas');
    await expect(inline).toHaveValue('Edited on the canvas');
    await page.setViewportSize({ width: 393, height: 380 });
    await expect(inline).toBeFocused();
    await page.getByRole('button', { name: 'Done editing text', exact: true }).tap();
    await expect(inline).toHaveCount(0);
    await page.setViewportSize({ width: 393, height: 852 });
    await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
    const content = page.getByRole('textbox', { name: 'Text content', exact: true });
    await expect(content).toHaveValue('Edited on the canvas');
    await content.tap();
    await expect(content).toBeFocused();
    await content.selectText();
    await page.keyboard.insertText('Edited in properties');
    await page.setViewportSize({ width: 393, height: 380 });
    await expect(content).toBeFocused();
    await content.press('End');
    const client = await page.context().newCDPSession(page);
    await client.send('Input.imeSetComposition', { text: ' café', selectionStart: 5, selectionEnd: 5 });
    await client.send('Input.insertText', { text: ' café' });
    await expect(content).toHaveValue('Edited in properties café');
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    await page.setViewportSize({ width: 393, height: 852 });
    await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
    await expect(content).toHaveValue('Edited in properties café');
  });

  test('text moved onto another slide stays reachable when selecting, dragging and editing', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await dockTab(page, 'Text').tap();
    await page.getByRole('button', { name: 'Your headline Headline · 120px', exact: true }).tap();
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    await addSlideButton(page).tap();
    await page.getByRole('button', { name: 'Slide 1', exact: true }).tap();

    const frame = () => page.evaluate(() => {
      const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
      const stage = Konva.stages[0];
      const node = stage.findOne<import('konva').default.Group>('.layer');
      const shape = node?.findOne<import('konva').default.Shape>('Shape');
      if (!node || !shape) return null;
      const local = shape.getAbsoluteTransform().point({ x: shape.width() * .35, y: shape.height() / 2 });
      const rect = stage.content.getBoundingClientRect();
      return { x: rect.left + local.x, y: rect.top + local.y, layerX: node.x(), scroll: document.querySelector('[data-testid="canvas-scroll"]')!.scrollLeft };
    });
    await expect.poll(frame).not.toBeNull();
    const original = (await frame())!;
    await page.touchscreen.tap(original.x, original.y);
    await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
    const x = page.getByRole('spinbutton', { name: 'X position', exact: true });
    // Moving beyond one slide width keeps the layer's document owner on slide 1.
    // Set up that position through the inspector, without changing slide ownership.
    await x.fill(String(Number(await x.inputValue()) + 1080));
    await x.press('Tab');
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await page.getByRole('button', { name: 'Slide 2', exact: true }).tap();
    await expect.poll(frame).not.toBeNull();
    const before = (await frame())!;
    await page.touchscreen.tap(before.x, before.y);
    await expect(page.getByRole('status', { name: 'Selected: Text' })).toBeVisible();
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(before.scroll, 0);

    // A first drag on the deselected layer must move it, even though its owner differs.
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await page.getByRole('button', { name: 'Slide 2', exact: true }).tap();
    const start = (await frame())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 12, y: start.y + 8, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 36, y: start.y + 24, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await frame())?.layerX ?? 0).toBeGreaterThan(start.layerX + 50);
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(start.scroll, 0);

    const moved = (await frame())!;
    await page.touchscreen.tap(moved.x, moved.y);
    await page.touchscreen.tap(moved.x, moved.y);
    const inline = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await expect(inline).toBeFocused();
    await page.keyboard.insertText('Edited on slide two');
    await page.setViewportSize({ width: 393, height: 380 });
    await expect(inline).toBeFocused();
    await page.getByRole('button', { name: 'Done editing text', exact: true }).tap();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(start.scroll, 0);
    await selectionBar(page).getByRole('button', { name: 'Edit', exact: true }).tap();
    await expect(page.getByRole('textbox', { name: 'Text content', exact: true })).toHaveValue('Edited on slide two');
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();

    // Zoom out on blank canvas, then reselect on the second slide at that zoom.
    const blank = await page.locator('.konvajs-content').boundingBox();
    const y = blank!.y + blank!.height * .85;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 76, y, id: 2 }, { x: 316, y, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 124, y, id: 2 }, { x: 268, y, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.getByRole('button', { name: 'Slide 2', exact: true }).tap();
    const zoomed = (await frame())!;
    expect(zoomed.scroll).toBeLessThan(start.scroll);
    await page.touchscreen.tap(zoomed.x, zoomed.y);
    await expect(page.getByRole('status', { name: 'Selected: Text' })).toBeVisible();
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(zoomed.scroll, 0);
    const resetPoint = await page.locator('.konvajs-content').boundingBox();
    await page.touchscreen.tap(196, resetPoint!.y + resetPoint!.height * .85);
    await page.touchscreen.tap(196, resetPoint!.y + resetPoint!.height * .85);
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(start.scroll, 0);

    // Explicit thumbnail navigation still changes the viewport.
    await page.getByRole('button', { name: 'Slide 1', exact: true }).tap();
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBe(0);
    await page.getByRole('button', { name: 'Projects', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Open Untitled', exact: true }).tap();
    await expect(dock(page)).toBeVisible();
    await page.getByRole('button', { name: 'Slide 2', exact: true }).tap();
    await expect.poll(frame).not.toBeNull();
    const reopened = (await frame())!;
    await page.touchscreen.tap(reopened.x, reopened.y);
    await expect(page.getByRole('status', { name: 'Selected: Text' })).toBeVisible();
    await expect.poll(() => page.getByTestId('canvas-scroll').evaluate((el) => el.scrollLeft)).toBeCloseTo(reopened.scroll, 0);
    expect(errors).toEqual([]);
  });

  for (const layout of ['blank slide', 'filled grid'] as const) {
    for (const hitMap of ['normal', 'empty', 'wrong layer'] as const) {
      test(`touch selects a title over a photo on a ${layout} with a ${hitMap} hit map after reopening`, async ({ page }) => {
        const errors = trackPageErrors(page);
        const point = (kind: 'image' | 'text') => page.evaluate((kind) => {
          const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
          const stage = Konva.stages[0];
          const nodes = stage.find('.layer');
          const node = (kind === 'image' ? nodes[0] : nodes.at(-1)) as import('konva').default.Group;
          const shape = node.getChildren()[0] as import('konva').default.Shape;
          const local = node.getAbsoluteTransform().point({ x: shape.width() * (kind === 'image' ? .5 : .35), y: shape.height() * (kind === 'image' ? .8 : .5) });
          const bounds = stage.container().getBoundingClientRect();
          return { x: bounds.left + local.x, y: bounds.top + local.y };
        }, kind);
        if (layout === 'filled grid') {
          await page.goto('/');
          await page.getByRole('button', { name: 'Start with 2 side grid', exact: true }).tap();
          await expect(dock(page)).toBeVisible();
          const photo = await point('image');
          await page.touchscreen.tap(photo.x, photo.y);
          await selectionBar(page).getByRole('button', { name: 'Add photo', exact: true }).tap();
        } else {
          await createCarousel(page);
          await dockTab(page, 'Photos').tap();
        }
        // A landscape photo with light pixels keeps the dark title visible over it.
        const png = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 640; canvas.height = 480;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#e2e8f0'; context.fillRect(0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png').split(',')[1];
        });
        await page.locator('input[type=file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await expect(page.getByText('Imported 1 media file.')).toBeVisible();
        await sheetRegion(page, 'Photos').getByAltText('photo.png').tap();
        await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();
        await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
        await dockTab(page, 'Text').tap();
        await page.getByRole('button', { name: 'Your headline Headline · 120px', exact: true }).tap();
        await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
        await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();

        const selectBoth = async () => {
          await expect.poll(() => page.evaluate(() => {
            const Konva = (window as Window & { Konva?: typeof import('konva').default }).Konva;
            return Konva?.stages[0]?.find('.layer').length ?? 0;
          })).toBe(layout === 'filled grid' ? 3 : 2);
          // Match the phone trace: bitmap reads may miss everything or name the
          // photo underneath visible text. Touch must still follow the drawn stack.
          if (hitMap !== 'normal') await page.evaluate((hitMap) => {
            const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
            Konva.Layer.prototype.getIntersection = () => hitMap === 'empty' ? null : Konva.stages[0].findOne('.layer')!.findOne('Shape')!;
          }, hitMap);
          for (let i = 0; i < 3; i++) {
            const title = await point('text');
            await page.touchscreen.tap(title.x, title.y);
            await expect(page.getByRole('status', { name: 'Selected: Text' })).toBeVisible();
            const photo = await point('image');
            await page.touchscreen.tap(photo.x, photo.y);
            await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
            await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
          }
        };
        await selectBoth();
        await page.getByRole('button', { name: 'Projects', exact: true }).tap();
        await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toBeVisible();
        await page.reload();
        await page.getByRole('button', { name: 'Open Untitled', exact: true }).tap();
        await expect(dock(page)).toBeVisible();
        await selectBoth();
        expect(errors).toEqual([]);
      });
    }
  }

  test('geometric touch hits respect rotated shape corners and thin targets', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await addRectangle(page);
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await dockTab(page, 'Shapes').tap();
    await sheetRegion(page, 'Shapes').getByRole('button', { name: 'Ellipse', exact: true }).tap();
    await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
    const ids = await page.evaluate(async () => {
      const path = '/src/store/editor.ts';
      const { useEditor } = await import(path) as typeof import('../src/store/editor');
      const shapes = Object.values(useEditor.getState().doc.layers).filter((layer) => layer.kind === 'shape');
      useEditor.getState().updateLayer(shapes[1].id, { rotation: 90 });
      const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
      Konva.Layer.prototype.getIntersection = () => null;
      return shapes.map((shape) => shape.id);
    });
    const point = (id: string, x: number, y: number) => page.evaluate(({ id, x, y }) => {
      const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
      const stage = Konva.stages[0];
      const shape = stage.findOne(`#${id}`)!.findOne<import('konva').default.Shape>('Shape')!;
      const p = shape.getAbsoluteTransform().point({ x: shape.width() * x, y: y < 0 ? y / Math.abs(shape.getAbsoluteScale().y) : shape.height() * y });
      const rect = stage.container().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    }, { id, x, y });
    const selected = () => page.evaluate(() => {
      const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
      return Konva.stages[0].findOne<import('konva').default.Transformer>('Transformer')!.nodes()[0]?.id();
    });
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    const corner = await point(ids[1], .25, .05);
    await page.touchscreen.tap(corner.x, corner.y);
    await expect.poll(selected).toBe(ids[0]);
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    const centre = await point(ids[1], .5, .5);
    await page.touchscreen.tap(centre.x, centre.y);
    await expect.poll(selected).toBe(ids[1]);
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await dockTab(page, 'Shapes').tap();
    await sheetRegion(page, 'Shapes').getByRole('button', { name: 'Divider', exact: true }).tap();
    await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
    const divider = await selected();
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    const near = await point(divider!, .5, -10);
    await page.touchscreen.tap(near.x, near.y);
    await expect.poll(selected).toBe(divider);
    expect(errors).toEqual([]);
  });

  test('grid photo frames can be selected by touching the canvas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start with 2 side grid', exact: true }).tap();
    await expect(dock(page)).toBeVisible();
    const point = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const bounds = stage.findOne('.layer')!.getClientRect();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
  });

  test('an imported photo can be selected, dragged and resized with an empty bitmap hit map', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.addInitScript(() => {
      const state = window as Window & { dropPhotoTouchEnd?: boolean };
      window.addEventListener('touchend', (event) => {
        if (!state.dropPhotoTouchEnd) return;
        state.dropPhotoTouchEnd = false;
        event.stopImmediatePropagation();
      }, true);
    });
    await createCarousel(page);

    await dockTab(page, 'Photos').tap();
    await expect(sheetRegion(page, 'Photos')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng });
    await expect(page.getByText('Imported 1 media file.')).toBeVisible();

    await sheetRegion(page, 'Photos').getByAltText('tiny.png').tap();
    await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();

    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
    await expect(selectionBar(page).getByRole('button', { name: 'Replace', exact: true })).toBeVisible();

    await page.evaluate(() => {
      const Konva = (window as Window & { Konva: typeof import('konva').default }).Konva;
      Konva.Layer.prototype.getIntersection = () => null;
    });

    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    const point = await page.evaluate(async () => {
      const konvaPath = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(konvaPath) as typeof import('konva');
      const stage = Konva.stages[0];
      const node = stage.findOne('.layer')!;
      const bounds = node.getClientRect();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();

    const photoFrame = () => page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      const layer = Object.values(useDocumentStore.getState().doc.layers)[0];
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation };
    });
    const before = await photoFrame();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 9 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 24, y: point.y + 18, id: 9 }] });
    const isDragging = () => page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      return Konva.isDragging();
    });
    await expect.poll(isDragging).toBe(true);
    // An interrupted stream can end without the pointer Konva expects. It must
    // still release the drag and restore the hit canvas for the next touch.
    await page.locator('.konvajs-content canvas').first().evaluate((canvas) => {
      canvas.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, touches: [], changedTouches: [] }));
    });
    await expect.poll(isDragging).toBe(false);
    await expect.poll(photoFrame).toEqual(before);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // Lose one terminal event, as when a touch stream is interrupted. The next
    // first finger must finish the old move and start a new one at that point.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 32, y: point.y + 22, id: 8 }] });
    await page.evaluate(() => { (window as Window & { dropPhotoTouchEnd?: boolean }).dropPhotoTouchEnd = true; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(isDragging).toBe(true);
    await expect.poll(photoFrame).toEqual(before);
    const resume = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const bounds = stage.findOne('.layer')!.getClientRect();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...resume, id: 7 }] });
    await expect.poll(photoFrame).not.toEqual(before);
    const resumed = await photoFrame();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: resume.x + 24, y: resume.y + 18, id: 7 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(photoFrame).not.toEqual(resumed);
    await expect.poll(isDragging).toBe(false);
    await undoButton(page).tap();
    await undoButton(page).tap();
    await expect.poll(photoFrame).toEqual(before);

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + step * 8, y: point.y + step * 5, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(photoFrame).not.toEqual(before);

    // A move must leave the photo touchable at its new position, without Undo
    // forcing another redraw or a refresh resetting the gesture state.
    for (let repeat = 0; repeat < 3; repeat++) {
      const moved = await photoFrame();
      await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
      const nextPoint = await page.evaluate(async () => {
        const path = '/node_modules/.vite/deps/konva.js';
        const { default: Konva } = await import(path) as typeof import('konva');
        const stage = Konva.stages[0];
        const bounds = stage.findOne('.layer')!.getClientRect();
        const container = stage.container().getBoundingClientRect();
        return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
      });
      await page.touchscreen.tap(nextPoint.x, nextPoint.y);
      await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...nextPoint, id: repeat + 3 }] });
      for (let step = 1; step <= 5; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: nextPoint.x - step * 7, y: nextPoint.y + step * 4, id: repeat + 3 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(photoFrame).not.toEqual(moved);
    }
    for (let repeat = 0; repeat < 3; repeat++) await undoButton(page).tap();
    await undoButton(page).tap();
    await expect.poll(photoFrame).toEqual(before);

    const corner = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const node = stage.findOne('Transformer')!.findOne('.bottom-right')!;
      const position = node.getAbsolutePosition();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + position.x, y: container.top + position.y };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...corner, id: 1 }] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: corner.x + step * 5, y: corner.y + step * 5, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await photoFrame()).width).toBeGreaterThan(before.width);
    await undoButton(page).tap();
    await expect.poll(photoFrame).toEqual(before);

    const fingers = (spread: number) => [
      { x: point.x - spread, y: point.y, id: 1 },
      { x: point.x + spread, y: point.y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40).slice(0, 1) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) });
    for (let spread = 45; spread <= 60; spread += 5) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(spread) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: fingers(60).slice(0, 1) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await photoFrame()).width).toBeGreaterThan(before.width);
    await undoButton(page).tap();
    await expect.poll(photoFrame).toEqual(before);
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
    await cdp.detach();

    expect(errors).toEqual([]);
  });

  test('a cancelled photo resize releases the handle and leaves the photo touchable', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);
    await dockTab(page, 'Photos').tap();
    await page.locator('input[type=file]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: tinyPng });
    await sheetRegion(page, 'Photos').getByAltText('tiny.png').tap();
    await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();

    const frame = () => page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      const layer = Object.values(useDocumentStore.getState().doc.layers)[0];
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height };
    });
    const before = await frame();
    const corner = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const position = stage.findOne('Transformer')!.findOne('.bottom-right')!.getAbsolutePosition();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + position.x, y: container.top + position.y };
    });
    const transforming = () => page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      return Konva.isTransforming();
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...corner, id: 1 }] });
    await expect.poll(transforming).toBe(true);
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: corner.x + step * 5, y: corner.y + step * 5, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(transforming).toBe(false);
    await expect.poll(async () => (await frame()).width).toBeGreaterThan(before.width);
    await undoButton(page).tap();
    await expect.poll(frame).toEqual(before);
    await selectionBar(page).getByRole('button', { name: 'Done', exact: true }).tap();
    const centre = await page.evaluate(async () => {
      const path = '/node_modules/.vite/deps/konva.js';
      const { default: Konva } = await import(path) as typeof import('konva');
      const stage = Konva.stages[0];
      const bounds = stage.findOne('.layer')!.getClientRect();
      const container = stage.container().getBoundingClientRect();
      return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
    });
    await page.touchscreen.tap(centre.x, centre.y);
    await expect(page.getByRole('status', { name: 'Selected: Photo' })).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...centre, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x + 24, y: centre.y + 18, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(frame).not.toEqual(before);
    await cdp.detach();
    expect(errors).toEqual([]);
  });

  test('the Export sheet offers three options and "Export carousel" downloads a ZIP', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Export opens the sheet with its three options', async () => {
      await page.getByRole('button', { name: 'Export', exact: true }).tap();
      const exportSheet = sheetRegion(page, 'Export');
      await expect(exportSheet).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Export carousel/ })).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Save this slide/ })).toBeVisible();
      await expect(exportSheet.getByRole('button', { name: /^Preview on phone/ })).toBeVisible();
    });

    await test.step('Export carousel triggers a ZIP download', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        sheetRegion(page, 'Export').getByRole('button', { name: /^Export carousel/ }).tap(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      expect(await download.failure()).toBeNull();
    });

    expect(errors).toEqual([]);
  });

  test('renaming in the Project sheet shows on the home list and reopens the project', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createCarousel(page);

    await test.step('Rename the project in the Project sheet', async () => {
      await page.getByRole('button', { name: /^Project settings:/ }).tap();
      await expect(sheetRegion(page, 'Project')).toBeVisible();
      await page.getByLabel('Project name', { exact: true }).fill('Beach trip');
      await expect(page.getByRole('button', { name: 'Project settings: Beach trip', exact: true })).toBeVisible();
    });

    await test.step('Back to projects lists the renamed project', async () => {
      await page.getByRole('button', { name: 'Back to projects', exact: true }).tap();
      await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open Beach trip', exact: true })).toBeVisible();
    });

    await test.step('Tapping the project reopens the editor', async () => {
      await page.getByRole('button', { name: 'Open Beach trip', exact: true }).tap();
      await expect(page.getByRole('button', { name: 'Project settings: Beach trip', exact: true })).toBeVisible();
      await expect(dock(page)).toBeVisible();
    });

    expect(errors).toEqual([]);
  });
});

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('desktop landing page and editor render without the mobile dock', async ({ page }) => {
    const errors = trackPageErrors(page);

    await test.step('Desktop landing page, not the mobile home', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'New project' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create & open editor' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create carousel', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Start from a grid' })).toHaveCount(0);
    });

    await test.step('Desktop editor with the side tools, not the mobile dock', async () => {
      await page.getByRole('button', { name: 'Create & open editor' }).click();
      await expect(page.getByTitle('Zoom out')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Tools' })).toBeVisible();
      await expect(dock(page)).toHaveCount(0);
    });

    expect(errors).toEqual([]);
  });
});
