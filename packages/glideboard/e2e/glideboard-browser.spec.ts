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
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await page.waitForSelector('[data-glideboard-role="canvas"]', { timeout: 10_000 });
    await page.evaluate(() => {
      (window as any).__GLIDELINE_WHITEBOARD__?.reset();
    });
  });

  test('smart routes avoid obstacles', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const from = await api.callTool('create_shape', {
        type: 'box',
        x: 40,
        y: 140,
        props: { w: 120, h: 80, label: 'A' },
      });
      const obstacle = await api.callTool('create_shape', {
        type: 'box',
        x: 240,
        y: 110,
        props: { w: 120, h: 140, label: 'B' },
      });
      const to = await api.callTool('create_shape', {
        type: 'box',
        x: 460,
        y: 140,
        props: { w: 120, h: 80, label: 'C' },
      });
      const arrow = await api.callTool('create_connection', {
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

  test('double-click places and then re-edits one arrow label', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const from = await api.callTool('create_shape', {
        type: 'box',
        x: 120,
        y: 180,
        props: { w: 120, h: 80, label: 'From' },
      });
      const to = await api.callTool('create_shape', {
        type: 'box',
        x: 520,
        y: 320,
        props: { w: 120, h: 80, label: 'To' },
      });
      const arrow = await api.callTool('create_connection', {
        fromId: from.id,
        toId: to.id,
        routeStyle: 'ortho',
      });
      return {
        arrowId: arrow.id as string,
        points: api.getArrowRoutePoints(arrow.id) as Point[],
      };
    });
    const canvas = page.locator('[data-glideboard-role="canvas"]');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const first = state.points[0]!;
    const second = state.points[1]!;
    await page.mouse.dblclick(
      bounds!.x + (first.x + second.x) / 2,
      bounds!.y + (first.y + second.y) / 2,
    );

    const editor = page.locator('[data-glideboard-role="text-editing-overlay"] [contenteditable]');
    await expect(editor).toHaveCount(1);
    await expect(editor).toBeFocused();
    await expect.poll(() => editor.evaluate(element => element.textContent?.length ?? 0)).toBe(1);
    const emptyCaretTop = await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().top;
    });
    await editor.fill('First label');
    const typedCaretTop = await editor.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().top;
    });
    expect(Math.abs(emptyCaretTop - typedCaretTop)).toBeLessThan(2);
    await page.keyboard.press('Control+Enter');
    await expect(editor).toHaveCount(0);
    await expect.poll(() => page.evaluate((arrowId) => {
      return (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().connections
        .find((connection: any) => connection.id === arrowId)?.label;
    }, state.arrowId)).toBe('First label');
    await page.mouse.click(
      bounds!.x + (first.x + second.x) / 2,
      bounds!.y + (first.y + second.y) / 2,
    );
    await expect(page.getByText('Text Color', { exact: true })).toBeVisible();
    await expect(page.getByText('Arrow Route', { exact: true })).toHaveCount(0);

    const last = state.points[state.points.length - 1]!;
    const previous = state.points[state.points.length - 2]!;
    await page.mouse.dblclick(
      bounds!.x + (previous.x + last.x) / 2,
      bounds!.y + (previous.y + last.y) / 2,
    );
    await expect(editor).toHaveText('First label');
    await editor.fill('Updated label');
    await page.keyboard.press('Control+Enter');

    await expect.poll(() => page.evaluate((arrowId) => {
      const connections = (window as any).__GLIDELINE_WHITEBOARD__.getAIContext().connections;
      return {
        count: connections.filter((connection: any) => connection.id === arrowId).length,
        label: connections.find((connection: any) => connection.id === arrowId)?.label,
      };
    }, state.arrowId)).toEqual({ count: 1, label: 'Updated label' });
  });

  test('rotated text keeps its anchor and exposes only text styles while editing', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      const text = await api.callTool('create_shape', {
        type: 'text',
        x: 280,
        y: 220,
        text: 'Short',
        fontSize: 'lg',
      });
      await api.callTool('update_shape', {
        id: text.id,
        rotation: Math.PI / 3,
      });
      api.select([text.id]);
      return text.id as string;
    });

    await expect(page.getByText('Text Color', { exact: true })).toBeVisible();
    await expect(page.getByText('Stroke / Fill Color', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Stroke Width', { exact: true })).toHaveCount(0);

    const shape = page.locator(`[data-shape-id="${id}"]`);
    const before = await shape.evaluate((element) => {
      const matrix = new DOMMatrix((element as HTMLElement).style.transform);
      return { x: matrix.e, y: matrix.f };
    });
    const bounds = await shape.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.dblclick(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    );

    const editor = page.locator('[data-glideboard-role="text-editing-overlay"] [contenteditable]');
    await expect(editor).toHaveText('Short');
    await expect(page.getByText('Text Color', { exact: true })).toBeVisible();
    await expect(page.getByText('Stroke / Fill Color', { exact: true })).toHaveCount(0);
    await editor.fill('A much longer rotated text label');
    await page.keyboard.press('Control+Enter');

    await expect(editor).toHaveCount(0);
    const after = await shape.evaluate((element) => {
      const matrix = new DOMMatrix((element as HTMLElement).style.transform);
      return { x: matrix.e, y: matrix.f };
    });
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  test('fit-to-screen updates zoom for wide boards and reset restores 100%', async ({ page }) => {
    await page.evaluate(async () => {
      const api = (window as any).__GLIDELINE_WHITEBOARD__;
      await api.callTool('create_shape', {
        type: 'box',
        x: 40,
        y: 180,
        props: { w: 140, h: 100, label: 'A' },
      });
      await api.callTool('create_shape', {
        type: 'box',
        x: 1280,
        y: 220,
        props: { w: 180, h: 120, label: 'B' },
      });
    });

    await expect(page.locator('[data-glideboard-control="zoom-pct"]')).toHaveText('100%');
    await page.locator('[data-glideboard-control="fit"]').click();

    const fittedZoom = await page.locator('[data-glideboard-control="zoom-pct"]').textContent();
    expect(fittedZoom).not.toBeNull();
    expect(Number.parseInt(fittedZoom!, 10)).toBeLessThan(100);

    await page.locator('[data-glideboard-control="zoom-pct"]').click();
    await expect(page.locator('[data-glideboard-control="zoom-pct"]')).toHaveText('100%');
  });

  test('uses the light chrome palette instead of a dark theme', async ({ page }) => {
    const styles = await page.evaluate(() => {
      const app = window.getComputedStyle(document.querySelector('[data-glideboard-role="app"]')!);
      const toolbar = window.getComputedStyle(document.querySelector('[data-glideboard-role="toolbar"]')!);
      const zoom = window.getComputedStyle(document.querySelector('[data-glideboard-role="zoom-widget"]')!);
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
