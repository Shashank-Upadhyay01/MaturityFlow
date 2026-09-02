/**
 * Drive What's new the way a clerk and an admin would.
 *   node --env-file=.env scripts/check-whats-new.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const password = process.env.MF_SEED_PASSWORD;
if (!password) {
  console.error('MF_SEED_PASSWORD is not set');
  process.exit(1);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tmp');
mkdirSync(outDir, { recursive: true });
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
  args: ['--no-sandbox'],
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function login(page, email) {
  page.setDefaultTimeout(120000);
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('input[name="identifier"]').waitFor({ state: 'visible' });
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), undefined, { timeout: 120000 });
}

async function withPage(fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
  });
  try {
    await fn(page, errors);
  } finally {
    await ctx.close();
  }
}

await withPage(async (page, errors) => {
  await login(page, 'admin@bank.test');
  await page.goto(`${base}/whats-new`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=What\'s new', { timeout: 120000 });
  const body = (await page.textContent('body')) ?? '';
  check('admin opens What\'s new', page.url().includes('/whats-new'));
  check('admin can write an update', body.includes('Write an update'));
  check('admin sees the problem tab', body.includes('Something is wrong'));
  check('admin sees the reports tab', body.includes('Reports'));

  check('admin has a title box and a publish button', await page.getByLabel('Short title').count() > 0 && await page.getByRole('button', { name: 'Publish' }).count() > 0);
  await page.screenshot({ path: join(outDir, 'whats-new-admin.png') });
  check('no page errors for admin', errors.length === 0, errors.slice(0, 3).join(' | '));
});

await withPage(async (page, errors) => {
  await login(page, 'cashier@bank.test');
  await page.goto(`${base}/whats-new`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=What\'s new', { timeout: 120000 });
  const body = (await page.textContent('body')) ?? '';
  check('cashier can read updates', body.includes('Cashiers can pay a missed day') || body.includes('No updates have been written yet') || body.includes('updates so far'));
  check('cashier cannot write updates', !body.includes('Write an update'));
  check('cashier cannot open the reports inbox', !body.includes('Reports ('));
  await page.goto(`${base}/whats-new?tab=problem`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=Tell us what went wrong', { timeout: 15000 });
  const afterTab = (await page.textContent('body')) ?? '';
  check('cashier can open the problem form', afterTab.includes('Tell us what went wrong'));
  await page.screenshot({ path: join(outDir, 'whats-new-cashier.png') });
  check('no page errors for cashier', errors.length === 0, errors.slice(0, 3).join(' | '));
});

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ passed: results.filter((r) => r.pass).length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exit(1);
