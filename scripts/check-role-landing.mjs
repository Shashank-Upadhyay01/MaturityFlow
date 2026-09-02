import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const checks = [];

for (const [email, expected] of [
  ['cmd@bank.test', '/dashboard'],
  ['ceo@bank.test', '/dashboard'],
  ['ops@bank.test', '/maturity-operations'],
  ['admin@bank.test', '/maturities'],
]) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', email);
  await page.fill('input[type="password"]', process.env.MF_SEED_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'));
  const actual = new URL(page.url()).pathname;
  checks.push({ name: `${email} opens ${expected}`, pass: actual === expected, detail: actual });
  await context.close();
}

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();
process.exit(checks.every((item) => item.pass) ? 0 : 1);
