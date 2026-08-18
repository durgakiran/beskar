import { expect, test, type Locator, type Page } from '@playwright/test';

const svgFile = (name: string, color = '#2563eb') => ({
  name,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><path d="M0 0h80v40H0z" fill="${color}"/></svg>`),
});

const pngFile = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
});

const mainBoard = (page: Page): Locator => page.locator('[data-demo-role="board"]');
const acceptanceControls = (page: Page): Locator => page.locator('[data-demo-role="acceptance-controls"]');

async function openBoard(page: Page): Promise<void> {
  await page.goto('/#whiteboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const board = mainBoard(page);
  await expect(board).toHaveCount(1);
  const toolbar = board.locator('[data-glideboard-role="toolbar"]');
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar).toBeVisible();
}

async function chooseFiles(page: Page, trigger: Locator, files: Array<ReturnType<typeof svgFile> | ReturnType<typeof pngFile>>): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await trigger.click();
  await (await chooserPromise).setFiles(files);
}

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('real Media control and main menu open the same multi-file picker and restore focus', async ({ page }) => {
  const board = mainBoard(page);
  const media = board.getByTitle('Import image');
  await chooseFiles(page, media, [svgFile('direct.svg')]);
  await expect(board.locator('[data-import-status="complete"]')).toContainText('direct.svg');
  await expect(media).toBeFocused();

  const menuButton = board.getByRole('button', { name: 'Main menu' });
  await menuButton.click();
  const menuItem = board.getByRole('menuitem', { name: 'Import image...' });
  await expect(menuItem).toBeFocused();
  await chooseFiles(page, menuItem, [svgFile('one.svg'), svgFile('two.svg', '#16a34a')]);
  await expect(board.locator('[data-import-status="complete"]')).toHaveCount(3);
  await expect(menuButton).toBeFocused();

  const input = board.locator('[data-glideboard-role="asset-file-input"]');
  await expect(input).toHaveAttribute('multiple', '');
  await expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/svg+xml');
});

test('selected raster and SVG imports expose inspectors without leaking focused field shortcuts', async ({ page }) => {
  const board = mainBoard(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('inspector.png')]);
  await expect(board.locator('[data-import-status="complete"]', { hasText: 'inspector.png' })).toBeVisible();

  const inspector = board.locator('[data-glideboard-role="asset-inspector"]');
  const altText = inspector.getByRole('textbox', { name: 'Alt text' });
  await expect(inspector).toBeVisible();
  await altText.pressSequentially('Raster text');
  await expect(altText).toBeFocused();
  await expect(altText).toHaveValue('Raster text');
  await page.evaluate(() => navigator.clipboard.writeText(' pasted natively'));
  await altText.press('Meta+v');
  await expect(altText).toBeFocused();
  await expect(altText).toHaveValue('Raster text pasted natively');
  await expect(inspector).toBeVisible();
  expect(await page.evaluate(() => ({
    tool: (window as any).__GLIDELINE_WHITEBOARD__.getCurrentToolId(),
    shapes: (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .filter((record: any) => record.kind === 'shape')
      .map((record: any) => ({ type: record.type, altText: record.props.altText ?? null })),
  }))).toEqual({ tool: 'select', shapes: [{ type: 'raster-image', altText: null }] });

  await altText.blur();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .find((record: any) => record.kind === 'shape' && record.type === 'raster-image').props.altText
  ))).toBe('Raster text pasted natively');

  const cropX = inspector.getByRole('spinbutton', { name: 'Crop X' });
  await cropX.fill('0.25');
  await cropX.press('r');
  await expect(cropX).toBeFocused();
  await expect(cropX).toHaveValue('0.25');
  expect(await page.evaluate(() => ({
    tool: (window as any).__GLIDELINE_WHITEBOARD__.getCurrentToolId(),
    crop: (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .find((record: any) => record.kind === 'shape' && record.type === 'raster-image').props.crop ?? null,
  }))).toEqual({ tool: 'select', crop: null });
  await inspector.getByRole('spinbutton', { name: 'Crop W' }).fill('0.75');
  await inspector.getByRole('button', { name: 'Apply crop' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .find((record: any) => record.kind === 'shape' && record.type === 'raster-image').props.crop.x
  ))).toBe(0.25);

  await chooseFiles(page, board.getByTitle('Import image'), [svgFile('inspector.svg')]);
  await expect(board.locator('[data-import-status="complete"]', { hasText: 'inspector.svg' })).toBeVisible();
  await expect(inspector.getByRole('group', { name: 'SVG color mode' })).toBeVisible();
  await expect(inspector.getByLabel('Theme color')).toBeDisabled();
  await inspector.getByRole('button', { name: 'Monochrome' }).click();
  await expect(inspector.getByLabel('Theme color')).toBeEnabled();
  await expect(inspector.getByRole('spinbutton', { name: 'Crop X' })).toHaveCount(0);

  await page.evaluate(() => navigator.clipboard.writeText('Canvas paste text'));
  const canvas = board.locator('[data-glideboard-role="canvas"]');
  await canvas.focus();
  await canvas.press('Meta+v');
  await expect(board.locator('[data-glideboard-role="asset-inspector"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .filter((record: any) => record.kind === 'shape' && record.type === 'text').length
  ))).toBe(1);
});

test('missing raster and SVG assets stay bounded and selectable, then recover', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`);
  });
  const board = mainBoard(page);
  await chooseFiles(page, board.getByTitle('Import image'), [
    pngFile('recoverable-raster.png'),
    svgFile('recoverable-vector.svg'),
  ]);
  await expect(board.locator('[data-import-status="complete"]')).toHaveCount(2);

  const fixture = await page.evaluate(() => {
    const api = (window as any).__GLIDELINE_WHITEBOARD__;
    const document = api.getDocument();
    const records = document.records as any[];
    const raster = records.find(record => record.kind === 'shape' && record.type === 'raster-image');
    const vector = records.find(record => record.kind === 'shape' && record.type === 'sanitized-svg');
    const rasterAsset = records.find(record => record.kind === 'asset' && record.type === 'raster-image');
    const bytesKey = 'glideline-whiteboard-demo-raster-bytes-v1';
    const bytes = localStorage.getItem(bytesKey);
    if (!raster || !vector || !rasterAsset || !bytes) throw new Error('Acceptance assets were not persisted.');
    const missingDocument = structuredClone(document);
    const missingVector = missingDocument.records.find((record: any) => record.id === vector.id);
    missingVector.props.assetId = rasterAsset.id;
    localStorage.setItem('glideline-whiteboard-v1', JSON.stringify(missingDocument));
    localStorage.removeItem(bytesKey);
    return { document, bytes, rasterId: raster.id, vectorId: vector.id };
  });

  await page.reload();
  const reloadedBoard = mainBoard(page);
  await expect(reloadedBoard.locator('[data-missing-asset="true"]')).toHaveCount(2);
  for (const id of [fixture.rasterId, fixture.vectorId]) {
    const host = reloadedBoard.locator(`[data-shape-id="${id}"]`);
    const placeholder = host.locator('[data-missing-asset="true"]');
    await expect(placeholder).toHaveCount(1);
    const bounds = await host.evaluate(element => ({
      width: Number.parseFloat((element as HTMLElement).style.width),
      height: Number.parseFloat((element as HTMLElement).style.height),
      placeholderWidth: Number(element.querySelector('[data-missing-asset="true"] svg')?.getAttribute('width')),
      placeholderHeight: Number(element.querySelector('[data-missing-asset="true"] svg')?.getAttribute('height')),
    }));
    expect(bounds.placeholderWidth).toBe(bounds.width);
    expect(bounds.placeholderHeight).toBe(bounds.height);
    await page.evaluate(shapeId => (window as any).__GLIDELINE_WHITEBOARD__.select([shapeId]), id);
    await expect.poll(() => page.evaluate(() => (window as any).__GLIDELINE_WHITEBOARD__.getSelection())).toEqual([id]);
  }

  await page.evaluate(({ document, bytes }) => {
    localStorage.setItem('glideline-whiteboard-v1', JSON.stringify(document));
    localStorage.setItem('glideline-whiteboard-demo-raster-bytes-v1', bytes);
  }, fixture);
  await page.reload();
  const recoveredBoard = mainBoard(page);
  await expect(recoveredBoard.locator('[data-missing-asset="true"]')).toHaveCount(0);
  await expect(recoveredBoard.locator(`[data-shape-id="${fixture.rasterId}"] image`)).toHaveCount(1);
  await expect(recoveredBoard.locator(`[data-shape-id="${fixture.vectorId}"] path`)).toHaveCount(1);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('asset inspector replaces and downloads originals, and read-only reset restores mutation permission', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('original.png')]);
  await expect(board.locator('[data-import-status="complete"]', { hasText: 'original.png' })).toBeVisible();
  const inspector = board.locator('[data-glideboard-role="asset-inspector"]');
  await expect(inspector.getByRole('group', { name: 'Asset commands' })).toBeVisible();

  const chooserPromise = page.waitForEvent('filechooser');
  await inspector.getByRole('button', { name: 'Replace' }).click();
  await (await chooserPromise).setFiles(pngFile('replacement.png'));
  await expect(inspector.getByRole('status')).toContainText('Replaced with replacement.png.');

  const downloadPromise = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('glideboard-asset.png');
  await expect(inspector.getByRole('status')).toContainText('Download started.');

  await controls.getByRole('button', { name: 'Read-only' }).click();
  await controls.getByRole('button', { name: 'Reset demo data' }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .filter((record: any) => record.kind === 'shape').length
  ))).toBe(0);
  await expect(controls.getByRole('button', { name: 'Read-only' })).toHaveAttribute('aria-pressed', 'false');
});

