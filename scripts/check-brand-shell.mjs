import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const outputRoot = process.env.TEMP ?? process.cwd();
const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});

async function verifyLogin(theme, viewport, suffix) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((selectedTheme) => localStorage.setItem('mf-theme', selectedTheme), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email or username').waitFor();
  await page.getByRole('heading', { name: 'KGGNL Core' }).waitFor();
  assert.match(await page.title(), /KGGNL Core/);
  const password = page.getByLabel('Password', { exact: true });
  assert.equal(await password.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  assert.equal(await password.getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  assert.equal(await password.getAttribute('type'), 'password');
  await page.getByText('Created and developed by Shashank Upadhyay').waitFor();
  await page.screenshot({ path: `${outputRoot}/maturityflow-login-${suffix}.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
}

await verifyLogin('light', { width: 1440, height: 900 }, 'desktop-light');
await verifyLogin('dark', { width: 390, height: 844 }, 'mobile-dark');

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.getByLabel('Email or username').fill('admin@bank.test');
await page.getByLabel('Password', { exact: true }).fill('Maturity@2026');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await page.getByText('Created and developed by Shashank Upadhyay').waitFor();
await page.getByText('KGGNL Core', { exact: true }).waitFor();
await page.getByRole('button', { name: 'Directory' }).click();
await page.locator('[data-nav-icon="customers"]').waitFor();
await page.locator('[data-nav-icon="agents"]').waitFor();
assert.equal(await page.locator('[data-nav-icon="customers"]').count(), 1);
assert.equal(await page.locator('[data-nav-icon="agents"]').count(), 1);
await page.screenshot({ path: `${outputRoot}/maturityflow-navigation.png`, fullPage: false });
assert.deepEqual(errors, []);

console.log(JSON.stringify({
  ok: true,
  screenshots: [
    `${outputRoot}/maturityflow-login-desktop-light.png`,
    `${outputRoot}/maturityflow-login-mobile-dark.png`,
    `${outputRoot}/maturityflow-navigation.png`,
  ],
}, null, 2));

await context.close();
await browser.close();
