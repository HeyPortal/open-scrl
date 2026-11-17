import { expect, test, type Page } from './fixtures/test';

test.use({ viewport: { width: 1440, height: 1000 } });

async function layerX(page: Page, id: string) {
  return page.evaluate(async (layerId) => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    return useDocumentStore.getState().doc.layers[layerId].x;
  }, id);
}

/** Lengths of the gap markers on the canvas, in document px. */
async function markers(page: Page) {
  return page.evaluate(() => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const group = Konva.stages[0].findOne<import('konva').default.Group>('.gap-markers');
    if (!group) return [];
    return group.getChildren().map((marker) => {
      const { points } = ((marker as import('konva').default.Group).getChildren()[0] as import('konva').default.Line).attrs as { points: number[] };
      return Math.round(Math.hypot(points[2] - points[0], points[3] - points[1]));
    });
  });
}

test('dragging a layer snaps to an equal gap, marks the equal gaps and fades them on release', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  await expect(page.getByTitle('Zoom out')).toBeVisible();
  const ids = await page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const editor = useDocumentStore.getState();
    const ids: string[] = [];
    // Three boxes in a row: a and b are 100px apart, the moving box starts 80px after b.
    for (const x of [60, 360, 640]) {
      editor.addShapeLayer('rect');
      const id = useDocumentStore.getState().selectedLayerIds[0];
      editor.updateLayer(id, { x, y: 500, width: 200, height: 200 });
      ids.push(id);
    }
    editor.selectLayer(ids[2]);
    return ids;
  });
  // The node's on-screen geometry, once the selection and the fitted zoom have settled.
  const geometry = (id: string) => page.evaluate((layerId) => {
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0], node = stage.findOne(`#${layerId}`), transformer = stage.findOne<import('konva').default.Transformer>('Transformer');
    if (!node || transformer?.nodes()[0] !== node) return null;
    const bounds = node.getClientRect(), container = stage.container().getBoundingClientRect();
    return { x: container.left + bounds.x + bounds.width / 2, y: container.top + bounds.y + bounds.height / 2, zoom: node.getAbsoluteScale().x };
  }, id);
  let previous: Awaited<ReturnType<typeof geometry>> = null;
  await expect.poll(async () => { const next = await geometry(ids[2]); const stable = !!next && JSON.stringify(next) === JSON.stringify(previous); previous = next; return stable; }).toBe(true);
  const { x, y, zoom } = previous!;
  const from = { x, y };

  // Move 17 document px right: 3px short of a 100px gap, inside the snap threshold.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 17 * zoom, from.y, { steps: 10 });
  await expect.poll(() => markers(page)).toEqual([100, 100]);
  await page.mouse.up();

  expect(await layerX(page, ids[2])).toBeCloseTo(660, 6);
  await expect.poll(() => markers(page)).toEqual([]);
});