test('Replace and Download failures expose deterministic retry and dismiss recovery', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('failure-source.png')]);
  await expect(board.locator('[data-import-status="complete"]', { hasText: 'failure-source.png' })).toBeVisible();
  const inspector = board.locator('[data-glideboard-role="asset-inspector"]');

  await controls.getByRole('button', { name: 'Fail next upload' }).click();
  await chooseFiles(page, inspector.getByRole('button', { name: 'Replace' }), [pngFile('dismissed-replace.png')]);
  let alert = inspector.getByRole('alert');
  await expect(alert).toContainText('Replace failed: Demo storage failure.');
  await expect(alert.getByRole('button', { name: 'Retry replace' })).toBeVisible();
  await alert.getByRole('button', { name: 'Dismiss replace error' }).click();
  await expect(inspector.getByRole('alert')).toHaveCount(0);

  await controls.getByRole('button', { name: 'Fail next upload' }).click();
  await chooseFiles(page, inspector.getByRole('button', { name: 'Replace' }), [pngFile('retried-replace.png')]);
  alert = inspector.getByRole('alert');
  await expect(alert).toContainText('Replace failed: Demo storage failure.');
  await alert.getByRole('button', { name: 'Retry replace' }).click();
  await expect(inspector.getByRole('status')).toContainText('Replaced with retried-replace.png.');

  await controls.getByRole('button', { name: 'Fail next download' }).click();
  await inspector.getByRole('button', { name: 'Download' }).click();
  alert = inspector.getByRole('alert');
  await expect(alert).toContainText('Download failed: Demo download is temporarily unavailable.');
  await expect(alert.getByRole('button', { name: 'Retry download' })).toBeVisible();
  await alert.getByRole('button', { name: 'Dismiss download error' }).click();
  await expect(inspector.getByRole('alert')).toHaveCount(0);

  await controls.getByRole('button', { name: 'Fail next download' }).click();
  await inspector.getByRole('button', { name: 'Download' }).click();
  alert = inspector.getByRole('alert');
  await expect(alert).toContainText('Download failed: Demo download is temporarily unavailable.');
  const downloadPromise = page.waitForEvent('download');
  await alert.getByRole('button', { name: 'Retry download' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('glideboard-asset.png');
  await expect(inspector.getByRole('status')).toContainText('Download started.');
});

