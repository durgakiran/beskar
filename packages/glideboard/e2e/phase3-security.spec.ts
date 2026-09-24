import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const allowedOrigins = new Set(
  process.env.P3_SECURITY_ALLOWED_ORIGINS!.split(',').map(value => new URL(value.trim()).origin),
);
const maliciousProbeOrigin = new URL('https://phase3-invalid.example/track.png').origin;
const uploadInputSelector = '[data-glideboard-role="asset-file-input"]';
const uploadRejectionSelector = '[data-glideboard-role="asset-import-rejected"]';
if (allowedOrigins.has(maliciousProbeOrigin)) {
  throw new Error('P3_SECURITY_ALLOWED_ORIGINS must not allow the malicious corpus probe origin');
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

async function assertIdentity(
  request: APIRequestContext,
  expectedSubject: string,
  expectedTenantId: string,
): Promise<void> {
  const response = await request.get(process.env.P3_SECURITY_IDENTITY_URL!);
  expect(response.status(), 'identity probe must authenticate successfully').toBe(200);
  const body: unknown = await response.json();
  expect(readPath(body, process.env.P3_SECURITY_IDENTITY_SUBJECT_PATH!)).toBe(expectedSubject);
  expect(readPath(body, process.env.P3_SECURITY_IDENTITY_TENANT_PATH!)).toBe(expectedTenantId);
}

async function sha256(bytes: Buffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

async function settleAndAssertNoUnexpectedRequests(page: Page, unexpectedRequests: string[]): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);
  expect(unexpectedRequests).toEqual([]);
}

test('malicious SVG reaches terminal rejection without active content or outbound access', async ({ page }) => {
  const unexpectedRequests: string[] = [];
  page.on('request', request => {
    const origin = new URL(request.url()).origin;
    if (!allowedOrigins.has(origin)) unexpectedRequests.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, '__P3_SCRIPT_EXECUTED__', { value: false, writable: true });
  });

  await page.goto(process.env.P3_SECURITY_BOARD_PATH!);
  const activeNodeCount = await page.locator('script, foreignObject').count();
  await expect(page.locator(uploadInputSelector)).toHaveCount(1);
  await expect(page.locator(uploadRejectionSelector)).toHaveCount(0);
  await page.locator(uploadInputSelector).setInputFiles({
    name: 'phase3-malicious.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
        <script>window.__P3_SCRIPT_EXECUTED__ = true</script>
        <image xlink:href="https://phase3-invalid.example/track.png" />
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml" id="p3-injected">injected</div></foreignObject>
        <path onload="window.__P3_SCRIPT_EXECUTED__ = true" d="M0 0L10 10" />
      </svg>
    `),
  });

  await expect(page.locator(uploadInputSelector)).toHaveAttribute('data-asset-import-correlation', /^[0-9a-f-]{36}$/);
  const correlationToken = await page.locator(uploadInputSelector).getAttribute('data-asset-import-correlation');
  expect(correlationToken).toMatch(/^[0-9a-f-]{36}$/);
  const correlatedRejection = page.locator(
    `${uploadRejectionSelector}[data-asset-import-name="phase3-malicious.svg"][data-asset-import-correlation="${correlationToken}"]`,
  );
  await expect(correlatedRejection).toBeVisible();
  await expect(page.locator(`${uploadRejectionSelector}:not([data-asset-import-correlation])`)).toHaveCount(0);
  await settleAndAssertNoUnexpectedRequests(page, unexpectedRequests);
  expect(await page.evaluate(() => (window as Window & { __P3_SCRIPT_EXECUTED__?: boolean }).__P3_SCRIPT_EXECUTED__)).toBe(false);
  await expect(page.locator('#p3-injected')).toHaveCount(0);
  await expect(page.locator('script, foreignObject')).toHaveCount(activeNodeCount);
});

test('media is sandboxed and authenticated tenant A cannot read a proven tenant B fixture', async ({ page, playwright }) => {
  const tenantA = await playwright.request.newContext({
    baseURL: process.env.P3_SECURITY_BASE_URL,
    storageState: process.env.P3_SECURITY_TENANT_A_STORAGE_STATE,
  });
  const tenantB = await playwright.request.newContext({
    baseURL: process.env.P3_SECURITY_BASE_URL,
    storageState: process.env.P3_SECURITY_TENANT_B_STORAGE_STATE,
  });

  try {
    await assertIdentity(
      tenantA,
      process.env.P3_SECURITY_TENANT_A_SUBJECT!,
      process.env.P3_SECURITY_TENANT_A_TENANT_ID!,
    );
    await assertIdentity(
      tenantB,
      process.env.P3_SECURITY_TENANT_B_SUBJECT!,
      process.env.P3_SECURITY_TENANT_B_TENANT_ID!,
    );
    expect(process.env.P3_SECURITY_TENANT_A_TENANT_ID)
      .not.toBe(process.env.P3_SECURITY_TENANT_B_TENANT_ID);

    const fixture = await tenantB.get(process.env.P3_SECURITY_TENANT_B_ASSET_URL!);
    expect(fixture.status(), 'tenant B must be able to read its fixture').toBe(200);
    expect(fixture.headers()['content-type'] ?? '').toMatch(/^image\/(?:png|jpeg|webp)$/);
    const fixtureBytes = await fixture.body();
    expect(fixtureBytes.byteLength, 'tenant B fixture must contain bytes').toBeGreaterThan(0);
    expect(await sha256(fixtureBytes), 'tenant B must own the configured immutable fixture')
      .toBe(process.env.P3_SECURITY_TENANT_B_ASSET_SHA256);

    const mediaResponse = page.waitForResponse(process.env.P3_SECURITY_MEDIA_URL_PATTERN!);
    await page.goto(process.env.P3_SECURITY_BOARD_PATH!);
    const response = await mediaResponse;
    expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers()['x-content-type-options']).toBe('nosniff');

    const crossTenant = await tenantA.get(process.env.P3_SECURITY_TENANT_B_ASSET_URL!);
    expect([403, 404]).toContain(crossTenant.status());
    expect(crossTenant.headers()['content-type'] ?? '').not.toMatch(/^image\//);
  } finally {
    await tenantA.dispose();
    await tenantB.dispose();
  }
});
