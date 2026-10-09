import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PWA_PORT ?? 5187);
export default defineConfig({
  testDir: './e2e/pwa',
  testMatch: '**/*.pwa.ts',
  workers: 1,
  timeout: 45_000,
  webServer: {
    command: 'npm run build && node scripts/serve-pwa-test.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