test('paste and drop use the import workflow and announce terminal status', async ({ page }) => {
  const board = mainBoard(page);
  const app = board.locator('[data-glideboard-role="app"]');
  await app.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M0 0h20v20z"/></svg>',
    ], 'pasted.svg', { type: 'image/svg+xml' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(board.locator('[data-import-status="complete"]')).toContainText('pasted.svg');

  await app.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="10"><path d="M0 0h30v10z"/></svg>',
    ], 'dropped.svg', { type: 'image/svg+xml' }));
    element.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    element.dispatchEvent(new DragEvent('drop', {
      dataTransfer: transfer, clientX: 220, clientY: 240, bubbles: true, cancelable: true,
    }));
  });
  await expect(board.locator('[data-import-status="complete"]', { hasText: 'dropped.svg' })).toBeVisible();
  const importPanel = board.locator('[data-glideboard-role="asset-import-panel"]');
  await expect(importPanel.locator('[aria-live="polite"]')).toContainText('dropped.svg: Complete');
});

test('slow upload can be cancelled and retried', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await controls.getByRole('button', { name: 'Slow upload' }).click();
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('slow.png')]);
  const row = board.locator('[data-import-status="uploading"]');
  await expect(row).toContainText('slow.png');
  await expect(board.locator('[data-glideboard-role="asset-import-panel"]')).toHaveAttribute('aria-busy', 'true');
  await row.getByRole('button', { name: 'Cancel import' }).click();
  const cancelled = board.locator('[data-import-status="cancelled"]');
  await expect(cancelled).toContainText('slow.png');
  await cancelled.getByRole('button', { name: 'Retry import' }).click();
  await expect(board.locator('[data-import-status="complete"]')).toContainText('slow.png', { timeout: 5_000 });
});

