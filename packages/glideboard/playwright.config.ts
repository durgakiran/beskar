import { defineConfig, devices } from '@playwright/test';

const externalServer = process.env.GLIDEBOARD_PLAYWRIGHT_EXTERNAL_SERVER === '1';
const port = Number(process.env.GLIDEBOARD_PLAYWRIGHT_PORT ?? (externalServer ? 7153 : 4174));

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'phase3-security.spec.ts',
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
  webServer: externalServer ? undefined : {
    command: `PATH=/opt/homebrew/bin:$PATH npm run dev -- --force --host 127.0.0.1 --port ${port}`,
    cwd: '../glideline-demo',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
