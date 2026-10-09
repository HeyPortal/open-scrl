import { expect, test, type Page } from '@playwright/test';
import type { ImageLayer, ProjectDocumentV2 } from '../src/types';

async function documentState(page: Page): Promise<ProjectDocumentV2> {
  return page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    return useDocumentStore.getState().doc;
  });
}

function frameStyle(layer: ImageLayer) {
  const { assetId, cropOffsetX, cropOffsetY, cropScale, ...frame } = layer;
  void assetId; void cropOffsetX; void cropOffsetY; void cropScale;
  return frame;
}

async function setup(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /create.*open editor/i }).click();
  await expect(page.getByTitle('Zoom out')).toBeVisible();
  const images = await page.evaluate(() => ['Red', 'Blue', 'Green', 'Yellow'].map((name, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = ['#ef4444', '#3b82f6', '#22c55e', '#eab308'][index];
    context.fillRect(0, 0, 400, 300);
    return { name: `${name}.png`, data: canvas.toDataURL('image/png').split(',')[1] };
  }));
  await page.locator('input[type=file]').setInputFiles(images.slice(0, 3).map((image) => ({
    name: image.name, mimeType: 'image/png', buffer: Buffer.from(image.data, 'base64'),
  })));
  await expect(page.getByAltText('Green.png')).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const editorPath = '/src/editor/documentStore.ts', gridPath = '/src/lib/grids.ts', assetsPath = '/src/store/assets.ts';
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { GRID_TEMPLATES } = await import(gridPath) as typeof import('../src/lib/grids');
    const { useAssets } = await import(assetsPath) as typeof import('../src/store/assets');
    const editor = useDocumentStore.getState();
    editor.applyGrid(GRID_TEMPLATES.find((grid) => grid.count === 4)!, 24);
    const doc = useDocumentStore.getState().doc;
    const ids = doc.slides[doc.slideOrder[0]].layerOrder;
    const assets = Object.fromEntries(useAssets.getState().assets.map((asset) => [asset.name, asset.id]));
    editor.assignPhoto(ids[0], assets['Red.png']);
    editor.assignPhoto(ids[1], assets['Blue.png']);
    editor.updateLayer(ids[0], { locked: true, rotation: 8, cornerRadius: 25, cropScale: 1.8, cropOffsetX: .2, cropOffsetY: -.1 });
    editor.selectLayer(null);
    return { ids, assets, slideId: doc.slideOrder[0] };
  });
  return { ...fixture, images };
}

async function framePoint(page: Page, id: string) {
  return page.evaluate((layerId) => {
    // Konva exposes the app's singleton. Importing an optimizer-generated URL
    // without its version query can create a second instance after Vite upgrades.
    const Konva = (window as unknown as { Konva: typeof import('konva')['default'] }).Konva;
    const stage = Konva.stages[0];
    const bounds = stage.findOne(`#${layerId}`)!.getClientRect();
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
  }, id);
}

test('dragging library media replaces a locked rotated frame and shuffle preserves its layout', async ({ page }) => {
  const { ids, assets } = await setup(page);
  const before = await documentState(page);
  const point = await framePoint(page, ids[0]);
  const stage = await page.locator('.konvajs-content').boundingBox();
  await page.getByRole('button', { name: 'Green.png', exact: true }).dragTo(page.locator('.konvajs-content'), {
    targetPosition: { x: point.x - stage!.x, y: point.y - stage!.y },
  });
  await expect.poll(async () => (await documentState(page)).layers[ids[0]]).toEqual({
    ...before.layers[ids[0]], assetId: assets['Green.png'], cropScale: 1, cropOffsetX: 0, cropOffsetY: 0,
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(before.layers);

  await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    useDocumentStore.getState().selectLayer(null);
  });
  await page.getByRole('button', { name: 'Shuffle photos', exact: true }).click();
  const after = await documentState(page);
  expect(ids.map((id) => (after.layers[id] as ImageLayer).assetId)).not.toEqual(ids.map((id) => (before.layers[id] as ImageLayer).assetId));
  expect(ids.map((id) => (after.layers[id] as ImageLayer).assetId).sort()).toEqual(ids.map((id) => (before.layers[id] as ImageLayer).assetId).sort());
  for (const id of ids) expect(frameStyle(after.layers[id] as ImageLayer)).toEqual(frameStyle(before.layers[id] as ImageLayer));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(before.layers);
});