test('injected storage failure is actionable and retry succeeds', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await controls.getByRole('button', { name: 'Fail next upload' }).click();
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('failure.png')]);
  const error = board.locator('[data-import-status="error"]');
  await expect(error).toContainText('Demo storage failure.');
  await expect(error).toContainText('Check available storage, then retry.');
  await error.getByRole('button', { name: 'Retry import' }).click();
  await expect(board.locator('[data-import-status="complete"]')).toContainText('failure.png');
});

test('catalog search keeps typed input isolated and native drag places one asset at the drop point', async ({ page }) => {
  const board = mainBoard(page);
  await page.evaluate(() => {
    localStorage.setItem('glideline-whiteboard-demo-asset-favorites', '["mine:decision"]');
    localStorage.setItem('glideline-whiteboard-demo-asset-recents', '["mine:decision"]');
  });
  await board.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  const search = assets.getByRole('searchbox', { name: 'Search assets' });
  await search.pressSequentially('rect fade x');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('rect fade x');
  expect(await page.evaluate(() => ({
    tool: (window as any).__GLIDELINE_WHITEBOARD__.getCurrentToolId(),
    shapeCount: (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
      .filter((record: any) => record.kind === 'shape').length,
  }))).toEqual({ tool: 'select', shapeCount: 0 });

  await search.fill('');
  const priorResult = assets.getByRole('list', { name: 'My Shapes' })
    .locator('[data-asset-item="mine:decision"]');
  await expect(priorResult).toBeVisible();
  await search.fill('lambda');
  expect(await assets.evaluate(element => ({
    busy: element.getAttribute('aria-busy'),
    sectionCounts: Array.from(element.querySelectorAll('h2')).slice(0, 3)
      .map(heading => heading.textContent?.replace(/\s+/g, ' ').trim()),
  }))).toEqual({
    busy: 'true',
    sectionCounts: ['Recent (1)', 'Favorites (1)', 'My Shapes (1)'],
  });
  await expect(assets.getByText('Loading asset libraries...', { exact: true })).toHaveCount(0);
  const source = assets.locator('[data-asset-item="aws:lambda"]');
  const canvas = board.locator('[data-glideboard-role="canvas"]');
  await expect(source).toBeVisible();
  await expect(assets).toHaveAttribute('aria-busy', 'false');
  await expect(priorResult).toHaveCount(0);
  await expect(assets.getByRole('heading', { name: 'Recent (0)' })).toBeVisible();
  await expect(assets.getByRole('heading', { name: 'Favorites (0)' })).toBeVisible();
  await expect(source).toContainText('Architecture · aws');
  await search.press('ArrowDown');
  await expect(source).toBeFocused();
  await source.dragTo(canvas, { targetPosition: { x: 600, y: 300 } });

  await expect(board.locator('[data-shape-id^="shape:sanitized-svg"]')).toHaveCount(1);
  const placed = await page.evaluate(() => (window as any).__GLIDELINE_WHITEBOARD__.getDocument().records
    .filter((record: any) => record.kind === 'shape' && record.type === 'sanitized-svg')
    .map((record: any) => ({ x: record.x, y: record.y, w: record.props.w, h: record.props.h })));
  expect(placed).toHaveLength(1);
  expect(placed[0].x + placed[0].w / 2).toBeCloseTo(600, 0);
  expect(placed[0].y + placed[0].h / 2).toBeCloseTo(300, 0);
  expect(placed[0].w / placed[0].h).toBeCloseTo(160 / 96, 5);
});

test('asset placement exposes app-scoped pending cancel and actionable failure recovery', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  const holdPlacement = controls.getByRole('button', { name: 'Hold placement' });
  await holdPlacement.click();
  await board.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  await assets.getByRole('list', { name: 'AWS' }).locator('[data-asset-item="aws:lambda"]').click();

  const app = board.locator('[data-glideboard-role="app"]');
  const canvas = app.locator('[data-glideboard-role="canvas"]');
  const armed = app.getByRole('status');
  await expect(armed).toHaveAttribute('data-placement-status', 'armed');
  await expect(armed).toContainText('Placing AWS Lambda');
  await expect(canvas).toHaveAttribute('data-asset-placement-armed', 'true');

  await canvas.click({ position: { x: 520, y: 280 } });
  const pending = app.getByRole('status');
  await expect(pending).toHaveAttribute('data-placement-status', 'pending');
  await expect(pending).toContainText('Preparing asset...');
  await pending.getByRole('button', { name: 'Cancel asset placement' }).click();
  await expect(app.locator('[data-glideboard-role="asset-placement-status"]')).toHaveCount(0);
  await expect(board.locator('[data-shape-id^="shape:sanitized-svg"]')).toHaveCount(0);

  await holdPlacement.click();
  await controls.getByRole('button', { name: 'Fail next placement' }).click();
  await board.getByRole('button', { name: 'Assets' }).click();
  await board.getByRole('complementary', { name: 'Assets' })
    .getByRole('list', { name: 'AWS' }).locator('[data-asset-item="aws:lambda"]').click();
  await canvas.click({ position: { x: 520, y: 280 } });

  const alert = app.getByRole('alert');
  await expect(alert).toHaveAttribute('data-placement-status', 'error');
  await expect(alert).toContainText('Demo asset placement failed.');
  await expect(alert).toContainText('Try placement again or dismiss this message.');
  await expect(alert.getByRole('button', { name: 'Try placement again' })).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Dismiss placement error' })).toBeVisible();
  await alert.getByRole('button', { name: 'Dismiss placement error' }).click();
  await expect(app.locator('[data-glideboard-role="asset-placement-status"]')).toHaveCount(0);

  await controls.getByRole('button', { name: 'Fail next placement' }).click();
  await board.getByRole('button', { name: 'Assets' }).click();
  await board.getByRole('complementary', { name: 'Assets' })
    .getByRole('list', { name: 'AWS' }).locator('[data-asset-item="aws:lambda"]').click();
  await canvas.click({ position: { x: 520, y: 280 } });
  await expect(alert).toHaveAttribute('data-placement-status', 'error');
  await alert.getByRole('button', { name: 'Try placement again' }).click();
  await expect(app.getByRole('status')).toHaveAttribute('data-placement-status', 'armed');
  await canvas.click({ position: { x: 520, y: 280 } });
  await expect(board.locator('[data-shape-id^="shape:sanitized-svg"]')).toHaveCount(1);
  await expect(app.locator('[data-glideboard-role="asset-placement-status"]')).toHaveCount(0);
});

