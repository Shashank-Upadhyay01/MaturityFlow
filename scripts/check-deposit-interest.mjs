/**
 * Drive the headquarters deposit-interest page the way CMD/CEO would.
 *   node --env-file=.env scripts/check-deposit-interest.mjs
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
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 120000,
      waitUntil: 'domcontentloaded',
    }),
    page.locator('button[type="submit"]').click(),
  ]);
}

async function withPage(viewport, fn) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  try {
    await fn(page, errors);
  } finally {
    await ctx.close();
  }
  return errors;
}

await withPage({ width: 1440, height: 1100 }, async (page, errors) => {
  await login(page, 'admin@bank.test');
  await page.goto(`${base}/deposit-interest`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=Deposit interest', { timeout: 120000 });
  await page.waitForTimeout(800);

  const body = (await page.textContent('body')) ?? '';
  check('admin lands on the page', page.url().includes('/deposit-interest') && body.includes('Customer name') && body.includes('Maturity date'));
  check('default rate is 8.50%', await page.locator('input[aria-label="Interest rate percent"]').inputValue() === '8.50');
  check('download and upload buttons are present', body.includes('Download template') && body.includes('Upload Excel'));
  await page.getByRole('button', { name: 'Planning' }).click();
  check(
    'nav lists Deposit interest under Planning',
    (await page.locator('a[href="/deposit-interest"]').count()) > 0,
  );
  await page.keyboard.press('Escape');
  check('empty book does not invent a briefing', !body.includes('The largest holding is'));

  const nameInput = page.locator('input[aria-label="Customer name"]').first();
  const dateInput = page.locator('input[aria-label^="Maturity date"]').first();
  const amountInput = page.locator('input[aria-label^="Total deposited amount"]').first();
  await nameInput.fill('Asha Devi');
  await dateInput.fill('2026-08-29');
  await amountInput.fill('100000');
  await page.waitForTimeout(400);

  const firstRow = page.locator('table tbody tr').first();
  const withInterest = (await firstRow.locator('td').nth(3).innerText()).replace(/\s+/g, ' ');
  check('₹1,00,000 at 8.50% shows ₹1,08,500', withInterest.includes('₹1,08,500'), withInterest);
  check('interest line shows +₹8,500', withInterest.includes('+₹8,500'), withInterest);

  const afterType = (await page.textContent('body')) ?? '';
  check('briefing appears once a row is entered', afterType.includes('Briefing') && afterType.includes('₹1,08,500'));
  check('cadence insight appears', afterType.includes('Every working day') && afterType.includes('Book shape'));
  check('maturity date appears in the briefing', afterType.includes('29/08/2026') && afterType.includes('When they mature'));

  await page.locator('input[aria-label="Interest rate percent"]').fill('10');
  await page.waitForTimeout(400);
  const atTen = (await firstRow.locator('td').nth(3).innerText()).replace(/\s+/g, ' ');
  check('changing the rate to 10% updates the third column live', atTen.includes('₹1,10,000'), atTen);

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Deposit interest');
  ws.addRow(['Customer Name', 'Maturity Date', 'Total Deposited Amount']);
  ws.addRow(['Imported One', '29/08/2026', 200000]);
  ws.addRow(['Imported Two', '15/09/2026', 25000]);
  const xlsxPath = join(outDir, 'deposit-interest-sample.xlsx');
  await wb.xlsx.writeFile(xlsxPath);
  await page.locator('input[type="file"]').setInputFiles(xlsxPath);
  await page.locator('[data-import-note]').waitFor({ timeout: 30000 });
  const importNote = ((await page.locator('[data-import-note]').textContent()) ?? '').trim();
  const importedName = await page.locator('input[aria-label="Customer name"]').first().inputValue();
  const afterImport = (await page.textContent('body')) ?? '';
  check(
    'upload replaces the sheet with imported rows',
    importNote.includes('Loaded') && importedName.includes('Imported') && afterImport.includes('₹2,25,000'),
    `${importNote} | ${importedName}`,
  );

  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: 'Download template' }).click();
  const download = await downloadPromise;
  check('download starts an xlsx file', download.suggestedFilename().endsWith('.xlsx'), download.suggestedFilename());

  await page.screenshot({ path: join(outDir, 'deposit-interest-admin.png') });
  check('no page errors for admin', errors.length === 0, errors.slice(0, 4).join(' | '));
});

await withPage({ width: 390, height: 844 }, async (page) => {
  await login(page, 'ceo@bank.test');
  await page.goto(`${base}/deposit-interest`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=Deposit interest', { timeout: 120000 });
  await page.waitForTimeout(500);
  check('CEO can open the page', page.url().includes('/deposit-interest'));
  await page.screenshot({ path: join(outDir, 'deposit-interest-ceo-mobile.png') });
});

await withPage({ width: 1440, height: 900 }, async (page) => {
  await page.addInitScript(() => localStorage.setItem('mf-theme', 'dark'));
  await login(page, 'cmd@bank.test');
  await page.goto(`${base}/deposit-interest`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('text=Deposit interest', { timeout: 120000 });
  await page.getByRole('button', { name: /Load \d+ upcoming/ }).waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const cmdName = page.locator('input[aria-label="Customer name"]').first();
  await cmdName.click();
  await cmdName.fill('CMD Sample');
  const cmdAmount = page.locator('input[aria-label^="Total deposited amount"]').first();
  await cmdAmount.click();
  await cmdAmount.fill('50000');
  await cmdAmount.press('Tab');
  await page.getByText('Briefing', { exact: true }).waitFor({ timeout: 10000 });
  check('CMD can open the page in dark mode', page.url().includes('/deposit-interest'));
  const interestCell = (await page.locator('table tbody tr').first().locator('td').nth(3).innerText()).replace(/\s+/g, ' ');
  check('CMD sees live interest on a typed row', interestCell.includes('₹54,250'), interestCell);
  await page.screenshot({ path: join(outDir, 'deposit-interest-cmd-dark.png') });
});

await withPage({ width: 1440, height: 900 }, async (page) => {
  await login(page, 'cashier@bank.test');
  await page.goto(`${base}/deposit-interest`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);
  const url = page.url();
  const body = (await page.textContent('body')) ?? '';
  check('cashier is redirected away', !url.includes('/deposit-interest'), url);
  const planning = page.getByRole('button', { name: 'Planning' });
  if (await planning.count()) await planning.click();
  check('cashier nav has no deposit-interest link', (await page.locator('a[href="/deposit-interest"]').count()) === 0);
});

await withPage({ width: 1440, height: 900 }, async (page) => {
  await login(page, 'ops@bank.test');
  await page.goto(`${base}/deposit-interest`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('h1', { timeout: 120000 });
  check('operations head (now Admin) can open the page', page.url().includes('/deposit-interest'));
});

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ passed: results.filter((r) => r.pass).length, failed: failed.length, failures: failed }, null, 2));
if (failed.length) process.exit(1);
