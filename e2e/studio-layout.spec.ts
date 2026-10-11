import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const shots = '/tmp/redesign-shots/studio';

async function screenshot(page: Page, name: string) {
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
}

/** A full-size image exercises decoding, thumbnails and export without external media. */
async function importArtwork(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 900;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 1200, 900);
    gradient.addColorStop(0, '#132a3d'); gradient.addColorStop(1, '#efb28b');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = '#f5d4b7'; ctx.beginPath(); ctx.arc(920, 230, 115, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#284b52'; ctx.beginPath(); ctx.moveTo(0, 680); ctx.lineTo(400, 270); ctx.lineTo(800, 900); ctx.lineTo(0, 900); ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'studio-landscape.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect(page.getByAltText('studio-landscape.png')).toBeVisible();
  await page.getByAltText('studio-landscape.png').click();
}

async function selectedCentre(page: Page) {
  return page.evaluate(async () => {
    const sessionPath = '/src/editor/sessionStore.ts';
    const { useEditorSession } = await import(sessionPath) as typeof import('../src/editor/sessionStore');
    const editorPath = '/src/store/editor.ts';
    const { useEditor } = await import(editorPath) as typeof import('../src/store/editor');
    const { selectedLayerId } = useEditorSession.getState();
    const { doc } = useEditor.getState();
    if (!selectedLayerId || !doc.layers[selectedLayerId]) throw new Error('Select a layer before dragging');
    const Konva = (window as unknown as { Konva: typeof import('konva').default }).Konva;
    const stage = Konva.stages[0];
    const bounds = stage.findOne(`#${selectedLayerId}`)!.getClientRect();
    const frame = stage.container().getBoundingClientRect();
    return { x: frame.x + bounds.x + bounds.width / 2, y: frame.y + bounds.y + bounds.height / 2 };
  });
}