test('reset demo clears favorites and recents and unavailable items expose no favorite mutation', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await board.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  const aws = assets.getByRole('list', { name: 'AWS' });
  const lambda = aws.locator('[data-asset-item="aws:lambda"]');
  await expect(lambda).toBeVisible();
  await expect(assets.getByRole('button', { name: 'Add Legacy team mark to favorites' })).toBeDisabled();
  await aws.getByRole('button', { name: 'Add AWS Lambda to favorites' }).click();
  await expect(aws.getByRole('button', { name: 'Remove AWS Lambda from favorites' })).toBeEnabled();

  await lambda.click();
  await board.locator('[data-glideboard-role="canvas"]').click({ position: { x: 500, y: 260 } });
  await expect(board.locator('[data-shape-id^="shape:sanitized-svg"]')).toHaveCount(1);
  await board.getByRole('button', { name: 'Assets' }).click();
  await expect(assets.getByRole('heading', { name: 'Recent (1)' })).toBeVisible();
  await expect(assets.getByRole('heading', { name: 'Favorites (1)' })).toBeVisible();
  await controls.getByRole('button', { name: 'Reset demo data' }).click();

  await expect(assets).toBeVisible();
  await expect(assets.getByRole('heading', { name: 'Recent (0)' })).toBeVisible();
  await expect(assets.getByRole('heading', { name: 'Favorites (0)' })).toBeVisible();
  await expect(assets.getByRole('button', { name: 'Add AWS Lambda to favorites' })).toBeEnabled();
});

