import { expect, test, type Page } from './fixtures/test';
import type Konva from 'konva';
import type { TextLayer } from '../src/types';

test.use({ viewport: { width: 1440, height: 1000 } });

async function setup(page: Page, rotation = 0, zoom = 1, autoFit = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toBeVisible();
  const id = await page.evaluate(async ({ rotation, autoFit }) => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const editor = useDocumentStore.getState();
    editor.setFormat({ name: 'Test square', width: 640, height: 640 });
    editor.addTextLayer('GO KNIGHTS');
    const id = useDocumentStore.getState().selectedLayerId!;
    editor.updateLayer(id, { x: 100, y: 150, width: 400, fontSize: 48, fontWeight: 700, rotation, autoFit });
    return id;
  }, { rotation, autoFit });
  await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toBeVisible();
  // Selection opens Properties and changes the stage's fitted size. Wait for that
  // measurement before setting a manual zoom, which a pending refit would replace.
  await expect.poll(() => page.evaluate(async () => {
    const path = '/src/editor/sessionStore.ts';
    const { useEditorSession } = await import(path) as typeof import('../src/editor/sessionStore');
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    const stage = K.stages[0], rect = document.querySelector('.studio-stage')!.getBoundingClientRect();
    return stage.width() === Math.round(rect.width) && stage.height() === Math.round(rect.height) && useEditorSession.getState().zoom === useEditorSession.getState().fitZoom;
  })).toBe(true);
  await page.evaluate(async (zoom) => {
    const path = '/src/editor/sessionStore.ts';
    const { useEditorSession } = await import(path) as typeof import('../src/editor/sessionStore');
    useEditorSession.getState().setZoom(zoom);
  }, zoom);
  await expect.poll(() => page.evaluate(() => {
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    return K.stages[0].getLayers()[0].getChildren()[0].scaleX();
  })).toBe(zoom);
  return id;
}

async function state(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const path = '/src/editor/documentStore.ts', activityPath = '/src/editor/activity.ts', textPath = '/src/render/paint/text.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const { editorActivity } = await import(activityPath) as typeof import('../src/editor/activity');
    const { layoutTextLayer } = await import(textPath) as typeof import('../src/render/paint/text');
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    const node = K.stages[0].findOne<Konva.Group>(`#${id}`)!;
    const editor = useDocumentStore.getState(), layer = editor.doc.layers[id] as TextLayer;
    const preview = node.getAttr('textPreview') as TextLayer | undefined;
    const shape = node.findOne<Konva.Shape>('Shape')!;
    const painted = preview ?? layer;
    const layout = layoutTextLayer(new OffscreenCanvas(1, 1).getContext('2d')!, painted);
    return { layer, preview, history: editor.past.length, activity: editorActivity.getSnapshot(), scale: node.scale(), width: shape.width(), height: shape.height(), topLeft: node.getAbsoluteTransform().point({ x: 0, y: 0 }), topRight: node.getAbsoluteTransform().point({ x: shape.width(), y: 0 }), lines: layout.lines.length, fontSize: layout.fontSize };
  }, id);
}

async function anchor(page: Page, name: string) {
  return page.evaluate((name) => {
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    const stage = K.stages[0], handle = stage.findOne<Konva.Transformer>('Transformer')!.findOne(`.${name}`)!;
    const rect = stage.container().getBoundingClientRect(), point = handle.getAbsolutePosition();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }, name);
}

for (const zoom of [0.55, 1.25]) for (const rotation of [0, 37]) for (const side of ['left', 'right']) {
  test(`text reflows from ${side} at zoom ${zoom} and rotation ${rotation} without jumping on release`, async ({ page }) => {
    const id = await setup(page, rotation, zoom), before = await state(page, id);
    const start = await anchor(page, `middle-${side}`), direction = side === 'left' ? 1 : -1;
    const angle = rotation * Math.PI / 180;
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + direction * 200 * zoom * Math.cos(angle), start.y + direction * 200 * zoom * Math.sin(angle), { steps: 8 });
    const preview = await state(page, id);
    expect(preview.layer).toEqual(before.layer); expect(preview.history).toBe(before.history);
    // Browser mouse coordinates are rounded to screen pixels.
    expect(Math.abs(preview.preview!.width - 200)).toBeLessThan(2 / zoom); expect(preview.lines).toBeGreaterThan(before.lines);
    expect(preview.scale).toEqual({ x: 1, y: 1 }); expect(preview.fontSize).toBe(before.fontSize);
    const fixed = side === 'left' ? 'topRight' : 'topLeft';
    expect(preview[fixed].x).toBeCloseTo(before[fixed].x, 2); expect(preview[fixed].y).toBeCloseTo(before[fixed].y, 2);
    await page.mouse.up();
    const after = await state(page, id);
    expect(after.layer).toEqual(preview.preview); expect(after.history).toBe(before.history + 1); expect(after.activity).toBe(0);
    expect(after.width).toBeCloseTo(preview.width, 4); expect(after.height).toBeCloseTo(preview.height, 4);
    expect(after.topLeft.x).toBeCloseTo(preview.topLeft.x, 4); expect(after.topLeft.y).toBeCloseTo(preview.topLeft.y, 4);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await state(page, id)).layer).toEqual(before.layer);
    expect((await state(page, id)).width).toBe(before.width);
  });
}

