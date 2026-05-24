import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.GLIDEBOARD_PLAYWRIGHT_PORT ?? 4174);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `PATH=/opt/homebrew/bin:$PATH npm run dev -- --force --host 127.0.0.1 --port ${port}`,
    cwd: '../glideline-demo',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
