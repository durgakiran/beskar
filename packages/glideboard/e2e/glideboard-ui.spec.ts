import { expect, test } from '@playwright/test';

test.describe('glideboard e2e flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#whiteboard');
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });
  });

  test('creates a rectangle through the toolbar and persists it across reload', async ({ page }) => {
    await page.locator('#wb-tool-shape-picker').click();
    await page.locator('#wb-shape-option-box').click();

    const canvas = page.locator('#wb-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    await page.mouse.move(bounds!.x + 160, bounds!.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 340, bounds!.y + 300, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('[data-shape-id^="box-"]')).toHaveCount(1);
    await expect(page.locator('#wb-statusbar')).toContainText('1 shape');

    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });

    await expect(page.locator('[data-shape-id^="box-"]')).toHaveCount(1);
    await expect(page.locator('#wb-statusbar')).toContainText('1 shape');
  });
});