test('demo controls expose catalog loading and fail-once retry states', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await controls.getByRole('button', { name: 'Catalog loading' }).click();
  await board.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  await expect(assets).toHaveAttribute('aria-busy', 'true');
  await expect(assets).toContainText('Loading asset libraries...');

  await controls.getByRole('button', { name: 'Catalog loading' }).click();
  await expect(assets.locator('[data-asset-item="aws:lambda"]')).toBeVisible();
  await controls.getByRole('button', { name: 'Fail catalog load' }).click();
  await expect(assets).toContainText('Demo catalog is unavailable.');
  await assets.getByRole('button', { name: 'Retry' }).click();
  await expect(assets.locator('[data-asset-item="aws:lambda"]')).toBeVisible();
});

test('completed imports can be dismissed from the progress surface', async ({ page }) => {
  const board = mainBoard(page);
  await chooseFiles(page, board.getByTitle('Import image'), [svgFile('dismiss-me.svg')]);
  const completed = board.locator('[data-import-status="complete"]', { hasText: 'dismiss-me.svg' });
  await expect(completed).toBeVisible();
  await completed.getByRole('button', { name: 'Dismiss import' }).click();
  await expect(completed).toHaveCount(0);
  await expect(board.locator('[data-glideboard-role="asset-import-panel"]')).toHaveCount(0);
});

