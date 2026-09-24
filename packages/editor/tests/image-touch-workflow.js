// Playwright CLI run-code body against tests/images.html.
async (page) => {
  const assert = (v, m) => { if (!v) throw new Error(m); };
  await page.reload();
  const first = page.locator('[data-fixture="edit"] .image-block-wrapper').first();
  await first.locator('img').click();
  const handle = first.getByRole('button', { name: 'Resize image from right' });
  let box = await handle.boundingBox();
  const width = (await first.locator('img').boundingBox()).width;
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y + 22);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert((await first.locator('img').boundingBox()).width === width, 'Escape cancels without changing width');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  box = await handle.boundingBox();
  const touch = (x) => [{ x, y: box.y + 22, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(box.x + 22) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(box.x + 52) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(Math.abs((await first.locator('img').boundingBox()).width - width - 60) <= 2, 'touch drag tracks edge');
  box = await handle.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(box.x + 22) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(box.x + 52) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert(Math.abs((await first.locator('img').boundingBox()).width - width - 60) <= 2, 'touch cancellation restores width');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.detach();
  await first.getByRole('button', { name: 'More image actions' }).click();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  assert(await first.getByRole('status').innerText() === 'Image copied', 'copy reports success');
  await page.evaluate(() => { window.savedImageFetch = window.fetch; window.fetch = async () => { throw new Error('Offline'); }; });
  await first.getByRole('button', { name: 'Download image' }).click();
  assert((await first.getByRole('status').innerText()).includes('Could not download'), 'download failure visible');
  await page.evaluate(() => { window.fetch = window.savedImageFetch; });
  console.log('PASS: Escape, touch drag, touch cancel, copy, download failure');
}
