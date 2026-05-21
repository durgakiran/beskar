/**
 * E2E: Phase 3 — Interactive Canvas (tools, undo/redo)
 *
 * Drives the Phase3Demo canvas:
 *  - B key switches to BoxTool, drag draws a box
 *  - S key switches to SelectTool
 *  - Undo button removes the drawn box
 *  - Redo button re-adds it
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 3 interactive canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#phase3');
    await page.waitForSelector('#canvas-phase3', { timeout: 10_000 });
  });

  test('draw box with BoxTool, undo removes it, redo re-adds it', async ({ page }) => {
    const canvas = page.locator('#canvas-phase3');

    // Switch to BoxTool
    await page.keyboard.press('b');
    await expect(page.locator('#current-tool-display')).toContainText('box');

    // Drag to draw a box
    const box = await canvas.boundingBox();
    const cx = box!.x + 200;
    const cy = box!.y + 200;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 80, { steps: 10 });
    await page.mouse.up();

    // Shape count should be 1
    await expect(page.locator('#shape-count-display')).toContainText('1');

    // Undo
    await page.click('#btn-undo');
    await expect(page.locator('#shape-count-display')).toContainText('0');

    // Redo
    await page.click('#btn-redo');
    await expect(page.locator('#shape-count-display')).toContainText('1');
  });

  test('SelectTool click selects shape', async ({ page }) => {
    const canvas = page.locator('#canvas-phase3');

    // Draw a box first
    await page.keyboard.press('b');
    const box = await canvas.boundingBox();
    const cx = box!.x + 100;
    const cy = box!.y + 100;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 });
    await page.mouse.up();

    // Switch to SelectTool and click shape
    await page.keyboard.press('s');
    await expect(page.locator('#current-tool-display')).toContainText('select');
    await page.mouse.click(cx + 40, cy + 30);

    await expect(page.locator('#selection-count-display')).toContainText('1');
  });

  test('Escape during BoxTool draw cancels shape', async ({ page }) => {
    const canvas = page.locator('#canvas-phase3');
    await page.keyboard.press('b');
    const box = await canvas.boundingBox();
    const cx = box!.x + 300;
    const cy = box!.y + 150;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 80, cy + 60, { steps: 8 });
    // Escape before releasing
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.locator('#shape-count-display')).toContainText('0');
  });
});
