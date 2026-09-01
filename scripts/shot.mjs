/**
 * Log in and screenshot a page. Used to eyeball every UI change before it ships.
 *   node scripts/shot.mjs <path> <out.png> [email] [width] [height]
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const path = process.argv[2] ?? '/maturities';
const out = process.argv[3] ?? '/tmp/shot.png';
const email = process.argv[4] ?? 'admin@bank.test';
const width = Number(process.argv[5] ?? 1440);
const height = Number(process.argv[6] ?? 900);
const base = process.env.BASE_URL ?? 'http://localhost:3000';

// That container path only exists in the Linux sandbox; everywhere else (Windows
// included) fall through to the browser `npx playwright install chromium` put down.
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
if (process.env.THEME === 'dark' || process.env.THEME === 'light') {
  await ctx.addInitScript((theme) => localStorage.setItem('mf-theme', theme), process.env.THEME);
}
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', email);
await page.fill('input[type="password"]', 'Maturity@2026');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});

await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: out, fullPage: false });

const title = await page.title();
const body = (await page.textContent('body')) ?? '';
console.log(JSON.stringify({
  url: page.url(),
  title,
  chars: body.length,
  errors: errors.slice(0, 12),
}, null, 2));

await browser.close();
