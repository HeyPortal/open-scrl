import { expect, test } from '@playwright/test';
test('narrow screens can switch panels and return to the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.getByRole('button', { name: /create.*open editor/i }).click();
  await expect(page.locator('.editor-left-panel')).toBeHidden();
  await expect(page.locator('.editor-right-panel')).toBeHidden();
  await page.getByRole('group', { name: 'Workspace panels' }).getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(page.locator('.editor-left-panel')).toBeVisible();
  await page.screenshot({ path: 'docs/images/web-mobile-editor.png' });
  await page.getByRole('button', { name: 'Photo settings', exact: true }).click();
  await expect(page.locator('.editor-right-panel')).toBeVisible();
  await expect(page.locator('.editor-left-panel')).toBeHidden();
  await page.getByRole('group', { name: 'Workspace panels' }).getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.locator('.editor-right-panel')).toBeHidden();
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-mobile-pane', 'canvas');
});