test('cancelled text reflow restores paint, geometry and history before the pointer lifts', async ({ page }) => {
  const id = await setup(page), before = await state(page, id), start = await anchor(page, 'middle-right');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y, { steps: 6 });
  expect((await state(page, id)).lines).toBeGreaterThan(before.lines);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const cancelled = await state(page, id);
  expect(cancelled.layer).toEqual(before.layer); expect(cancelled.preview).toBeUndefined();
  expect(cancelled.width).toBe(before.width); expect(cancelled.height).toBe(before.height);
  expect(cancelled.lines).toBe(before.lines); expect(cancelled.history).toBe(before.history); expect(cancelled.activity).toBe(0);
  await page.mouse.up();
  expect((await state(page, id)).layer).toEqual(before.layer);
});

test('shrink-to-fit text lays out at its live box size and commits the same preview', async ({ page }) => {
  const id = await setup(page, 0, 1, true), before = await state(page, id), start = await anchor(page, 'bottom-right');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x - 200, start.y - 20, { steps: 8 });
  const preview = await state(page, id);
  expect(preview.scale).toEqual({ x: 1, y: 1 }); expect(preview.fontSize).toBeLessThan(before.fontSize);
  await page.mouse.up();
  expect((await state(page, id)).layer).toEqual(preview.preview);
});

test('text rotation preserves the center and dimensions without position snapping', async ({ page }) => {
  const id = await setup(page), before = await state(page, id), start = await anchor(page, 'rotater');
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 60, { steps: 8 });
  const preview = await state(page, id);
  expect(Math.abs(preview.preview!.rotation)).toBeGreaterThan(20);
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(preview.preview![key]).toBe(before.layer[key]);
  await page.mouse.up();
  expect((await state(page, id)).layer).toEqual(preview.preview);
});

test('wheel zoom preserves the point under the cursor when the canvas changes its centered origin', async ({ page }) => {
  await setup(page, 0, 1.05);
  const box = (await page.locator('.konvajs-content').boundingBox())!;
  const point = { x: box.width / 2 + 60, y: box.height / 2 + 60 };
  const content = () => page.evaluate((point) => {
    const K = (window as unknown as { Konva: typeof Konva }).Konva;
    return K.stages[0].getLayers()[0].getChildren()[0].getAbsoluteTransform().copy().invert().point(point);
  }, point);
  const before = await content();
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -240); await page.keyboard.up('Control');
  // Native scrolling is quantized to CSS pixels.
  await expect.poll(async () => Math.abs((await content()).x - before.x)).toBeLessThan(1);
  await expect.poll(async () => Math.abs((await content()).y - before.y)).toBeLessThan(1);
});

test.describe('mobile text resize', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  for (const terminal of ['touchEnd', 'touchCancel'] as const) test(`touch reflow stays anchored and ${terminal} saves the visible selectable box`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
    await expect(page.locator('.konvajs-content')).toBeVisible();
    const id = await page.evaluate(async () => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      const editor = useDocumentStore.getState();
      editor.addTextLayer('GO KNIGHTS');
      const id = useDocumentStore.getState().selectedLayerId!;
      editor.updateLayer(id, { x: 200, y: 250, width: 700, fontSize: 80, fontWeight: 700 });
      return id;
    });
    await expect.poll(() => page.evaluate(() => {
      const K = (window as unknown as { Konva: typeof Konva }).Konva;
      return K.stages[0].findOne<Konva.Transformer>('Transformer')?.nodes().length;
    })).toBe(1);
    const before = await state(page, id), start = await anchor(page, 'middle-right');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...start }] });
    for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: start.x - step * 12, y: start.y }] });
    const preview = await state(page, id);
    expect(preview.lines).toBeGreaterThan(before.lines); expect(preview.scale).toEqual({ x: 1, y: 1 });
    expect(preview.topLeft.x).toBeCloseTo(before.topLeft.x, 2); expect(preview.topLeft.y).toBeCloseTo(before.topLeft.y, 2);
    // Native handle cancellation finishes at the last visible size, like photo
    // handles; window blur discards a pending transform on either layout.
    await cdp.send('Input.dispatchTouchEvent', { type: terminal, touchPoints: [] });
    const after = await state(page, id);
    expect(after.layer).toEqual(preview.preview); expect(after.preview).toBeUndefined(); expect(after.activity).toBe(0);
    expect(after.width).toBe(preview.width); expect(after.height).toBe(preview.height); expect(after.history).toBe(before.history + 1);
    const center = await page.evaluate((id) => {
      const K = (window as unknown as { Konva: typeof Konva }).Konva, stage = K.stages[0];
      const node = stage.findOne<Konva.Group>(`#${id}`)!, shape = node.findOne<Konva.Shape>('Shape')!;
      const point = node.getAbsoluteTransform().point({ x: shape.width() / 2, y: shape.height() / 2 }), rect = stage.container().getBoundingClientRect();
      return { x: rect.x + point.x, y: rect.y + point.y };
    }, id);
    await page.evaluate(async () => {
      const path = '/src/editor/sessionStore.ts';
      const { useEditorSession } = await import(path) as typeof import('../src/editor/sessionStore');
      useEditorSession.getState().selectLayer(null);
    });
    await page.touchscreen.tap(center.x, center.y);
    await expect.poll(() => page.evaluate(async () => {
      const path = '/src/editor/sessionStore.ts';
      const { useEditorSession } = await import(path) as typeof import('../src/editor/sessionStore');
      return useEditorSession.getState().selectedLayerId;
    })).toBe(id);
    await cdp.detach();
  });
});
