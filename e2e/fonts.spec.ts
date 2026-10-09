import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile fonts' : 'desktop fonts', () => {
    test.use({ viewport: mobile ? { width: 393, height: 852 } : { width: 1280, height: 800 } });

    test('UI waits for Inter and the font selector uses the bundled face', async ({ page }) => {
      let release!: () => void;
      const fontGate = new Promise<void>((resolve) => { release = resolve; });
      let requested!: () => void;
      const fontRequested = new Promise<void>((resolve) => { requested = resolve; });
      await page.route('**/inter-latin-wght-normal.woff2', async (route) => {
        requested();
        await fontGate;
        await route.continue();
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await fontRequested;
      const create = page.getByRole('button', { name: mobile ? 'Create carousel' : 'Create & open editor', exact: true });
      try {
        await expect(create).toHaveCount(0);
      } finally {
        release();
      }
      await expect(create).toBeVisible();

      // Check the actual glyph source, rather than only the declared CSS family.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: mobile ? '.mobile-home button[type="submit"]' : 'button.btn-primary' });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(fonts.some((font) => font.isCustomFont && /Inter/.test(font.familyName) && font.glyphCount > 0)).toBe(true);
      await cdp.detach();

      await create.click();
      await expect(page.locator('.konvajs-content')).toBeVisible();
      if (mobile) {
        await page.getByRole('tab', { name: 'Text', exact: true }).click();
        await page.getByRole('button', { name: 'Add text box' }).click();
        await page.getByRole('button', { name: 'Close Text', exact: true }).click();
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
      } else {
        await page.getByTitle('Text', { exact: true }).click();
        await page.getByRole('button', { name: 'Add text box' }).click();
      }
      await expect(page.getByRole('combobox', { name: 'Font', exact: true })).toHaveCSS('font-family', '"Inter Variable"');
    });
  });
}

test('Inter canvas rendering and worker exports match for normal and italic text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create & open editor', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toBeVisible();
  const results = await page.evaluate(async () => {
    const editorPath = '/src/editor/documentStore.ts';
    const renderPath = '/src/export/canvas2d/render.ts';
    const exportPath = '/src/export/ExportController.ts';
    const textPath = '/src/render/paint/text.ts';
    const { useDocumentStore } = await import(editorPath) as typeof import('../src/editor/documentStore');
    const { renderSlides } = await import(renderPath) as typeof import('../src/export/canvas2d/render');
    const { renderProjectSlides } = await import(exportPath) as typeof import('../src/export/ExportController');
    const { textFont } = await import(textPath) as typeof import('../src/render/paint/text');
    useDocumentStore.getState().addTextLayer('Hamburgefontsiv Āé 0123456789');
    const layer = Object.values(useDocumentStore.getState().doc.layers).find((item) => item.kind === 'text')!;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = textFont({ fontFamily: 'Inter', fontWeight: 400, italic: false }, 32);
    const interWidth = ctx.measureText('Hamburgefontsiv').width;
    ctx.font = '400 32px Arial';
    const fallbackWidth = ctx.measureText('Hamburgefontsiv').width;
    const hash = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const matches = [];
    for (const italic of [false, true]) {
      useDocumentStore.getState().updateLayer(layer.id, { italic });
      const doc = useDocumentStore.getState().doc;
      const options = { format: 'png' as const, quality: 1, pixelRatio: 1 };
      const [main] = await renderSlides(doc, [0], async () => undefined, (w, h) => new OffscreenCanvas(w, h), options);
      const [worker] = await renderProjectSlides(doc, [0], options);
      matches.push({ italic, main: await hash(main), worker: await hash(worker) });
    }
    return { interWidth, fallbackWidth, matches };
  });
  expect(results.interWidth).not.toBe(results.fallbackWidth);
  for (const result of results.matches) expect(result.worker, `${result.italic ? 'Italic' : 'Normal'} Inter export`).toBe(result.main);
  expect(results.matches[0].main).not.toBe(results.matches[1].main);
});
