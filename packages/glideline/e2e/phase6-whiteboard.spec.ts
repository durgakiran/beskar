import { expect, test } from '@playwright/test';

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

function segmentIntersectsBoxInterior(a: Point, b: Point, box: Box): boolean {
  const minX = box.x;
  const maxX = box.x + box.w;
  const minY = box.y;
  const maxY = box.y + box.h;
  const epsilon = 1e-6;

  if (Math.abs(a.x - b.x) < epsilon) {
    if (a.x <= minX + epsilon || a.x >= maxX - epsilon) return false;
    const segMinY = Math.min(a.y, b.y);
    const segMaxY = Math.max(a.y, b.y);
    return Math.max(segMinY, minY + epsilon) < Math.min(segMaxY, maxY - epsilon);
  }

  if (Math.abs(a.y - b.y) < epsilon) {
    if (a.y <= minY + epsilon || a.y >= maxY - epsilon) return false;
    const segMinX = Math.min(a.x, b.x);
    const segMaxX = Math.max(a.x, b.x);
    return Math.max(segMinX, minX + epsilon) < Math.min(segMaxX, maxX - epsilon);
  }

  return false;
}

function routeIntersectsBoxInterior(points: Point[], box: Box): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBoxInterior(points[i]!, points[i + 1]!, box)) {
      return true;
    }
  }
  return false;
}