test('file drops reuse imported photos, fill only available frames, and undo in one step', async ({ page }) => {
  const { ids, assets, images } = await setup(page);
  const before = await documentState(page);
  const point = await framePoint(page, ids[0]);
  const dataTransfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const image of files) {
      const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], image.name, { type: 'image/png' }));
    }
    return transfer;
  }, [images[2], images[0], images[1], images[3]]);
  await page.locator('.workspace').dispatchEvent('dragover', { dataTransfer, clientX: point.x, clientY: point.y });
  await page.locator('.workspace').dispatchEvent('drop', { dataTransfer, clientX: point.x, clientY: point.y });
  await expect(page.getByText(/Placed 3 items.*1 item.*stay in Media/)).toBeVisible();
  await expect.poll(async () => {
    const doc = await documentState(page);
    return ids.map((id) => (doc.layers[id] as ImageLayer).assetId);
  }).toEqual([
    assets['Green.png'], assets['Blue.png'], assets['Red.png'], assets['Blue.png'],
  ]);
  const after = await documentState(page);
  expect(Object.keys(after.layers)).toHaveLength(4);
  for (const id of ids) expect(frameStyle(after.layers[id] as ImageLayer)).toEqual(frameStyle(before.layers[id] as ImageLayer));
  await expect(page.getByAltText('Yellow.png')).toBeVisible();
  await expect(page.getByAltText('Red.png')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(before.layers);
  const emptyPoint = await page.evaluate(async () => {
    const editorPath = '/src/editor/documentStore.ts';
    const Konva = (window as unknown as { Konva: typeof import('konva')['default'] }).Konva;
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const stage = Konva.stages[0], format = useDocumentStore.getState().doc.format;
    const point = stage.getLayers()[0].getChildren()[0].getAbsoluteTransform().point({ x: format.width / 2, y: format.height / 2 });
    const container = stage.container().getBoundingClientRect();
    return { x: container.left + point.x, y: container.top + point.y };
  });
  await page.locator('.workspace').dispatchEvent('drop', { dataTransfer, clientX: emptyPoint.x, clientY: emptyPoint.y });
  await expect.poll(async () => Object.keys((await documentState(page)).layers).length).toBe(8);
  const stacked = await documentState(page);
  for (const id of ids) expect(stacked.layers[id]).toEqual(before.layers[id]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(before.layers);
});

test('explicit swap and a cross-slide move keep frames and locks intact', async ({ page }) => {
  const { ids, assets } = await setup(page);
  const before = await documentState(page);
  await page.evaluate(async (selected) => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    useDocumentStore.getState().selectLayers(selected);
  }, ids.slice(0, 2));
  await page.getByRole('button', { name: 'Swap photos', exact: true }).click();
  let after = await documentState(page);
  expect((after.layers[ids[0]] as ImageLayer).assetId).toBe(assets['Blue.png']);
  expect((after.layers[ids[1]] as ImageLayer).assetId).toBe(assets['Red.png']);
  for (const id of ids) expect(frameStyle(after.layers[id] as ImageLayer)).toEqual(frameStyle(before.layers[id] as ImageLayer));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(before.layers);

  const targetId = await page.evaluate(async (sourceId) => {
    const editorPath = '/src/editor/documentStore.ts', gridPath = '/src/lib/grids.ts';
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { GRID_TEMPLATES } = await import(gridPath) as typeof import('../src/lib/grids');
    const editor = useDocumentStore.getState(); editor.addSlide(); editor.applyGrid(GRID_TEMPLATES[0], 0);
    const doc = useDocumentStore.getState().doc;
    const target = doc.slides[doc.slideOrder[1]].layerOrder[0];
    useDocumentStore.getState().selectLayer(sourceId);
    return target;
  }, ids[0]);
  const beforeMove = await documentState(page);
  await page.getByLabel('Other photo frame').selectOption(targetId);
  await page.getByRole('button', { name: 'Move photo', exact: true }).click();
  after = await documentState(page);
  expect((after.layers[ids[0]] as ImageLayer).assetId).toBeNull();
  expect((after.layers[targetId] as ImageLayer).assetId).toBe(assets['Red.png']);
  for (const id of [ids[0], targetId]) expect(frameStyle(after.layers[id] as ImageLayer)).toEqual(frameStyle(beforeMove.layers[id] as ImageLayer));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await documentState(page)).layers).toEqual(beforeMove.layers);
});
