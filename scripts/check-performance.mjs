/**
 * Read-only production performance probe.
 *
 *   $env:BASE_URL='https://example.com'
 *   $env:TEST_PASSWORD='...'
 *   node scripts/check-performance.mjs admin@example.com
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const password = process.env.TEST_PASSWORD;
const email = process.argv[2] ?? 'admin@bank.test';
if (!password) throw new Error('TEST_PASSWORD is required.');

const paths = [
  '/maturities',
  '/dashboard',
  '/maturity-calendar',
  '/cashbook',
  '/reports',
  '/agents',
  '/audit',
];
const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

async function navigate(path) {
  const started = performance.now();
  const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const domMs = Math.round(performance.now() - started);
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  const idleMs = Math.round(performance.now() - started);
  return {
    path,
    status: response?.status() ?? 0,
    domMs,
    idleMs,
    vercelId: response?.headers()['x-vercel-id'] ?? '',
  };
}

const login = await navigate('/login');
await page.fill('#identifier', email);
await page.fill('#password', password);
const loginStarted = performance.now();
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 }),
  page.click('button[type="submit"]'),
]);
const signInMs = Math.round(performance.now() - loginStarted);

const firstPass = [];
for (const path of paths) firstPass.push(await navigate(path));
const warmPass = [];
for (const path of paths) warmPass.push(await navigate(path));

console.log(JSON.stringify({ base, login, signInMs, firstPass, warmPass, errors }, null, 2));
await browser.close();
