import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runtimeArtwork } from './fixtures/runtimeArtwork';

test.use({ viewport: { width: 1440, height: 1000 } });

async function state(page: Page) {
  return page.evaluate(async () => {
    const documentPath = '/src/editor/documentStore.ts', activityPath = '/src/editor/activity.ts';
    const { useDocumentStore } = await import(documentPath) as typeof import('../src/editor/documentStore');
    const { editorActivity } = await import(activityPath) as typeof import('../src/editor/activity');
    const editor = useDocumentStore.getState();
    return { doc: editor.doc, selection: editor.selectedLayerIds, history: editor.past.length, activity: editorActivity.getSnapshot() };
  });
}

async function setup(page: Page) {
  await page.goto('/');
  await page.getByLabel('Project name').fill('Activity source');
  await page.getByRole('button', { name: /create.*open editor/i }).click();
  const installed = JSON.parse(await readFile(new URL('../node_modules/konva/package.json', import.meta.url), 'utf8')) as { version: string };
  // Use the running application's singleton, including its actual Stage registry.
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva?: { version: string } }).Konva?.version)).toBe(installed.version);
  const artwork = runtimeArtwork('unused');
  artwork.slideOrder = [artwork.slideOrder[0]];
  artwork.slides = { [artwork.slideOrder[0]]: artwork.slides[artwork.slideOrder[0]] };
  artwork.layers = Object.fromEntries(['runtime-rect', 'runtime-ellipse', 'runtime-text'].map((id) => [id, artwork.layers[id]]));
  artwork.slides[artwork.slideOrder[0]].layerOrder = Object.keys(artwork.layers);
  await page.evaluate(async (fixture) => {
    const documentPath = '/src/editor/documentStore.ts', commandPath = '/src/core/document/commands.ts';
    const { useDocumentStore } = await import(documentPath) as typeof import('../src/editor/documentStore');
    const { command } = await import(commandPath) as typeof import('../src/core/document/commands');
    const editor = useDocumentStore.getState();
    editor.execute(command('Load activity artwork', (draft) => { Object.assign(draft, fixture, { id: draft.id, name: draft.name }); }));
    editor.selectSlide(fixture.slideOrder[0]);
  }, artwork);
  await expect.poll(async () => (await state(page)).doc.format.width).toBe(640);
  await expect.poll(async () => (await state(page)).activity).toBe(0);
}

async function point(page: Page, selector: string) {
  return page.evaluate((selector) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const node = selector.startsWith('Transformer ')
      ? stage.findOne<Konva.Transformer>('Transformer')!.findOne(selector.split(' ')[1])!
      : stage.findOne(selector)!;
    const bounds = node.getClientRect(), container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2 };
  }, selector);
}

async function holdTransform(page: Page) {
  const layer = await point(page, '#runtime-rect');
  await page.mouse.click(layer.x, layer.y);
  await expect.poll(async () => (await state(page)).selection).toEqual(['runtime-rect']);
  const anchor = await point(page, 'Transformer .bottom-right');
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 45, anchor.y + 32, { steps: 6 });
  await expect.poll(async () => (await state(page)).activity).toBeGreaterThan(0);
}

for (const cancellation of ['Escape', 'Delete', 'ControlOrMeta+a'] as const) {
  test(`cancels an unfinished single transform when selection changes through ${cancellation}`, async ({ page }) => {
    await setup(page);
    const before = await state(page);
    await holdTransform(page);
    expect((await state(page)).doc.layers).toEqual(before.doc.layers);
    await page.keyboard.press(cancellation);
    // Verify cancellation while the anchor pointer is still held, before mouseup.
    await expect.poll(async () => (await state(page)).activity).toBe(0);
    await page.mouse.up();
    const after = await state(page);
    if (cancellation === 'Delete') {
      const remaining = { ...before.doc.layers }; delete remaining['runtime-rect'];
      expect(after.doc.layers).toEqual(remaining);
      expect(after.history).toBe(before.history + 1);
    } else {
      expect(after.doc.layers).toEqual(before.doc.layers);
      expect(after.history).toBe(before.history);
      if (cancellation === 'Escape') expect(after.selection).toEqual([]);
      else expect(after.selection.length).toBeGreaterThan(1);
    }
  });
}

test('Escape discards an in-place text draft and releases the pending edit', async ({ page }) => {
  await setup(page);
  const before = await state(page), text = await point(page, '#runtime-text');
  await page.mouse.dblclick(text.x, text.y);
  const editor = page.locator('textarea:not([aria-label])');
  await editor.fill('This draft must be discarded');
  await expect.poll(async () => (await state(page)).activity).toBeGreaterThan(0);
  expect((await state(page)).doc.layers).toEqual(before.doc.layers);
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await state(page)).activity).toBe(0);
  const after = await state(page);
  expect(after.doc.layers).toEqual(before.doc.layers);
  expect(after.history).toBe(before.history);
});

for (const interaction of ['transform', 'text'] as const) {
  test(`switching projects cancels a pending ${interaction} without changing either document`, async ({ page }) => {
    await setup(page);
    const source = await state(page);
    const destination = await page.evaluate(async (sourceId) => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      await useDocumentStore.getState().newProject({ name: 'Square', width: 640, height: 640 }, 'Activity destination');
      const destination = useDocumentStore.getState().doc;
      await useDocumentStore.getState().openProject(sourceId);
      return destination;
    }, source.doc.id);
    await expect.poll(async () => (await state(page)).doc.id).toBe(source.doc.id);
    if (interaction === 'transform') await holdTransform(page);
    else {
      const text = await point(page, '#runtime-text');
      await page.mouse.dblclick(text.x, text.y);
      await page.locator('textarea:not([aria-label])').fill('Stale source draft');
      await expect.poll(async () => (await state(page)).activity).toBeGreaterThan(0);
    }
    // Use the real navigation action so the test can keep the pointer/draft pending.
    await page.evaluate(async (destinationId) => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      await useDocumentStore.getState().openProject(destinationId);
    }, destination.id);
    await expect.poll(async () => (await state(page)).activity).toBe(0);
    if (interaction === 'transform') await page.mouse.up();
    await expect(page.locator('textarea:not([aria-label])')).toHaveCount(0);
    expect((await state(page)).doc).toEqual(destination);
    await page.evaluate(async (sourceId) => {
      const path = '/src/editor/documentStore.ts';
      const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
      await useDocumentStore.getState().openProject(sourceId);
    }, source.doc.id);
    await expect.poll(async () => (await state(page)).doc.id).toBe(source.doc.id);
    expect((await state(page)).doc.layers).toEqual(source.doc.layers);
    await expect.poll(async () => (await state(page)).activity).toBe(0);
  });
}
