import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', 'admin@bank.test');
await page.fill('input[type="password"]', process.env.MF_SEED_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes('/login'));
await page.goto(`${base}/maturity-operations`, { waitUntil: 'networkidle' });

check('Desktop has no sidebar', (await page.locator('aside').count()) === 0);
check('Summary is a direct top-bar destination', await page.locator('nav').getByRole('link', { name: 'Summary', exact: true }).isVisible());
for (const category of ['Daily work', 'Planning', 'Directory', 'Administration']) {
  check(`Desktop shows ${category}`, await page.getByRole('button', { name: new RegExp(`^${category}`) }).isVisible());
}
await page.getByRole('button', { name: /^Planning/ }).click();
const planningLinks = await page.locator('nav').getByRole('link').allTextContents();
check('Summary is no longer inside Planning', planningLinks.filter((text) => text.trim() === 'Summary').length === 1, planningLinks.join(' | '));
await page.getByRole('button', { name: /^Planning/ }).click();

await page.getByRole('button', { name: /^Daily work/ }).click();
const dailyLinks = await page.locator('nav').getByRole('link').allTextContents();
for (const destination of ['Register', 'Daily cashbook', 'Maturities', 'Payout desk', 'Follow-up']) {
  check(`Daily work contains ${destination}`, dailyLinks.some((text) => text.includes(destination)), dailyLinks.join(' | '));
}
await page.screenshot({ path: 'C:/tmp/top-navigation-desktop.png', fullPage: false });

const desktopOverflow = await page.evaluate(() => ({
  client: globalThis.document.documentElement.clientWidth,
  scroll: globalThis.document.documentElement.scrollWidth,
}));
check('Desktop shell has no horizontal page overflow', desktopOverflow.scroll <= desktopOverflow.client + 2, JSON.stringify(desktopOverflow));

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
const mobileToggle = page.getByRole('button', { name: 'Open navigation' });
check('Mobile uses a top navigation toggle', await mobileToggle.isVisible());
await mobileToggle.click();
check('Mobile navigation keeps Summary outside category panels', await page.locator('nav').getByRole('link', { name: 'Summary', exact: true }).isVisible());
for (const category of ['Daily work', 'Planning', 'Directory', 'Administration']) {
  check(`Mobile shows ${category}`, await page.getByRole('heading', { name: category }).isVisible());
}
check('Mobile menu opens from the top', (await page.locator('aside').count()) === 0);
await page.screenshot({ path: 'C:/tmp/top-navigation-mobile.png', fullPage: false });

const mobileOverflow = await page.evaluate(() => ({
  client: globalThis.document.documentElement.clientWidth,
  scroll: globalThis.document.documentElement.scrollWidth,
}));
check('Mobile shell has no horizontal page overflow', mobileOverflow.scroll <= mobileOverflow.client + 2, JSON.stringify(mobileOverflow));

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();
process.exit(checks.every((item) => item.pass) ? 0 : 1);
