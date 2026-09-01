/**
 * Read-only browser check for the Daily Cashbook.
 *
 *   node scripts/check-cashbook.mjs <output-directory>
 *
 * Captures desktop light/dark and mobile views, checks for browser errors/overflow, and proves
 * the authenticated CSV/PNG endpoints answer without changing the book.
 */
/* global document, window, getComputedStyle */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const output = process.argv[2] ?? 'screenshots/cashbook';
mkdirSync(output, { recursive: true });
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill(
    'input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]',
    'admin@bank.test',
  );
  await page.fill('input[type="password"]', 'Maturity@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  return page;
}

async function check(name, viewport, dark = false) {
  const context = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light' });
  const page = await login(context);
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`PAGEERROR: ${error.message}`));
  await page.goto(`${base}/cashbook`, { waitUntil: 'networkidle' });
  if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
  else await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.waitForTimeout(700);

  let spreadsheet = null;
  let stacking = null;
  if (name === 'desktop-light') {
    const cells = page.locator('[data-cash-cell]');
    await cells.first().focus();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    spreadsheet = {
      channelToggleRemoved: !(await page.getByText('New Loan, Savings & Renewal:', { exact: true }).count()),
      selectionSummary: await page.locator('[data-cashbook-selection-summary]').innerText(),
      focusedCell: await page.evaluate(() => document.activeElement?.getAttribute('data-cash-cell')),
    };
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.getByRole('button', { name: /^Daily work/ }).click();
    const menuLink = page.locator('nav').getByRole('link', { name: /^Register/ });
    const [headerBox, menuBox] = await Promise.all([
      page.getByRole('banner').boundingBox(),
      menuLink.boundingBox(),
    ]);
    stacking = {
      menuVisible: await menuLink.isVisible(),
      menuBelowHeader: Boolean(headerBox && menuBox && menuBox.y >= headerBox.y),
      headerZ: await page.getByRole('banner').evaluate((el) => getComputedStyle(el).zIndex),
      toolbarZ: await page.locator('[data-cashbook-grid]').evaluate((el) => getComputedStyle(el.previousElementSibling).zIndex),
    };
  }

  const branchId = await page.locator('select').first().inputValue();
  const date = await page.locator('input[type="date"]').first().inputValue();
  const layout = await page.evaluate(() => ({
    title: document.title,
    equation: document.body.innerText.includes('Live cash equation'),
    cashDifference: document.body.innerText.toLowerCase().includes('cash difference'),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });

  let endpoints = null;
  if (name === 'desktop-light') {
    const query = `branchId=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`;
    const [csv, xlsx, png, print] = await Promise.all([
      context.request.get(`${base}/api/export/cashbook?${query}&format=csv`),
      context.request.get(`${base}/api/export/cashbook?${query}&format=xlsx`),
      context.request.get(`${base}/api/export/cashbook/image?${query}`),
      context.request.get(`${base}/cashbook/print?branch=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`),
    ]);
    const pngBody = await png.body();
    writeFileSync(`${output}/share-summary.png`, pngBody);
    endpoints = {
      csv: { status: csv.status(), type: csv.headers()['content-type'] },
      xlsx: { status: xlsx.status(), type: xlsx.headers()['content-type'] },
      png: { status: png.status(), type: png.headers()['content-type'], bytes: pngBody.length },
      print: { status: print.status(), type: print.headers()['content-type'] },
    };
  }

  await context.close();
  return { name, layout, spreadsheet, stacking, endpoints, errors };
}

const results = [];
results.push(await check('desktop-light', { width: 1600, height: 1000 }));
results.push(await check('desktop-dark', { width: 1600, height: 1000 }, true));
results.push(await check('mobile-light', { width: 390, height: 844 }));
console.log(JSON.stringify(results, null, 2));
await browser.close();
