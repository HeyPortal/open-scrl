import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SCRL_E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;
const browserDevices = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};
const browsers = (process.env.SCRL_E2E_BROWSERS ?? 'chromium').split(',');

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/pwa/**',
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: browsers.map((name) => {
    if (!(name in browserDevices)) throw new Error(`Unsupported SCRL_E2E_BROWSERS value: ${name}`);
    return { name, use: { ...browserDevices[name as keyof typeof browserDevices] } };
  }),
});
