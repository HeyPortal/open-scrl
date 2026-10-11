import { expect, test, type CDPSession, type Page } from './fixtures/test';

type HapticWindow = Window & { hapticCalls: (number | number[])[] };

async function create(page: Page, supported = true) {
  await page.addInitScript((supported) => {
    const host = window as unknown as HapticWindow;
    host.hapticCalls = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: supported ? (pattern: number | number[]) => {
      if (pattern !== 0) host.hapticCalls.push(pattern);
      return true;
    } : undefined });
  }, supported);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create carousel', exact: true }).tap();
  await expect(page.locator('.konvajs-content')).toBeVisible();
  await clear(page);
}

async function clear(page: Page) {
  await page.evaluate(async () => {
    const path = '/src/lib/mobileHaptics.ts';
    const { cancelMobileHaptics } = await import(path) as typeof import('../src/lib/mobileHaptics');
    cancelMobileHaptics();
    (window as unknown as HapticWindow).hapticCalls = [];
  });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as HapticWindow).hapticCalls);
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

test.describe('mobile web-haptics integration', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('ticks once at the swipe threshold, confirms addition, and distinguishes undo and redo', async ({ page }) => {
    await create(page);
    const cdp = await page.context().newCDPSession(page);
    const box = (await page.locator('.konvajs-content').boundingBox())!;
    const point = { x: box.x + 300, y: box.y + 24, id: 1 };
    await touch(cdp, 'touchStart', [point]);
    await touch(cdp, 'touchMove', [{ ...point, x: point.x - 30 }]);
    expect(await calls(page)).toHaveLength(0);
    await touch(cdp, 'touchMove', [{ ...point, x: point.x - 150 }]);
    await expect(page.getByTestId('slide-append-hint')).toHaveText('Release to add slide');
    expect(await calls(page)).toHaveLength(1);
    const ready = (await calls(page))[0];
    for (const travel of [160, 165, 170]) await touch(cdp, 'touchMove', [{ ...point, x: point.x - travel }]);
    expect(await calls(page)).toHaveLength(1);
    await touch(cdp, 'touchEnd', []);
    await expect(page.getByRole('button', { name: 'Slide 2, selected. Tap for slide actions', exact: true })).toBeVisible();
    expect(await calls(page)).toHaveLength(2);
    const confirmed = (await calls(page))[1];
    expect(confirmed).not.toEqual(ready);
    await clear(page);
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    expect(await calls(page)).toHaveLength(1);
    const history = (await calls(page))[0];
    expect(history).not.toEqual(confirmed);
    await clear(page);
    await page.getByRole('button', { name: 'Redo', exact: true }).tap();
    expect(await calls(page)).toEqual([history]);
    await cdp.detach();
  });

  test('saves the opt-out across reload and resumes feedback when enabled', async ({ page }) => {
    await create(page);
    await page.getByRole('button', { name: /^Project settings:/ }).tap();
    const toggle = page.getByRole('switch', { name: 'Haptics', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Close Project', exact: true }).tap();
    await clear(page);
    await page.getByRole('button', { name: 'Add slide', exact: true }).tap();
    expect(await calls(page)).toEqual([]);
    await page.getByRole('button', { name: 'Projects', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Open Untitled', exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Open Untitled', exact: true }).tap();
    await expect(page.locator('.konvajs-content')).toBeVisible();
    await page.getByRole('button', { name: /^Project settings:/ }).tap();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await clear(page);
    await toggle.tap();
    expect(await calls(page)).toHaveLength(1);
    await page.getByRole('button', { name: 'Close Project', exact: true }).tap();
    await clear(page);
    await page.getByRole('button', { name: 'Add slide', exact: true }).tap();
    expect(await calls(page)).toHaveLength(1);
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('.mobile-root')).toHaveCount(0);
    await clear(page);
    await page.evaluate(async () => {
      const path = '/src/lib/mobileHaptics.ts';
      const { mobileHaptic } = await import(path) as typeof import('../src/lib/mobileHaptics');
      mobileHaptic('confirm');
    });
    expect(await calls(page)).toEqual([]);
  });

  test('uses the library fallback when Vibration API is absent without affecting editing', async ({ page }) => {
    await create(page, false);
    await page.getByRole('button', { name: 'Add slide', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Slide 2, selected. Tap for slide actions', exact: true })).toBeVisible();
    await expect(page.locator('input[switch]')).toHaveCount(1);
    await expect(page.locator('input[switch]')).toBeHidden();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Slide 1, selected. Tap for slide actions', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('.mobile-root')).toHaveCount(0);
    await expect(page.locator('input[switch]')).toHaveCount(0);
  });
});
