import { test, expect } from '@playwright/test';

test('Debug arrow geometry', async ({ page }) => {
  await page.goto('/#whiteboard');
  await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
  const canvas = page.locator('[data-glideboard-role="canvas"]');
  const box = await canvas.boundingBox();

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

  // Draw Arrow
  await page.click('#wb-tool-arrow');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 150, { steps: 10 });
  await page.mouse.up();

  // Log shapes
  const shapes = await page.evaluate(() => {
    // @ts-ignore
    const ed = window.__GLIDELINE_EDITOR__; // Wait, is wbEditor exposed?
    // Let's grab shapes from DOM instead
    return Array.from(document.querySelectorAll('g[data-shape-id]')).map(g => ({
      id: g.getAttribute('data-shape-id'),
      transform: g.getAttribute('transform'),
      html: g.innerHTML
    }));
  });
  console.log(JSON.stringify(shapes, null, 2));
});
