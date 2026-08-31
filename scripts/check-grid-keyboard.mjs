import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', 'admin@bank.test');
await page.fill('input[type="password"]', 'Maturity@2026');
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes('/login'));

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });

await page.goto('http://localhost:3000/maturities', { waitUntil: 'networkidle' });
const registerCells = page.locator('input[data-register-cell="true"]:not(:disabled)');
await registerCells.first().focus();
const registerBefore = await registerCells.first().evaluate((el) => ({
  row: el.dataset.registerRow,
  col: el.dataset.registerColumn,
  y: window.scrollY,
}));
await page.keyboard.press('ArrowDown');
const registerAfter = await page.evaluate(() => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    ? { row: el.dataset.registerRow, col: el.dataset.registerColumn, y: window.scrollY }
    : { row: undefined, col: undefined, y: window.scrollY };
});
check(
  'Register ArrowDown keeps focus in the same column without page scrolling',
  registerAfter.row !== registerBefore.row && registerAfter.col === registerBefore.col && registerAfter.y === registerBefore.y,
  JSON.stringify({ registerBefore, registerAfter }),
);

await page.goto('http://localhost:3000/maturity-operations', { waitUntil: 'networkidle' });
const opsCells = page.locator('input[data-ops-cell="true"]:not(:disabled)');
await opsCells.first().focus();
const original = await opsCells.first().inputValue();
await page.keyboard.press('Control+A');
await page.keyboard.press('Backspace');
check('Operations cell accepts Backspace/Delete editing', (await opsCells.first().inputValue()) === '');
await page.keyboard.press('Escape');
check('Escape restores the uncommitted Operations value', (await opsCells.first().inputValue()) === original);
const opsBefore = await opsCells.first().evaluate((el) => ({
  row: el.dataset.opsRow,
  col: el.dataset.opsCol,
  y: window.scrollY,
}));
await page.keyboard.press('ArrowDown');
const opsAfter = await page.evaluate(() => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    ? { row: el.dataset.opsRow, col: el.dataset.opsCol, y: window.scrollY }
    : { row: undefined, col: undefined, y: window.scrollY };
});
check(
  'Operations ArrowDown keeps focus in the same column without page scrolling',
  opsAfter.row !== opsBefore.row && opsAfter.col === opsBefore.col && opsAfter.y === opsBefore.y,
  JSON.stringify({ opsBefore, opsAfter }),
);

console.log(JSON.stringify({ checks }, null, 2));
await browser.close();
process.exit(checks.every((item) => item.pass) ? 0 : 1);
