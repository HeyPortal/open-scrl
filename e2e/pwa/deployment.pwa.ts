import { expect, test } from '../fixtures/test';

test('opens the editor and installs the PWA within its hosting path', async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL!;
  const basePath = new URL(baseURL).pathname;
  await page.goto('./');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toBeVisible();

  const logo = page.locator('img[src$="app-icon.png"]').first();
  expect(await logo.getAttribute('src')).toBe(`${basePath}app-icon.png`);
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const manifestURL = new URL(await page.locator('link[rel="manifest"]').getAttribute('href') ?? '', page.url());
  expect(manifestURL.pathname).toBe(`${basePath}manifest.webmanifest`);
  const response = await page.request.get(manifestURL.href);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.start_url).toBe(basePath);
  expect(manifest.scope).toBe(basePath);
  for (const icon of manifest.icons as { src: string }[]) {
    const url = new URL(icon.src, manifestURL);
    expect(url.pathname.startsWith(basePath)).toBe(true);
    const image = await page.request.get(url.href);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toBe('image/png');
  }
  for (const selector of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
    const url = new URL(await page.locator(selector).getAttribute('href') ?? '', page.url());
    expect(url.pathname.startsWith(basePath)).toBe(true);
    expect((await page.request.get(url.href)).ok()).toBe(true);
  }
  const registration = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready;
    return { scope: worker.scope, scriptURL: worker.active?.scriptURL };
  });
  expect(registration.scope).toBe(baseURL);
  expect(registration.scriptURL).toBe(`${baseURL}sw.js`);
});
