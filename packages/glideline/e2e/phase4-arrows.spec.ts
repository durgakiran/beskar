/**
 * E2E: Phase 4 — Arrow routing interactive canvas
 *
 * Tests:
 *  - Draw two boxes, connect with ArrowTool → arrow appears
 *  - In-browser spec runner → all T4.x tests pass
 *  - Route style toggle switches between curve/ortho
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 4 arrow canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#phase4');
    await page.waitForSelector('#canvas-phase4', { timeout: 10_000 });
  });

  test('in-browser spec runner: all Phase 4 tests pass', async ({ page }) => {
    await page.click('#btn-run-phase4-tests');
    await page.waitForSelector('[data-testid="phase4-summary"]', { timeout: 5_000 });

    const summary = page.locator('[data-testid="phase4-summary"]');
    // All results should have data-ok="true"
    const failing = page.locator('[data-testid^="phase4-result-"][data-ok="false"]');
    const failCount = await failing.count();

    if (failCount > 0) {
      // Print failing test names for diagnostics
      const names = await failing.allTextContents();
      console.log('Failing tests:', names);
    }
    expect(failCount).toBe(0);
    await expect(summary).toContainText('passing');
  });

  test('ArrowTool: draw two boxes, connect with arrow', async ({ page }) => {
    const canvas = page.locator('#canvas-phase4');

    // Add sample boxes via button
    await page.click('button:has-text("Sample Boxes")');

    // Check two boxes exist
    await expect(page.locator('#p4-shape-count')).toContainText('2');

    // Switch to ArrowTool
    await page.click('#btn-arrow-tool');
    await expect(page.locator('#p4-tool')).toContainText('arrow');

    // Draw arrow from left box to right box
    const box = await canvas.boundingBox();
    const cx = box!.x;
    const cy = box!.y;

    // Click on left box center (~120, 220)
    await page.mouse.move(cx + 120, cy + 220);
    await page.mouse.down();
    await page.mouse.move(cx + 500, cy + 220, { steps: 10 });
    await page.mouse.up();

    // Shape count should now include the arrow (3 total)
    await expect(page.locator('#p4-shape-count')).toContainText('3');
  });

  test('route style toggle switches label', async ({ page }) => {
    const routeBtn = page.locator('#btn-route-style');
    await expect(routeBtn).toContainText('Curve');
    await routeBtn.click();
    await expect(routeBtn).toContainText('Ortho');
    await routeBtn.click();
    await expect(routeBtn).toContainText('Curve');
  });

  test('Escape during ArrowTool cancels preview', async ({ page }) => {
    const canvas = page.locator('#canvas-phase4');
    await page.click('#btn-arrow-tool');

    const box = await canvas.boundingBox();
    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 400, box!.y + 200, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // No shape should have been committed (count stays 0)
    await expect(page.locator('#p4-shape-count')).toContainText('0');
  });
});