test.describe('Phase 6 whiteboard browser coverage', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/#whiteboard');
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
    await page.evaluate(() => {
      window.__GLIDELINE_WHITEBOARD__?.reset();
    });
  });

  test('T6.1-01 browser: smart routes avoid obstacles', async ({ page }) => {
    const state = await page.evaluate(() => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      const from = api.callTool('create_shape', {
        type: 'box',
        x: 40,
        y: 140,
        props: { w: 120, h: 80, label: 'A' },
      }) as { id: string };
      const obstacle = api.callTool('create_shape', {
        type: 'box',
        x: 240,
        y: 110,
        props: { w: 120, h: 140, label: 'B' },
      }) as { id: string };
      const to = api.callTool('create_shape', {
        type: 'box',
        x: 460,
        y: 140,
        props: { w: 120, h: 80, label: 'C' },
      }) as { id: string };
      const arrow = api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'smart',
      }) as { id: string };
      const context = api.getAIContext() as {
        shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
        connections: Array<{ id: string; routeStyle: string }>;
      };
      return {
        arrowId: arrow.id,
        obstacle: context.shapes.find(shape => shape.id === obstacle.id)!,
        routeStyle: context.connections.find(connection => connection.id === arrow.id)?.routeStyle ?? null,
      };
    });

    const routePoints = await page.evaluate((arrowId) => {
      return window.__GLIDELINE_WHITEBOARD__?.getArrowRoutePoints(arrowId) ?? [];
    }, state.arrowId);

    expect(state.routeStyle).toBe('smart');
    expect(routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsBoxInterior(routePoints, state.obstacle)).toBe(false);
  });

  test('T6.1-07 browser: smart routes still avoid an obstacle when the target is tightly stacked above it', async ({ page }) => {
    const state = await page.evaluate(() => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      const from = api.callTool('create_shape', {
        type: 'box',
        x: 120,
        y: 560,
        props: { w: 120, h: 100, label: 'From' },
      }) as { id: string };
      const obstacle = api.callTool('create_shape', {
        type: 'box',
        x: 300,
        y: 340,
        props: { w: 220, h: 220, label: 'Obstacle' },
      }) as { id: string };
      const to = api.callTool('create_shape', {
        type: 'box',
        x: 350,
        y: 250,
        props: { w: 120, h: 80, label: 'To' },
      }) as { id: string };
      const arrow = api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'smart',
      }) as { id: string };
      const context = api.getAIContext() as {
        shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
        connections: Array<{ id: string; routeStyle: string }>;
      };
      return {
        arrowId: arrow.id,
        obstacle: context.shapes.find(shape => shape.id === obstacle.id)!,
        routeStyle: context.connections.find(connection => connection.id === arrow.id)?.routeStyle ?? null,
      };
    });

    const routePoints = await page.evaluate((arrowId) => {
      return window.__GLIDELINE_WHITEBOARD__?.getArrowRoutePoints(arrowId) ?? [];
    }, state.arrowId);

    expect(state.routeStyle).toBe('smart');
    expect(routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsBoxInterior(routePoints, state.obstacle)).toBe(false);
  });

  test('T6.1-08 browser: smart routes avoid obstacles when anchor coordinates are fractional', async ({ page }) => {
    const state = await page.evaluate(() => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      const obstacle = api.callTool('create_shape', {
        type: 'box',
        x: 470,
        y: 141,
        props: { w: 180, h: 180, label: 'Obstacle' },
      }) as { id: string };
      const from = api.callTool('create_shape', {
        type: 'box',
        x: 180,
        y: 376,
        props: { w: 100, h: 80, label: 'From' },
      }) as { id: string };
      const to = api.callTool('create_shape', {
        type: 'box',
        x: 489.8578605647359,
        y: 7.318804302490776,
        props: { w: 117.0390625, h: 76.6796875, label: 'To' },
      }) as { id: string };
      const arrow = api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'smart',
      }) as { id: string };
      const context = api.getAIContext() as {
        shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
      };
      return {
        arrowId: arrow.id,
        obstacle: context.shapes.find(shape => shape.id === obstacle.id)!,
      };
    });

    const routePoints = await page.evaluate((arrowId) => {
      return window.__GLIDELINE_WHITEBOARD__?.getArrowRoutePoints(arrowId) ?? [];
    }, state.arrowId);

    expect(routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsBoxInterior(routePoints, state.obstacle)).toBe(false);
  });

  test('arrow creation shows source and target binding previews during drag', async ({ page }) => {
    await page.evaluate(() => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      api.callTool('create_shape', {
        type: 'box',
        x: 140,
        y: 220,
        props: { w: 140, h: 100, label: 'A' },
      });
      api.callTool('create_shape', {
        type: 'box',
        x: 460,
        y: 240,
        props: { w: 160, h: 120, label: 'B' },
      });
    });

    await page.locator('button[title="Connector (Arrow)"]').click();
    const source = page.locator('[data-shape-id^="box-"]').first();
    const target = page.locator('[data-shape-id^="box-"]').nth(1);
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width + 120, sourceBox!.y + sourceBox!.height / 2, { steps: 6 });

    await expect(page.locator('#wb-binding-preview-source')).toBeVisible();
    await expect(page.locator('#wb-binding-preview-source-active-anchor')).toBeVisible();

    await page.mouse.move(targetBox!.x, targetBox!.y + targetBox!.height / 2, { steps: 8 });

    await expect(page.locator('#wb-binding-preview-source')).toBeVisible();
    await expect(page.locator('#wb-binding-preview-target')).toBeVisible();
    await expect(page.locator('#wb-binding-preview-target-active-anchor')).toBeVisible();

    await page.mouse.up();
  });

  test('route-style UI switches a selected arrow to smart and hides the bend handle', async ({ page }) => {
    const arrowId = await page.evaluate(() => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      const from = api.callTool('create_shape', {
        type: 'box',
        x: 60,
        y: 260,
        props: { w: 120, h: 80, label: 'Start' },
      }) as { id: string };
      const to = api.callTool('create_shape', {
        type: 'box',
        x: 420,
        y: 260,
        props: { w: 120, h: 80, label: 'End' },
      }) as { id: string };
      const arrow = api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'ortho',
      }) as { id: string };
      api.select([arrow.id]);
      return arrow.id;
    });

    await expect(page.locator('circle[data-handle="bend"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Smart' }).click();
    await expect(page.locator('circle[data-handle="bend"]')).toHaveCount(0);

    const routeStyle = await page.evaluate(() => {
      const context = window.__GLIDELINE_WHITEBOARD__?.getAIContext() as {
        connections: Array<{ id: string; routeStyle: string }>;
      };
      return context.connections[0]?.routeStyle ?? null;
    });

    expect(routeStyle).toBe('smart');
    await expect(page.locator(`[data-shape-id="${arrowId}"]`)).toBeVisible();
  });

  test('browser bridge exposes AI context, screenshot, MCP manifest, and history-ignore behavior', async ({ page }) => {
    await page.focus('[data-glideboard-role="app"]');
    const data = await page.evaluate(async () => {
      const api = window.__GLIDELINE_WHITEBOARD__!;
      const shape = api.callTool('create_shape', {
        type: 'box',
        x: 80,
        y: 80,
        props: { w: 120, h: 80, label: 'Browser Tool Box' },
      }) as { id: string };
      const beforeUndo = api.getAIContext() as { shapes: Array<{ id: string }> };
      const manifest = api.getToolManifest() as Array<{ name: string; inputSchema: unknown }>;
      const screenshot = await api.takeScreenshot();
      return {
        shapeId: shape.id,
        shapeCountBeforeUndo: beforeUndo.shapes.length,
        manifestNames: manifest.map(tool => tool.name),
        screenshotPrefix: screenshot.slice(0, 22),
      };
    });

    await page.keyboard.press('Control+Z');

    const afterUndoCount = await page.evaluate(() => {
      const context = window.__GLIDELINE_WHITEBOARD__?.getAIContext() as { shapes: Array<{ id: string }> };
      return context.shapes.length;
    });

    expect(data.manifestNames).toEqual([
      'create_shape',
      'update_shape',
      'delete_shapes',
      'create_connection',
      'get_canvas_state',
    ]);
    expect(data.screenshotPrefix).toBe('data:image/png;base64,');
    expect(afterUndoCount).toBe(data.shapeCountBeforeUndo);
  });
});
