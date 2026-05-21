/**
 * E2E: Phase 3 — Spec Test Runner (FSM + History badges)
 *
 * Navigates to Phase3Demo, clicks "Run Spec Tests",
 * waits for all badges to turn green.
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 3 spec tests — browser runner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#phase3');
    await page.waitForSelector('#btn-run-phase3-tests', { timeout: 10_000 });
  });

  test('all spec badges pass after clicking Run Tests', async ({ page }) => {
    await page.click('#btn-run-phase3-tests');

    // Wait for summary badge to appear
    const summary = page.locator('[data-testid="phase3-summary"]');
    await expect(summary).toBeVisible({ timeout: 15_000 });

    // Summary must show no failures
    const text = await summary.textContent();
    expect(text).toMatch(/\d+\/\d+ passing/);
    expect(text).not.toMatch(/\b0\//); // not 0/N

    // All individual result rows must be green (ok)
    const failRows = page.locator('[data-testid^="phase3-result-"][data-ok="false"]');
    await expect(failRows).toHaveCount(0);
  });

  test('page displays Phase 3 demo heading', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Phase 3');
  });
});
