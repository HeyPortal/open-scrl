import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { ProjectDocumentV2 } from '../src/types';
import { runtimeArtwork } from './fixtures/runtimeArtwork';

test.use({ viewport: { width: 1440, height: 1000 }, hasTouch: true });

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts', sessionPath = '/src/editor/sessionStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const { useEditorSession } = await import(sessionPath) as typeof import('../src/editor/sessionStore');
    const editor = useDocumentStore.getState();
    return { doc: editor.doc, selection: editor.selectedLayerIds, history: editor.past.length, zoom: useEditorSession.getState().zoom };
  });
}

async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /create.*open editor/i }).click();
  const installedKonva = JSON.parse(await readFile(new URL('../node_modules/konva/package.json', import.meta.url), 'utf8')) as { version: string };
  // A reused dev server can otherwise validate a stale optimized dependency after an upgrade.
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { version: string } }).Konva?.version)).toBe(installedKonva.version);
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    for (let row = 0; row < 4; row++) for (let column = 0; column < 8; column++) {
      ctx.fillStyle = ['#ef4444', '#22c55e', '#3b82f6', '#facc15'][(row + column) % 4];
      ctx.fillRect(column * 64, row * 64, 64, 64);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(240, 0, 32, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'Runtime.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByAltText('Runtime.png')).toBeVisible();
  const assetId = await page.evaluate(async () => {
    const path = '/src/store/assets.ts';
    const { useAssets } = await import(path) as typeof import('../src/store/assets');
    return useAssets.getState().assets[0].id;
  });
  const fixture = runtimeArtwork(assetId);
  await page.evaluate(async (artwork) => {
    const editorPath = '/src/editor/documentStore.ts', commandsPath = '/src/core/document/commands.ts';
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { command } = await import(commandsPath) as typeof import('../src/core/document/commands');
    const editor = useDocumentStore.getState();
    editor.execute(command('Load runtime artwork', (draft) => { Object.assign(draft, artwork, { id: draft.id }); }));
    editor.selectSlide(artwork.slideOrder[0]);
  }, fixture);
  await expect.poll(async () => (await state(page)).doc.format.width).toBe(640);
  await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    useDocumentStore.getState().setZoom(1);
  });
  await expect.poll(async () => (await state(page)).zoom).toBe(1);
  await page.evaluate(() => document.fonts.ready);
  // Wait for the bitmap lease to reach the live scene, without relying on a fixed delay.
  await expect.poll(() => page.evaluate(async () => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const photo = Konva.stages[0]?.findOne('#runtime-photo');
    return photo?.findOne<Konva.Shape>('Shape')?.perfectDrawEnabled();
  })).toBe(false);
  return fixture;
}

async function point(page: Page, selector: string, local?: { x: number; y: number }) {
  return page.evaluate(async ({ selector, local }) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const node = selector.startsWith('Transformer ')
      ? stage.findOne<Konva.Transformer>('Transformer')!.findOne(selector.split(' ')[1])!
      : stage.findOne(selector)!;
    const bounds = node.getClientRect();
    const p = local ? node.getAbsoluteTransform().point(local) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + p.x, y: container.top + p.y };
  }, { selector, local });
}

async function drag(page: Page, selector: string, dx: number, dy: number) {
  const from = await point(page, selector);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

async function undo(page: Page, layers: ProjectDocumentV2['layers']) {
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await state(page)).doc.layers).toEqual(layers);
}

