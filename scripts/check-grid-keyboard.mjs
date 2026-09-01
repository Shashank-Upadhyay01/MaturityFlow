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
const registerHeaders = await page.locator('table thead th').allTextContents();
for (const label of ['Account number', 'Customer name', 'Agent name', 'Maturity amount', 'Payment date', 'Due payment', 'Recommended payment', 'Paid today', 'Paid in cash', 'Paid online', 'Taken', 'Not taken']) {
  check(`Register shows ${label}`, registerHeaders.some((text) => text.toLowerCase().includes(label.toLowerCase())), registerHeaders.join(' | '));
}
const registerEditableColumns = await page.locator('tbody tr').first().locator('input[data-register-cell="true"]:not(:disabled)').evaluateAll((els) => els.map((el) => el.dataset.registerColumn));
for (const column of ['account', 'customer', 'agent', 'amount', 'paymentDate', 'today', 'perDay', 'paidToday', 'paidCashToday', 'paidOnlineToday']) {
  check(`Register ${column} is editable for Admin`, registerEditableColumns.includes(column), registerEditableColumns.join(', '));
}
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
const opsHeaders = await page.locator('table thead th').allTextContents();
for (const label of ['Account number', 'Customer name', 'Agent name', 'Maturity amount', 'Form submission date', 'Approval date', 'Payment date', 'Due payment', 'Recommended payment', 'Paid today', 'Paid in cash', 'Paid online', 'Taken', 'Not taken']) {
  check(`Operations shows ${label}`, opsHeaders.some((text) => text.toLowerCase().includes(label.toLowerCase())), opsHeaders.join(' | '));
}
const opsEditableColumns = await page.locator('tbody tr').first().locator('input[data-ops-cell="true"]:not(:disabled)').evaluateAll((els) => els.map((el) => el.dataset.opsCol));
for (const column of ['account', 'customer', 'agent', 'amount', 'form', 'review', 'payment', 'due', 'recommended', 'paidToday', 'paidCash', 'paidOnline']) {
  check(`Operations ${column} is editable for Admin`, opsEditableColumns.includes(column), opsEditableColumns.join(', '));
}
const opsGridStyle = await opsCells.first().evaluate((el) => {
  const input = getComputedStyle(el);
  const td = getComputedStyle(el.closest('td'));
  return { radius: input.borderRadius, cellBorder: td.borderTopWidth };
});
check('Operations uses square Excel cells', opsGridStyle.radius === '0px' && opsGridStyle.cellBorder !== '0px', JSON.stringify(opsGridStyle));
const opsScroller = page.locator('table').locator('..');
const opsOverflow = await opsScroller.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
check('All Operations columns fit at 1440px', opsOverflow.scroll <= opsOverflow.client + 2, JSON.stringify(opsOverflow));
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
