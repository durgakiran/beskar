// Run in a separate Playwright CLI session: the browser clock is simulated.
async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.goto('http://127.0.0.1:5186/tests/dates.html');
  await page.waitForFunction(() => !!window.dateEditor && !!window.dateReader);
  await page.clock.install({ time: new Date(2030, 9, 9, 23, 59, 59) });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const pills = page.locator('.date-inline');
  await pills.first().waitFor();
  const saved = await page.evaluate(() => JSON.stringify([window.dateEditor.getJSON(), window.dateReader.getJSON()]));
  const labels = async (expected) => assert((await pills.allTextContents()).every(label => label === expected), expected);
  await labels('Tomorrow');
  assert(await pills.first().getAttribute('title') !== 'Tomorrow', 'tooltip includes the absolute date');
  await page.clock.fastForward(2000);
  await labels('Today');
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await labels('Yesterday');
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  assert((await pills.allTextContents()).every(label => label.includes('2030')), 'older dates revert to absolute labels');
  assert(saved === await page.evaluate(() => JSON.stringify([window.dateEditor.getJSON(), window.dateReader.getJSON()])), 'rollover does not mutate either document');
  // Simulate a suspended tab/clock change, then waking the page.
  await page.clock.setSystemTime(new Date(2030, 9, 10, 12));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await labels('Today');
  await page.clock.setSystemTime(new Date(2030, 9, 9, 12));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await labels('Tomorrow');
  return 'PASS: Tomorrow → Today → Yesterday → absolute date, reader and editor, unchanged JSON, focus/visibility recovery';
}