test('native canvas gestures commit once and keep refs attached through undo and grouping', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  const initial = await state(page);

  await drag(page, '#runtime-rect', 27, 17);
  const moved = await state(page);
  expect(moved.doc.layers['runtime-rect'].x).toBeCloseTo(87, 1);
  expect(moved.doc.layers['runtime-rect'].y).toBeCloseTo(72, 1);
  expect(moved.history).toBe(initial.history + 1);
  await undo(page, initial.doc.layers);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await state(page)).doc.layers).toEqual(moved.doc.layers);

  await drag(page, 'Transformer .bottom-right', 34, 26);
  const resized = await state(page);
  expect(resized.doc.layers['runtime-rect'].width).toBeGreaterThan(130);
  expect(resized.doc.layers['runtime-rect'].height).toBeGreaterThan(105);
  expect(resized.history).toBe(moved.history + 1);
  await undo(page, moved.doc.layers);

  await drag(page, 'Transformer .rotater', 70, 25);
  const rotated = await state(page);
  expect(Math.abs(rotated.doc.layers['runtime-rect'].rotation)).toBeGreaterThan(15);
  expect(rotated.doc.layers['runtime-rect'].width).toBeCloseTo(moved.doc.layers['runtime-rect'].width, 6);
  expect(rotated.history).toBe(moved.history + 1);
  await undo(page, moved.doc.layers);

  const a = await point(page, '#runtime-group-a'), b = await point(page, '#runtime-group-b');
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift'); await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift');
  await expect.poll(async () => (await state(page)).selection).toEqual(['runtime-group-a', 'runtime-group-b']);
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  const grouped = await state(page);
  expect(grouped.doc.layers['runtime-group-a'].groupId).toBeTruthy();
  expect(grouped.doc.layers['runtime-group-b'].groupId).toBe(grouped.doc.layers['runtime-group-a'].groupId);
  await drag(page, '#runtime-group-a', 29, -23);
  const groupMoved = await state(page);
  const groupDelta = {
    x: groupMoved.doc.layers['runtime-group-a'].x - grouped.doc.layers['runtime-group-a'].x,
    y: groupMoved.doc.layers['runtime-group-a'].y - grouped.doc.layers['runtime-group-a'].y,
  };
  // Snap guides may adjust the requested delta; every member must follow the same snapped move.
  expect(groupDelta.x).toBeGreaterThan(20);
  expect(groupDelta.y).toBeLessThan(-15);
  for (const id of ['runtime-group-a', 'runtime-group-b']) {
    expect(groupMoved.doc.layers[id].x - grouped.doc.layers[id].x).toBeCloseTo(groupDelta.x, 1);
    expect(groupMoved.doc.layers[id].y - grouped.doc.layers[id].y).toBeCloseTo(groupDelta.y, 1);
  }
  expect(groupMoved.history).toBe(grouped.history + 1);
  await drag(page, 'Transformer .bottom-right', 50, 30);
  const groupResized = await state(page);
  expect(groupResized.doc.layers['runtime-group-a'].width).toBeGreaterThan(groupMoved.doc.layers['runtime-group-a'].width);
  expect(groupResized.doc.layers['runtime-group-b'].width).toBeCloseTo(groupResized.doc.layers['runtime-group-a'].width, 1);
  expect(groupResized.doc.layers['runtime-locked']).toEqual(initial.doc.layers['runtime-locked']);
  await undo(page, groupMoved.doc.layers);
  await drag(page, 'Transformer .rotater', 55, 20);
  const groupRotated = await state(page);
  expect(Math.abs(groupRotated.doc.layers['runtime-group-a'].rotation)).toBeGreaterThan(10);
  expect(groupRotated.doc.layers['runtime-group-b'].rotation).toBeCloseTo(groupRotated.doc.layers['runtime-group-a'].rotation, 6);
  expect(groupRotated.history).toBe(groupMoved.history + 1);
  await undo(page, groupMoved.doc.layers);
  const locked = await point(page, '#runtime-locked'); await page.mouse.click(locked.x, locked.y);
  await drag(page, '#runtime-locked', 25, 20);
  expect((await state(page)).doc.layers['runtime-locked']).toEqual(initial.doc.layers['runtime-locked']);
  expect(errors).toEqual([]);
});

/** Compares Konva's custom scene with the independent export renderer at project resolution. */
async function fidelity(page: Page) {
  return page.evaluate(async () => {
    const editorPath = '/src/editor/documentStore.ts';
    const rendererPath = '/src/export/canvas2d/render.ts', assetsPath = '/src/assets/indexeddb/IndexedDbAssetRepository.ts';
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { renderSlides } = await import(rendererPath) as typeof import('../src/export/canvas2d/render');
    const { assetRepository } = await import(assetsPath) as typeof import('../src/assets/indexeddb/IndexedDbAssetRepository');
    const { doc } = useDocumentStore.getState();
    const stage = Konva.stages[0], view = stage.getLayers()[0].getChildren()[0];
    const scale = view.scaleX(), offset = view.position(), { width, height } = doc.format;
    const actualCanvas = stage.toCanvas({ x: offset.x, y: offset.y, width: width * scale, height: height * scale, pixelRatio: 1 / scale });
    const [expectedBlob] = await renderSlides(doc, [0], (id) => assetRepository.readOriginal(id), (w, h) => new OffscreenCanvas(w, h), { format: 'png', quality: 1, pixelRatio: 1 });
    const expectedImage = await createImageBitmap(expectedBlob);
    const expectedCanvas = new OffscreenCanvas(width, height), ctx = expectedCanvas.getContext('2d')!;
    ctx.drawImage(expectedImage, 0, 0); expectedImage.close();
    const actual = actualCanvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const expected = ctx.getImageData(0, 0, width, height).data;
    let difference = 0, changed = 0, samples = 0, hash = 2166136261;
    // Exclude the editor-only slide border and sample all the custom artwork.
    for (let y = 8; y < height - 8; y++) for (let x = 8; x < width - 8; x++) {
      const p = (y * width + x) * 4;
      let pixelDifference = 0;
      for (let channel = 0; channel < 4; channel++) {
        pixelDifference += Math.abs(actual[p + channel] - expected[p + channel]);
        hash = Math.imul(hash ^ actual[p + channel], 16777619);
      }
      difference += pixelDifference; if (pixelDifference > 16) changed++; samples++;
    }
    return { konvaVersion: Konva.version, meanChannelDifference: difference / (samples * 4), changedFraction: changed / samples, artworkHash: (hash >>> 0).toString(16), png: actualCanvas.toDataURL('image/png') };
  });
}

