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

test('linking gap and outer margin snaps the margin to the gap and moves both together', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /create|start/i }).first().click();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Grids', exact: true }).click();
  await page.getByTitle('Apply “2 × 2” grid').click();

  const grid = () => page.evaluate(async () => {
    const path = '/src/editor/documentStore.ts';
    const { useDocumentStore } = await import(path) as typeof import('../src/editor/documentStore');
    const { doc } = useDocumentStore.getState();
    const g = doc.slides[doc.slideOrder[0]].grid!;
    return { gap: g.gap, margin: g.margin, firstX: doc.layers[g.slotIds[0]].x };
  });

  const inspector = page.getByRole('tabpanel');
  const link = inspector.getByRole('button', { name: 'Link gap and outer margin' });
  await inspector.getByRole('slider', { name: 'Gap', exact: true }).fill('30');
  await inspector.getByRole('slider', { name: 'Outer margin', exact: true }).fill('10');
  expect(await grid()).toMatchObject({ gap: 30, margin: 10 });
  await expect(link).toHaveAttribute('aria-pressed', 'false');

  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'true');
  expect(await grid()).toMatchObject({ gap: 30, margin: 30, firstX: 30 });

  await inspector.getByRole('slider', { name: 'Outer margin', exact: true }).fill('50');
  expect(await grid()).toMatchObject({ gap: 50, margin: 50, firstX: 50 });

  await inspector.getByRole('slider', { name: 'Gap', exact: true }).fill('20');
  expect(await grid()).toMatchObject({ gap: 20, margin: 20, firstX: 20 });

  await link.click();
  await expect(link).toHaveAttribute('aria-pressed', 'false');
  await inspector.getByRole('slider', { name: 'Gap', exact: true }).fill('40');
  expect(await grid()).toMatchObject({ gap: 40, margin: 20 });
});