test('raster duplicate, portable transfer, reload, export, history, and trust are observable', async ({ page }) => {
  const board = mainBoard(page);
  await chooseFiles(page, board.getByTitle('Import image'), [pngFile('portable.png')]);
  await expect(board.locator('[data-import-status="complete"]')).toContainText('portable.png');

  const imported = await page.evaluate(() => {
    const api = (window as any).__GLIDELINE_WHITEBOARD__;
    const shape = api.getDocument().records.find((record: any) => (
      record.kind === 'shape' && record.type === 'raster-image'
    ));
    return { shapeId: shape.id as string, state: (window as any).__GLIDELINE_P3_C6__.getAcceptanceState() };
  });
  expect(imported.state).toMatchObject({ shapeCount: 1, assetCount: 1, rasterShapeCount: 1 });
  expect(imported.state.assets).toHaveLength(1);
  expect(imported.state.assets[0].resolvedUrls).toEqual([expect.stringMatching(/^blob:/)]);
  await expect(board.locator(`[data-shape-id="${imported.shapeId}"] image`)).toHaveAttribute('href', /^blob:/);

  await page.evaluate((shapeId) => (window as any).__GLIDELINE_WHITEBOARD__.select([shapeId]), imported.shapeId);
  await board.locator('[data-glideboard-role="canvas"]').focus();
  await page.keyboard.press('Meta+d');
  await expect(board.locator('[data-shape-id] image')).toHaveCount(2);
  const duplicate = await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.getAcceptanceState());
  expect(duplicate).toMatchObject({ shapeCount: 2, assetCount: 1, rasterShapeCount: 2 });
  expect(duplicate.assets[0].resolvedUrls).toHaveLength(2);

  await page.keyboard.press('Meta+z');
  await expect.poll(() => page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.getAcceptanceState()))
    .toMatchObject({ shapeCount: 1, assetCount: 1 });
  await page.keyboard.press('Meta+Shift+z');
  await expect.poll(() => page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.getAcceptanceState()))
    .toMatchObject({ shapeCount: 2, assetCount: 1 });

  const historicalContext = { documentId: 'board-source', snapshotId: 'snapshot-5' };
  const fragment = await page.evaluate(async ({ shapeId, context }) => {
    return (window as any).__GLIDELINE_P3_C6__.createPortableFragment([shapeId], context);
  }, { shapeId: imported.shapeId, context: historicalContext });
  expect(fragment.rasterPayloads).toEqual([
    expect.objectContaining({ kind: 'embedded', assetId: imported.state.assets[0].id }),
  ]);

  await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.resetDestination());
  await expect.poll(() => page.evaluate(() => (
    (window as any).__GLIDELINE_P3_C6__.getAcceptanceState()
  ))).toMatchObject({ shapeCount: 0, assetCount: 0 });
  const transferred = await page.evaluate(async ({ portable, context }) => {
    const api = (window as any).__GLIDELINE_P3_C6__;
    const ids = await api.pastePortableFragment(portable, { x: 300, y: 220 });
    return { ids };
  }, { portable: fragment, context: historicalContext });
  expect(transferred.ids).toHaveLength(1);
  await expect(board.locator(`[data-shape-id="${transferred.ids[0]}"] image`)).toHaveAttribute('href', /^blob:/);
  const transferredState = await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.getAcceptanceState());
  expect(transferredState).toMatchObject({ shapeCount: 1, assetCount: 1, rasterShapeCount: 1 });
  expect(transferredState.assets[0].resolvedUrls).toEqual([expect.stringMatching(/^blob:/)]);

  const svg = await page.evaluate(async ({ ids, context }) => (
    (window as any).__GLIDELINE_P3_C6__.exportSvg(ids, context)
  ), { ids: transferred.ids, context: historicalContext });
  expect(svg).toContain('data:image/png;base64,');
  expect(svg).not.toContain('blob:');
  expect(await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.getRequestEvidence())).toEqual([
    {
      sequence: 1,
      operation: 'createPortableFragment',
      shapeIds: [imported.shapeId],
      context: historicalContext,
    },
    {
      sequence: 2,
      operation: 'pastePortableFragment',
      point: { x: 300, y: 220 },
    },
    {
      sequence: 3,
      operation: 'exportSvg',
      shapeIds: transferred.ids,
      context: historicalContext,
    },
  ]);

  await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.flush());
  await expect.poll(() => page.evaluate(() => {
    const saved = localStorage.getItem('glideline-whiteboard-v1');
    if (!saved) return 0;
    return JSON.parse(saved).records.filter((record: any) => record.kind === 'shape').length;
  })).toBe(1);
  await page.reload();
  await expect(board.locator('[data-glideboard-role="canvas"]')).toBeVisible();
  const reloaded = await page.evaluate((context) => (
    (window as any).__GLIDELINE_P3_C6__.getAcceptanceState()
  ), historicalContext);
  expect(reloaded).toMatchObject({ shapeCount: 1, assetCount: 1, rasterShapeCount: 1 });
  expect(reloaded.assets[0].resolvedUrls).toEqual([expect.stringMatching(/^blob:/)]);
  await expect(board.locator('[data-shape-id] image')).toHaveAttribute('href', /^blob:/);

  const untrusted = structuredClone(fragment);
  untrusted.rasterPayloads[0] = {
    assetId: untrusted.rasterPayloads[0].assetId,
    kind: 'durable-reference',
    reference: 'https://untrusted.example/asset.png',
  };
  await page.evaluate(() => (window as any).__GLIDELINE_P3_C6__.resetDestination());
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const rejection = await page.evaluate(async (portable) => {
    try {
      await (window as any).__GLIDELINE_P3_C6__.pastePortableFragment(portable);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, untrusted);
  expect(rejection).toMatch(/trusted whiteboard media URL/);
  expect(requests.filter(url => url.startsWith('https://untrusted.example/'))).toEqual([]);
  expect(await page.evaluate(() => (
    (window as any).__GLIDELINE_P3_C6__.getAcceptanceState()
  ))).toMatchObject({ shapeCount: 0, assetCount: 0 });
});