test('custom artwork, crop, text editing, phone preview and remount retain fidelity', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  const before = await state(page);
  let comparison = await fidelity(page);
  const originalHash = comparison.artworkHash;
  expect(comparison.meanChannelDifference).toBeLessThan(1);
  expect(comparison.changedFraction).toBeLessThan(.02);
  const artworkPath = testInfo.outputPath('runtime-artwork.png'), fidelityPath = testInfo.outputPath('runtime-fidelity.json');
  await writeFile(artworkPath, Buffer.from(comparison.png.split(',')[1], 'base64'));
  await writeFile(fidelityPath, JSON.stringify({ ...comparison, png: undefined }, null, 2));
  await testInfo.attach('runtime-artwork.png', { path: artworkPath, contentType: 'image/png' });
  await testInfo.attach('runtime-fidelity.json', { path: fidelityPath, contentType: 'application/json' });

  // Ellipse corners must pass through the custom hit function to the empty canvas.
  const corner = await point(page, '#runtime-ellipse', { x: 1, y: 1 }); await page.mouse.click(corner.x, corner.y);
  expect((await state(page)).selection).toEqual([]);
  const photo = await point(page, '#runtime-photo'); await page.mouse.click(photo.x, photo.y);
  await page.getByLabel('Crop zoom').fill('2');
  await page.getByLabel('Horizontal crop position').fill('-0.25');
  const cropped = await state(page);
  expect(cropped.doc.layers['runtime-photo']).toMatchObject({ cropScale: 2, cropOffsetX: -.25 });
  expect(cropped.doc.layers['runtime-photo'].width).toBe(before.doc.layers['runtime-photo'].width);
  await drag(page, 'Transformer .bottom-right', 35, 25);
  const resizedPhoto = (await state(page)).doc.layers['runtime-photo'];
  expect(resizedPhoto.width).toBeGreaterThan(cropped.doc.layers['runtime-photo'].width);
  expect(resizedPhoto.width / resizedPhoto.height).toBeCloseTo(cropped.doc.layers['runtime-photo'].width / cropped.doc.layers['runtime-photo'].height, 6);
  await undo(page, cropped.doc.layers);
  await page.keyboard.press('Escape');
  comparison = await fidelity(page);
  expect(comparison.meanChannelDifference).toBeLessThan(1);
  expect(comparison.artworkHash).not.toBe(originalHash);

  const text = await point(page, '#runtime-text'); await page.mouse.dblclick(text.x, text.y);
  await page.locator('textarea:not([aria-label])').fill('Runtime 19\nEdited in place');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Phone preview' });
  await expect(preview).toBeVisible();
  await expect.poll(async () => (await state(page)).doc.layers['runtime-text']).toMatchObject({ text: 'Runtime 19\nEdited in place' });
  await expect(preview.getByLabel('Slide 1 of 2')).toBeVisible();
  await page.keyboard.press('ArrowRight'); await expect(preview.getByLabel('Slide 2 of 2')).toBeVisible();
  await page.keyboard.press('ArrowLeft'); await expect(preview.getByLabel('Slide 1 of 2')).toBeVisible();
  await preview.getByRole('radio', { name: 'Profile grid', exact: true }).click();
  await expect(preview.getByText('Profile grid crop', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0);
  const edited = await state(page);
  await page.getByTitle('Projects', { exact: true }).click();
  await page.getByRole('button', { name: /Runtime artwork/ }).click();
  await expect.poll(async () => (await state(page)).doc.layers).toEqual(edited.doc.layers);
  await expect.poll(() => page.evaluate(async () => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    return Konva.stages.length;
  })).toBe(1);
  expect(errors).toEqual([]);
});

test('native touch pan and pinch keep the stage and viewport in sync', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch input uses the Chromium DevTools protocol.');
  await setup(page);
  const stage = await page.locator('.konvajs-content').boundingBox();
  expect(stage).not.toBeNull();
  const client = await page.context().newCDPSession(page);
  const origin = await point(page, '#runtime-group-a', { x: 220, y: 140 });
  const touchPoints = [{ id: 1, x: origin.x - 60, y: origin.y }, { id: 2, x: origin.x + 60, y: origin.y }];
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: origin.x - 90, y: origin.y }, { id: 2, x: origin.x + 90, y: origin.y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await state(page)).zoom).toBeCloseTo(1.5, 1);
  await expect.poll(() => page.evaluate(async () => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    return Konva.stages[0].getLayers()[0].getChildren()[0].scaleX();
  })).toBeCloseTo(1.5, 1);
  const scroll = page.getByTestId('canvas-scroll');
  const before = await scroll.evaluate((element) => element.scrollLeft);
  const empty = { id: 1, x: stage!.x + stage!.width - 80, y: stage!.y + 180 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [empty] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...empty, x: empty.x - 80 }] });
  await expect.poll(() => scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(async () => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const scroll = document.querySelector<HTMLElement>('[data-testid="canvas-scroll"]')!;
    return Konva.stages[0].getLayers()[0].getChildren()[0].x() + scroll.scrollLeft;
  })).toBeCloseTo(32, 1);
  await client.detach();
});
