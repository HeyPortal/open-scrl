import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PWA_PORT ?? 5187);
const basePath = process.env.SCRL_BASE_PATH ?? '/';
const baseURL = `http://127.0.0.1:${port}${basePath}`;
const suite = basePath === '/' ? 'pwa' : 'pwa-pages';
export default defineConfig({
  testDir: './e2e/pwa',
  testMatch: '**/*.pwa.ts',
  workers: 1,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: 0,
  outputDir: `./test-results/${suite}`,
  reporter: [
    [process.env.CI ? 'dot' : 'list'],
    ['html', { outputFolder: `playwright-report/${suite}`, open: 'never' }],
  ],
  timeout: 45_000,
  webServer: {
    command: 'bun run build && bun scripts/serve-pwa-test.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', contextOptions: { reducedMotion: 'no-preference' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
