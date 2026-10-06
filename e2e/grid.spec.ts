import { expect, test } from '@playwright/test';

test('adjusts the gap and outer margin of an inserted grid from the slide inspector', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Grids', exact: true }).click();
  await page.getByTitle('Apply “2 × 2” grid').click();

  const slots = () => page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const { doc } = useDocumentStore.getState();
    const slide = doc.slides[doc.slideOrder[0]];
    return slide.grid!.slotIds.map((id) => ({ x: doc.layers[id].x, y: doc.layers[id].y, w: doc.layers[id].width }));
  });

  const inspector = page.getByRole('tabpanel');
  const flush = await slots();
  expect(flush[0].x).toBe(0);

  await inspector.getByRole('slider', { name: 'Gap', exact: true }).fill('40');
  const gapped = await slots();
  expect(gapped[1].x).toBeGreaterThan(gapped[0].x + gapped[0].w);
  expect(gapped[0].w).toBeLessThan(flush[0].w);

  await inspector.getByRole('slider', { name: 'Outer margin', exact: true }).fill('60');
  const inset = await slots();
  expect(inset[0].x).toBe(60);
  expect(inset[0].y).toBe(60);
});
