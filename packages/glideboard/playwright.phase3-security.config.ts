import { defineConfig, devices } from '@playwright/test';

const required = [
  'P3_SECURITY_BASE_URL',
  'P3_SECURITY_BOARD_PATH',
  'P3_SECURITY_TENANT_A_STORAGE_STATE',
  'P3_SECURITY_TENANT_A_SUBJECT',
  'P3_SECURITY_TENANT_A_TENANT_ID',
  'P3_SECURITY_TENANT_B_STORAGE_STATE',
  'P3_SECURITY_TENANT_B_SUBJECT',
  'P3_SECURITY_TENANT_B_TENANT_ID',
  'P3_SECURITY_TENANT_B_ASSET_URL',
  'P3_SECURITY_TENANT_B_ASSET_SHA256',
  'P3_SECURITY_IDENTITY_URL',
  'P3_SECURITY_IDENTITY_SUBJECT_PATH',
  'P3_SECURITY_IDENTITY_TENANT_PATH',
  'P3_SECURITY_MEDIA_URL_PATTERN',
  'P3_SECURITY_ALLOWED_ORIGINS',
] as const;

for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Phase 3 security topology missing ${name}`);
}

const baseURL = new URL(process.env.P3_SECURITY_BASE_URL!);
if (['localhost', '127.0.0.1', '::1'].includes(baseURL.hostname)) {
  throw new Error('P3_SECURITY_BASE_URL must be a deployed non-loopback origin');
}
if (process.env.P3_SECURITY_TENANT_A_SUBJECT === process.env.P3_SECURITY_TENANT_B_SUBJECT) {
  throw new Error('Phase 3 security topology requires distinct tenant A and tenant B subjects');
}
if (process.env.P3_SECURITY_TENANT_A_TENANT_ID === process.env.P3_SECURITY_TENANT_B_TENANT_ID) {
  throw new Error('Phase 3 security topology requires distinct authenticated tenant claims');
}
if (!/^[0-9a-f]{64}$/.test(process.env.P3_SECURITY_TENANT_B_ASSET_SHA256!)) {
  throw new Error('P3_SECURITY_TENANT_B_ASSET_SHA256 must be a lowercase SHA-256 digest');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phase3-security.spec.ts',
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: baseURL.toString(),
    storageState: process.env.P3_SECURITY_TENANT_A_STORAGE_STATE,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-security', use: { ...devices['Desktop Chrome'] } }],
});