test.describe('Studio desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('floating islands keep editing, ordering, preview and export reachable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?style=classic');
    await expect(page.getByLabel('Design style')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-style');
    await screenshot(page, 'desktop-home');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
    await expect(page.locator('.studio-stage .konvajs-content')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Slide timeline' })).toBeVisible();
    await screenshot(page, 'desktop-editor-empty');

    await importArtwork(page);
    await expect(page.locator('.studio-inspector')).toBeVisible();
    await page.getByLabel('Crop zoom').fill('1.2');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('button', { name: 'Add text box' }).click();
    await page.getByLabel('Text content').fill('Studio field notes');
    await page.getByLabel('X position').fill('140');
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.getByLabel('X position').fill('180');
    await page.getByLabel('Y position').fill('840');
    await expect(page.locator('.studio-selection-toolbar')).toBeVisible();
    const point = await selectedCentre(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y - 20, { steps: 5 });
    await expect(page.locator('.studio-selection-toolbar')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.studio-selection-toolbar')).toBeVisible();
    await screenshot(page, 'desktop-editor-selected');

    await page.getByRole('button', { name: 'Add slide', exact: true }).click();
    await page.getByRole('button', { name: 'Grids', exact: true }).click();
    await page.getByTitle('Apply “2 × 2” grid', { exact: true }).click();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(page.locator('.studio-inspector-content').getByRole('button', { name: 'Photo 4', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Move slide left', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Slide 1', exact: true })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Duplicate slide', exact: true }).click();
    await page.getByRole('button', { name: 'Delete slide', exact: true }).click();
    await page.getByLabel('Canvas format').selectOption('IG Square');
    await page.getByRole('button', { name: 'Wide view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Wide view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Carousel', exact: true }).click();
    await page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('button', { name: 'Export carousel', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    expect(errors).toEqual([]);
  });

  test('the library card glides open and closed while the canvas frame follows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await expect(page.locator('.studio-left-panel')).toHaveCount(0);
    const stageWidth = () => page.locator('.studio-stage').evaluate((element) => element.getBoundingClientRect().width);
    const closedWidth = await stageWidth();
    // Sample the canvas frame every animation frame while the card opens.
    const widths = await page.evaluate(async () => {
      const stage = document.querySelector('.studio-stage')!;
      const seen: number[] = [];
      document.querySelector<HTMLButtonElement>('[aria-label="Grids"]')!.click();
      const start = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => { seen.push(Math.round(stage.getBoundingClientRect().width)); if (performance.now() - start < 500) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
      });
      return seen;
    });
    const openWidth = widths.at(-1)!;
    expect(openWidth).toBeLessThan(closedWidth - 200);
    expect(new Set(widths.filter((width) => width < closedWidth - 1 && width > openWidth + 1)).size).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < widths.length; index++) expect(widths[index]).toBeLessThanOrEqual(widths[index - 1]);

    await page.getByRole('button', { name: 'Hide side panel', exact: true }).click();
    // While it animates closed the card is inert and hidden from assistive technology.
    await expect(page.getByRole('button', { name: 'Hide side panel', exact: true })).toHaveCount(0);
    await expect(page.locator('.studio-left-panel')).toHaveCount(0);
    await expect.poll(stageWidth).toBeCloseTo(closedWidth, 0);
  });

  test('tool cards toggle, escape closes, and fit reserves panel and timeline space', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await expect(page.locator('.studio-left-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Grids', exact: true }).click();
    await expect(page.locator('.studio-left-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.studio-left-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Slide design', exact: true }).click();
    await expect(page.locator('.studio-inspector')).toBeVisible();
    const stage = await page.locator('.studio-stage').boundingBox();
    const inspector = await page.locator('.studio-inspector').boundingBox();
    const timeline = await page.locator('.studio-timeline').boundingBox();
    expect(stage!.x + stage!.width).toBeLessThanOrEqual(inspector!.x);
    expect(stage!.y + stage!.height).toBeLessThanOrEqual(timeline!.y);
    await page.getByRole('button', { name: 'Command palette', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });
});

test.describe('Studio phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('glass chrome retains import, text, selection, slide actions and export', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.studio-mobile-home')).toBeVisible();
    await screenshot(page, 'mobile-home');
    await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
    await expect(page.locator('.studio-mobile-shell .konvajs-content')).toBeVisible();
    await screenshot(page, 'mobile-editor');
    const tools = page.getByRole('tablist', { name: 'Editor tools' });
    await tools.getByRole('tab', { name: 'Photos', exact: true }).tap();
    await importArtwork(page);
    await page.getByRole('button', { name: 'Close Photos', exact: true }).tap();
    const selection = page.getByRole('toolbar', { name: 'Selection actions' });
    await expect(selection).toBeVisible();
    await selection.getByRole('button', { name: 'Edit', exact: true }).tap();
    await expect(page.getByRole('region', { name: 'Photo', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close Photo', exact: true }).tap();
    await selection.getByRole('button', { name: 'Done', exact: true }).tap();
    await tools.getByRole('tab', { name: 'Text', exact: true }).tap();
    await page.getByRole('button', { name: 'Add text box' }).tap();
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    await selection.getByRole('button', { name: 'Edit', exact: true }).tap();
    await page.getByLabel('Text content').fill('Studio on the go');
    await page.getByRole('button', { name: 'Close Text', exact: true }).tap();
    await screenshot(page, 'mobile-editor-selected');
    await selection.getByRole('button', { name: 'Done', exact: true }).tap();
    await tools.getByRole('tab', { name: 'Shapes', exact: true }).tap();
    await page.getByRole('region', { name: 'Shapes', exact: true }).getByRole('button', { name: 'Rectangle', exact: true }).tap();
    await page.getByRole('button', { name: 'Close Shapes', exact: true }).tap();
    await selection.getByRole('button', { name: 'Done', exact: true }).tap();
    await page.getByRole('button', { name: 'Add slide', exact: true }).tap();
    await tools.getByRole('tab', { name: 'Grids', exact: true }).tap();
    await page.getByTitle('Apply “2 × 2” grid', { exact: true }).tap();
    await page.getByRole('button', { name: 'Close Grids', exact: true }).tap();
    await page.getByRole('button', { name: 'Slide 2, selected. Tap for slide actions', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Move left', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Slide 1, selected. Tap for slide actions', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Project settings:/ }).tap();
    await page.getByRole('radio', { name: /IG Square/ }).tap();
    await expect(page.getByLabel('Design style')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close Project', exact: true }).tap();
    await page.getByRole('button', { name: 'Export', exact: true }).tap();
    await page.getByRole('button', { name: /Preview on phone/ }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Export', exact: true }).tap();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export carousel/ }).tap();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    expect(errors).toEqual([]);
  });
});
