/** Requested-flow regression check: Summary carousel, global search, and committed Plan totals. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const theme = process.env.THEME ?? 'light';
const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: existsSync(executable) ? executable : undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((value) => localStorage.setItem('mf-theme', value), theme);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', 'admin@bank.test');
await page.fill('input[type="password"]', 'Maturity@2026');
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });

await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
check('Summary shows Today and Tomorrow together', await page.getByText('Today', { exact: true }).isVisible() && await page.getByText('Tomorrow', { exact: true }).isVisible());
const before = await page.getByText(/daily withdrawal requirement/).innerText();
await page.getByRole('button', { name: 'Next upcoming day' }).click();
const after = await page.getByText(/daily withdrawal requirement/).innerText();
check('Upcoming carousel advances to another day', before !== after, `${before} -> ${after}`);

const search = page.getByRole('textbox', { name: 'Global search' });
await search.fill('Krishna');
await page.waitForResponse((response) => response.url().includes('/api/search') && response.ok());
check('Global search finds a scoped register customer', await page.getByText('KRISHNA CHAND PATEL', { exact: true }).isVisible());

await page.goto(`${base}/maturities`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Plan', exact: true }).click();
await page.waitForTimeout(700);
const todayPanel = page.locator('div').filter({ has: page.getByRole('heading', { name: 'Today’s withdrawal' }) }).last();
const planText = await todayPanel.innerText();
check('Planner reads today from the committed schedule', !planText.includes('₹0') && !planText.includes('0 customers'), planText.slice(0, 220));
check('Planner does not replace committed rows with projections', !(await page.locator('body').innerText()).includes('includes projected'));
check('Planner shows 12, 6, and 3-part comparisons', await page.getByText('12 parts', { exact: true }).first().isVisible() && await page.getByText('6 parts', { exact: true }).first().isVisible() && await page.getByText('3 parts', { exact: true }).first().isVisible());
await page.screenshot({ path: `C:/Users/Admin/AppData/Local/Temp/plan-${theme}.png`, fullPage: false });

console.log(JSON.stringify({ checks, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
process.exit(checks.every((item) => item.pass) && errors.length === 0 ? 0 : 1);
