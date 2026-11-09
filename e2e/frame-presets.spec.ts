import { expect, test } from '@playwright/test';
test('frame gallery selection is saved and undoable', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /create.*open editor/i }).click();
  const data = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#6e91ad'; ctx.fillRect(0, 0, 600, 800); ctx.fillStyle = '#d89f64'; ctx.fillRect(0, 380, 600, 420); ctx.fillStyle = '#f9dc8d'; ctx.beginPath(); ctx.arc(430, 170, 75, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#425349'; ctx.beginPath(); ctx.moveTo(0, 500); ctx.lineTo(240, 250); ctx.lineTo(600, 600); ctx.closePath(); ctx.fill(); return canvas.toDataURL('image/png').split(',')[1]; });
  const image = Buffer.from(data, 'base64');
  await page.locator('input[accept^="image/"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: image });
  await page.getByAltText('photo.png').click();
  await page.getByRole('button', { name: 'Polaroid frame', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Polaroid frame', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'docs/images/web-frame-presets.png' });
  await page.getByTitle(/Undo/).first().click();
  await expect(page.getByRole('button', { name: 'Polaroid frame', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Paper frame', exact: true }).click();
  await page.getByTitle('Projects', { exact: true }).click(); await page.reload();
  await page.getByRole('button', { name: /Untitled/ }).click();
  const layer = await page.evaluate(async () => { const modulePath = '/src/editor/documentStore.ts'; const { useDocumentStore } = await import(modulePath); return Object.values(useDocumentStore.getState().doc.layers)[0]; });
  expect(layer).toMatchObject({ frameStyle: 'paper' });
});
