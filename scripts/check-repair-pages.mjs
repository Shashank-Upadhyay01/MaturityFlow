import 'dotenv/config';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This check uses local demo accounts only.');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.locator('#identifier').fill('admin@bank.test');
  await page.locator('#password').fill(process.env.MF_SEED_PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'));
  for (const route of ['/customers', '/maturities', '/payouts', '/account', '/settings/users', '/settings/operations-health', '/import', '/dashboard']) {
    const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
    if (response.status() !== 200 || new URL(page.url()).pathname !== route) throw new Error(`${route}: unexpected status or redirect`);
    if (!(await page.locator('main').innerText()).trim()) throw new Error(`${route}: empty page`);
    console.log(`PASS ${route}`);
  }
  await page.goto(`${base}/maturities`, { waitUntil: 'networkidle' });
  const dueTab = page.locator('[data-register-tab="due"]');
  const count = Number((await dueTab.innerText()).match(/(\d+)\s*$/)?.[1] ?? 0);
  await dueTab.click();
  await page.waitForTimeout(500);
  const rows = await page.locator('tr[data-register-row]').count();
  if (rows !== count) throw new Error(`Due today badge ${count} differs from ${rows} displayed rows`);
  console.log(`PASS Due today badge: ${rows} rows`);
  mkdirSync('tmp', { recursive: true });
  await page.screenshot({ path: 'tmp/repair-register.png' });
  await page.goto(`${base}/customers`, { waitUntil: 'networkidle' });
  const customer = page.locator('main button[aria-expanded]').first();
  if (await customer.count()) {
    await customer.click();
    if (await customer.getAttribute('aria-expanded') !== 'true') throw new Error('Customer plan did not expand');
    console.log('PASS customer plan expansion');
  }
  const statement = page.locator('main a[href*="/statement"]').first();
  if (await statement.count()) {
    const href = await statement.getAttribute('href');
    const response = await page.goto(new URL(href, base).href, { waitUntil: 'networkidle' });
    if (response.status() !== 200) throw new Error('Customer statement failed');
    console.log('PASS customer statement');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS no browser runtime errors');
} finally {
  await browser.close();
}
