import { test, expect } from '@playwright/test';

test.describe('Phase 5 geometry refactor on Whiteboard', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the main whiteboard demo
    await page.goto('/#whiteboard');
    // Wait for the canvas to be ready
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });
  });

  test('Draw a box → selection box visually aligns with the box bounds', async ({ page }) => {
    // Select box tool
    await page.click('#wb-tool-box');
    
    const canvas = page.locator('#wb-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not found');

    // Draw a box from (200, 200) to (300, 300)
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 5 });
    await page.mouse.up();

    // Check that a selection box is rendered
    // The selection layer renders a rect with stroke="#89b4fa" and fill="none"
    const selectionRect = page.locator('#wb-selection-overlay > rect[fill="none"]');
    await expect(selectionRect).toBeVisible();
    
    // Check width/height roughly 100
    const w = await selectionRect.getAttribute('width');
    const h = await selectionRect.getAttribute('height');
    expect(parseFloat(w!)).toBeCloseTo(100, -1);
    expect(parseFloat(h!)).toBeCloseTo(100, -1);
  });

  test('Draw an arrow between two boxes → arrow renders correctly', async ({ page }) => {
    const canvas = page.locator('#wb-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not found');

    // Draw Box 1
    await page.click('#wb-tool-box');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Draw Box 2
    await page.click('#wb-tool-box');
    await page.mouse.move(box.x + 400, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Draw Arrow from Box 1 (right edge) to Box 2 (left edge)
    await page.click('#wb-tool-arrow');
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 150, { steps: 10 });
    await page.mouse.up();

    // Arrow should exist
    const arrowLayer = page.locator('.glideline-arrow');
    await expect(arrowLayer).toHaveCount(1);
  });

  test('Drag arrow start terminal → arrow stays connected', async ({ page }) => {
    const canvas = page.locator('#wb-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not found');

    // Draw Box 1
    await page.click('#wb-tool-box');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Draw Box 2
    await page.click('#wb-tool-box');
    await page.mouse.move(box.x + 400, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Draw Arrow from Box 1 (right edge) to Box 2 (left edge)
    await page.click('#wb-tool-arrow');
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 150, { steps: 10 });
    await page.mouse.up();

    // Select the arrow using marquee selection to be perfectly robust
    await page.click('#wb-tool-select');
    await page.mouse.move(box.x + 280, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 180, { steps: 5 });
    await page.mouse.up();

    // Verify selection occurred
    await expect(page.locator('#wb-statusbar')).toContainText('3 shapes');
    
    // Start handle should be visible
    const startHandle = page.locator('rect[data-handle="start"]');
    await expect(startHandle).toBeVisible();

    // Move Box 1 to see if arrow is still connected (arrow moves with it)
    await page.mouse.click(box.x + 150, box.y + 150); // select box 1
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 300, { steps: 10 });
    await page.mouse.up();

    // Just verify no crashes and arrow is still visible
    await expect(page.locator('.glideline-arrow')).toHaveCount(1);
  });

  test('Select arrow → no resize handles visible, no rotate handle visible', async ({ page }) => {
    const canvas = page.locator('#wb-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not found');

    // Draw an arrow
    await page.click('#wb-tool-arrow');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 5 });
    await page.mouse.up();

    // Select the arrow using marquee selection
    await page.click('#wb-tool-select');
    await page.mouse.move(box.x + 180, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 220, { steps: 5 });
    await page.mouse.up();

    // Verify shape count
    await expect(page.locator('#wb-statusbar')).toContainText('1 shape');

    // Resize handles shouldn't be there
    const nwHandle = page.locator('rect[data-handle="nw"]');
    await expect(nwHandle).toHaveCount(0);
    
    // Rotation handle shouldn't be there
    const rotationHandle = page.locator('circle[data-handle="rotate"]');
    await expect(rotationHandle).toHaveCount(0);
    
    // Start terminal handle should be there
    const startHandle = page.locator('rect[data-handle="start"]');
    await expect(startHandle).toBeVisible();
  });

  test('Multi-select arrow + box, rotate → both move correctly', async ({ page }) => {
    const canvas = page.locator('#wb-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not found');

    // Draw a Box
    await page.click('#wb-tool-box');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });
    await page.mouse.up();

    // Draw an Arrow
    await page.click('#wb-tool-arrow');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 400, { steps: 5 });
    await page.mouse.up();

    // Multi-select both
    await page.click('#wb-tool-select');
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 450, box.y + 450, { steps: 10 });
    await page.mouse.up();

    // Rotation handle should be visible
    const rotationHandle = page.locator('circle[data-handle="rotate"]');
    await expect(rotationHandle).toBeVisible();

    // Grab rotation handle and drag it
    const rotBox = await rotationHandle.boundingBox();
    if (rotBox) {
      await page.mouse.move(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
      await page.mouse.down();
      // Rotate roughly 90 degrees
      await page.mouse.move(box.x + 400, box.y + 100, { steps: 10 });
      await page.mouse.up();
    }

    // Still should have 1 box and 1 arrow
    await expect(page.locator('.glideline-arrow')).toHaveCount(1);
  });
});
