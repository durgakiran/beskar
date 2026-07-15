import { expect, test } from '@playwright/test';

test.describe('glideboard e2e flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#whiteboard');
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
  });

  test('creates a rectangle through the toolbar and persists it across reload', async ({ page }) => {
    await page.locator('[data-glideboard-control="shape-picker"]').click();
    await page.locator('[data-glideboard-shape-option="box"]').click();

    const canvas = page.locator('[data-glideboard-role="canvas"]');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    await page.mouse.move(bounds!.x + 160, bounds!.y + 180);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 340, bounds!.y + 300, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('[data-shape-id^="box-"]')).toHaveCount(1);
    await expect(page.locator('[data-glideboard-role="statusbar"]')).toContainText('1 shape');

    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });

    await expect(page.locator('[data-shape-id^="box-"]')).toHaveCount(1);
    await expect(page.locator('[data-glideboard-role="statusbar"]')).toContainText('1 shape');
  });

  test('undo restores a multi-shape drag without deleting the last-created shape', async ({ page }) => {
    const canvas = page.locator('[data-glideboard-role="canvas"]');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    await page.locator('[data-glideboard-control="shape-picker"]').click();
    await page.locator('[data-glideboard-shape-option="box"]').click();
    await page.mouse.move(bounds!.x + 140, bounds!.y + 150);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 260, bounds!.y + 240, { steps: 8 });
    await page.mouse.up();

    await page.locator('[data-glideboard-control="shape-picker"]').click();
    await page.locator('[data-glideboard-shape-option="diamond"]').click();
    await page.mouse.move(bounds!.x + 380, bounds!.y + 170);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 500, bounds!.y + 260, { steps: 8 });
    await page.mouse.up();

    const initial = await page.evaluate(() => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const shapes = api.getAIContext().shapes
        .filter((shape: any) => shape.type === 'box' || shape.type === 'diamond')
        .map((shape: any) => ({ id: shape.id, x: shape.x, y: shape.y }));
      api.select(shapes.map((shape: any) => shape.id));
      return shapes;
    });
    expect(initial).toHaveLength(2);

    const firstShape = page.locator(`[data-shape-id="${initial[0]!.id}"]`);
    const firstBounds = await firstShape.boundingBox();
    expect(firstBounds).not.toBeNull();
    await page.mouse.move(firstBounds!.x + firstBounds!.width / 2, firstBounds!.y + firstBounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstBounds!.x + firstBounds!.width / 2 + 120, firstBounds!.y + firstBounds!.height / 2 + 70, { steps: 10 });
    await page.mouse.up();

    await page.keyboard.press('Control+z');

    const restored = await page.evaluate(() => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().shapes
        .filter((shape: any) => shape.type === 'box' || shape.type === 'diamond')
        .map((shape: any) => ({ id: shape.id, x: shape.x, y: shape.y }));
    });
    expect(restored).toHaveLength(2);
    expect(restored).toEqual(expect.arrayContaining(initial));
  });

  test('redo keeps an ortho arrow visually attached after its target moves', async ({ page }) => {
    const firstId = await page.evaluate(async () => {
      const result = await (window as any).__GLIDELINE_WHITEBOARD__.callTool('create_shape', {
        type: 'box',
        x: 140,
        y: 160,
        w: 140,
        h: 90,
      });
      return result.id as string;
    });

    const canvas = page.locator('[data-glideboard-role="canvas"]');
    const canvasBounds = await canvas.boundingBox();
    expect(canvasBounds).not.toBeNull();
    await page.locator('[data-glideboard-control="shape-picker"]').click();
    await page.locator('[data-glideboard-shape-option="rounded-rect"]').click();
    await page.mouse.move(canvasBounds!.x + 480, canvasBounds!.y + 340);
    await page.mouse.down();
    await page.mouse.move(canvasBounds!.x + 640, canvasBounds!.y + 440, { steps: 8 });
    await page.mouse.up();

    const ids = await page.evaluate(async (sourceId) => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const target = api.getAIContext().shapes.find((shape: any) => shape.type === 'rounded-rect');
      const arrow = await api.callTool('create_connection', {
        fromId: sourceId,
        toId: target.id,
        routeStyle: 'curve',
      });
      api.select([arrow.id]);
      return { targetId: target.id as string, arrowId: arrow.id as string };
    }, firstId);

    await page.getByRole('button', { name: 'Ortho' }).click();

    const target = page.locator(`[data-shape-id="${ids.targetId}"]`);
    const targetBounds = await target.boundingBox();
    expect(targetBounds).not.toBeNull();
    await page.mouse.move(
      targetBounds!.x + targetBounds!.width / 2,
      targetBounds!.y + targetBounds!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBounds!.x + targetBounds!.width / 2 + 80,
      targetBounds!.y + targetBounds!.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => page.evaluate(() => (
      (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().connections[0]?.routeStyle
    ))).toBe('curve');

    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');

    const result = await page.evaluate(({ targetId, arrowId }) => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const shape = api.getAIContext().shapes.find((item: any) => item.id === targetId);
      const points = api.getArrowRoutePoints(arrowId);
      const end = points[points.length - 1];
      const dx = Math.max(shape.x - end.x, 0, end.x - (shape.x + shape.w));
      const dy = Math.max(shape.y - end.y, 0, end.y - (shape.y + shape.h));
      return {
        routeStyle: api.getAIContext().connections[0]?.routeStyle,
        gap: Math.hypot(dx, dy),
      };
    }, ids);

    expect(result.routeStyle).toBe('ortho');
    expect(result.gap).toBeLessThan(1);
  });

  test('resize and rotation each produce one undoable command', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const created = await api.callTool('create_shape', {
        type: 'box',
        x: 220,
        y: 220,
        w: 140,
        h: 90,
      });
      api.select([created.id]);
      return created.id as string;
    });

    const shape = page.locator(`[data-shape-id="${id}"]`);
    const initialBounds = await shape.boundingBox();
    expect(initialBounds).not.toBeNull();

    await page.mouse.move(initialBounds!.x + initialBounds!.width, initialBounds!.y + initialBounds!.height);
    await page.mouse.down();
    await page.mouse.move(initialBounds!.x + initialBounds!.width + 70, initialBounds!.y + initialBounds!.height + 45, { steps: 8 });
    await page.mouse.up();

    const resized = await page.evaluate((shapeId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().shapes
        .find((item: any) => item.id === shapeId);
    }, id);
    expect(resized.w).toBeGreaterThan(140);
    expect(resized.h).toBeGreaterThan(90);

    await page.locator('[data-glideboard-role="app"]').focus();
    await page.keyboard.press('Control+z');
    const restoredSize = await page.evaluate((shapeId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().shapes
        .find((item: any) => item.id === shapeId);
    }, id);
    expect(restoredSize).toMatchObject({ w: 140, h: 90 });

    const restoredBounds = await shape.boundingBox();
    expect(restoredBounds).not.toBeNull();
    const centerX = restoredBounds!.x + restoredBounds!.width / 2;
    const centerY = restoredBounds!.y + restoredBounds!.height / 2;
    await page.mouse.move(centerX, restoredBounds!.y - 20);
    await page.mouse.down();
    await page.mouse.move(restoredBounds!.x + restoredBounds!.width + 20, centerY, { steps: 8 });
    await page.mouse.up();

    const rotated = await page.evaluate((shapeId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().shapes
        .find((item: any) => item.id === shapeId);
    }, id);
    expect(Math.abs(rotated.rotation)).toBeGreaterThan(1);

    await page.keyboard.press('Control+z');
    const restoredRotation = await page.evaluate((shapeId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().shapes
        .find((item: any) => item.id === shapeId);
    }, id);
    expect(restoredRotation.rotation).toBeCloseTo(0);
  });

  test('keyboard delete and cut can both be undone', async ({ page }) => {
    const createSelectedBox = async (x: number, label: string) => page.evaluate(async ({ x, label }) => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const created = await api.callTool('create_shape', { type: 'box', x, y: 180, label });
      api.select([created.id]);
      return created.id as string;
    }, { x, label });

    const deleteId = await createSelectedBox(180, 'delete-me');
    await page.locator('[data-glideboard-role="app"]').focus();
    await page.keyboard.press('Backspace');
    await expect(page.locator(`[data-shape-id="${deleteId}"]`)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator(`[data-shape-id="${deleteId}"]`)).toHaveCount(1);

    const cutId = await createSelectedBox(420, 'cut-me');
    await page.locator('[data-glideboard-role="app"]').focus();
    await page.keyboard.press('Control+x');
    await expect(page.locator(`[data-shape-id="${cutId}"]`)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator(`[data-shape-id="${cutId}"]`)).toHaveCount(1);
  });

  test('AI-created content participates in undo history', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const created = await (window as any).__GLIDELINE_WHITEBOARD__.callTool('create_shape', {
        type: 'diamond',
        x: 260,
        y: 180,
      });
      return created.id as string;
    });

    await expect(page.locator(`[data-shape-id="${id}"]`)).toHaveCount(1);
    await page.locator('[data-glideboard-role="app"]').focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator(`[data-shape-id="${id}"]`)).toHaveCount(0);
  });
});
