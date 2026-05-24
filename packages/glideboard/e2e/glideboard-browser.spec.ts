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

test.describe('glideboard browser automation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#whiteboard');
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await page.waitForSelector('#wb-canvas', { timeout: 10_000 });
    await page.evaluate(() => {
      (window as any).__GLIDELINE_WHITEBOARD__?.reset();
    });
  });

  test('smart routes avoid obstacles', async ({ page }) => {
    const state = await page.evaluate(() => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const from = api.callTool('create_shape', {
        type: 'box',
        x: 40,
        y: 140,
        props: { w: 120, h: 80, label: 'A' },
      });
      const obstacle = api.callTool('create_shape', {
        type: 'box',
        x: 240,
        y: 110,
        props: { w: 120, h: 140, label: 'B' },
      });
      const to = api.callTool('create_shape', {
        type: 'box',
        x: 460,
        y: 140,
        props: { w: 120, h: 80, label: 'C' },
      });
      const arrow = api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'smart',
      });
      const context = api.getAIContext();
      return {
        arrowId: arrow.id,
        obstacle: context.shapes.find((shape: any) => shape.id === obstacle.id),
        routeStyle: context.connections.find((connection: any) => connection.id === arrow.id)?.routeStyle ?? null,
      };
    });

    const routePoints = await page.evaluate((arrowId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__?.getArrowRoutePoints(arrowId) ?? [];
    }, state.arrowId);

    expect(state.routeStyle).toBe('smart');
    expect(routePoints.length).toBeGreaterThan(2);
    expect(routeIntersectsBoxInterior(routePoints, state.obstacle)).toBe(false);
  });

  test('fit-to-screen updates zoom for wide boards and reset restores 100%', async ({ page }) => {
    await page.evaluate(() => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      api.callTool('create_shape', {
        type: 'box',
        x: 40,
        y: 180,
        props: { w: 140, h: 100, label: 'A' },
      });
      api.callTool('create_shape', {
        type: 'box',
        x: 1280,
        y: 220,
        props: { w: 180, h: 120, label: 'B' },
      });
    });

    await expect(page.locator('#wb-zoom-pct')).toHaveText('100%');
    await page.locator('#wb-fit').click();

    const fittedZoom = await page.locator('#wb-zoom-pct').textContent();
    expect(fittedZoom).not.toBeNull();
    expect(Number.parseInt(fittedZoom!, 10)).toBeLessThan(100);

    await page.locator('#wb-zoom-pct').click();
    await expect(page.locator('#wb-zoom-pct')).toHaveText('100%');
  });

  test('uses the light chrome palette instead of a dark theme', async ({ page }) => {
    const styles = await page.evaluate(() => {
      const app = window.getComputedStyle(document.getElementById('whiteboard-app')!);
      const toolbar = window.getComputedStyle(document.getElementById('wb-toolbar')!);
      const zoom = window.getComputedStyle(document.getElementById('wb-zoom-widget')!);
      return {
        appBackground: app.backgroundColor,
        toolbarBackground: toolbar.backgroundColor,
        toolbarBorder: toolbar.borderColor,
        zoomBackground: zoom.backgroundColor,
      };
    });

    expect(styles.appBackground).toBe('rgb(251, 250, 252)');
    expect(styles.toolbarBackground).toBe('rgb(255, 255, 255)');
    expect(styles.toolbarBorder).toBe('rgb(212, 209, 218)');
    expect(styles.zoomBackground).toBe('rgb(255, 255, 255)');
  });
});