test('read-only preserves browse-only Assets while blocking imports and mutations', async ({ page }) => {
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await controls.getByRole('button', { name: 'Read-only' }).click();
  const toolbar = board.locator('[data-glideboard-role="toolbar"]');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button')).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: 'Assets' })).toBeEnabled();
  await expect(toolbar.getByRole('button', { name: 'Main menu' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Import image' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Layers' })).toHaveCount(0);
  await expect(toolbar.locator('[data-glideboard-tool]:not([data-glideboard-tool="assets"])')).toHaveCount(0);
  await expect(board.locator('[data-glideboard-role="statusbar"]')).toContainText('Read-only');

  await toolbar.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  await expect(assets).toContainText('View only');
  const asset = assets.locator('[data-asset-item="aws:lambda"]');
  await expect(asset).toBeVisible();
  await expect(asset).toHaveAttribute('aria-disabled', 'true');
  await assets.getByRole('searchbox', { name: 'Search assets' }).fill('lambda');
  await expect(asset).toBeVisible();

  const app = board.locator('[data-glideboard-role="app"]');
  await board.locator('[data-glideboard-role="canvas"]').focus();
  await app.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg/>'], 'blocked.svg', { type: 'image/svg+xml' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(board.locator('[data-import-status="error"]')).toContainText('This board is read-only.');
  const importPanel = board.locator('[data-glideboard-role="asset-import-panel"]');
  await expect(importPanel.locator('[aria-live="polite"]')).toContainText('This board is read-only.');

  await app.evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg/>'], 'blocked-drop.svg', { type: 'image/svg+xml' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(board.locator('[data-import-status="error"]')).toHaveCount(2);
});

test('390px layout keeps controls scrollable and overlays disjoint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const board = mainBoard(page);
  const controls = acceptanceControls(page);
  await expect(board.locator('[data-glideboard-role="toolbar"]')).toBeVisible();

  const toolbar = board.locator('[data-glideboard-role="toolbar"]');
  const rail = board.locator('[data-glideboard-role="toolbar-tools"]');
  expect(await rail.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  const toolbarBox = (await toolbar.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  expect(toolbarBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height);

  await toolbar.getByRole('button', { name: 'Assets' }).click();
  const assets = board.getByRole('complementary', { name: 'Assets' });
  await expect(assets.getByRole('searchbox', { name: 'Search assets' })).toBeVisible();
  const assetsBox = (await assets.boundingBox())!;
  expect(assetsBox.x).toBeGreaterThanOrEqual(8);
  expect(assetsBox.x + assetsBox.width).toBeLessThanOrEqual(382);
  expect(assetsBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
  await assets.getByRole('button', { name: 'Close assets' }).click();

  await chooseFiles(page, board.getByTitle('Import image'), [svgFile('mobile.svg')]);
  const panelBox = (await board.locator('[data-glideboard-role="asset-import-panel"]').boundingBox())!;
  const zoomBox = (await board.locator('[data-glideboard-role="zoom-widget"]').boundingBox())!;
  const statusBox = (await board.locator('[data-glideboard-role="statusbar"]').boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(zoomBox.y);
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(zoomBox.x);
});
