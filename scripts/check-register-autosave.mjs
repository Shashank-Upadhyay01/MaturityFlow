/**
 * Prove that a typed blank Register row becomes durable when keyboard focus leaves it, and that
 * a later edit is also written on blur. This checker refuses every database except the isolated
 * local audit database because it deliberately creates a customer row.
 */
import 'dotenv/config';
import pg from 'pg';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:3100';
const appUrl = new URL(base);
if (!['localhost', '127.0.0.1'].includes(appUrl.hostname)) {
  throw new Error('The autosave checker may only run against a local test server.');
}
if (!process.env.DATABASE_URL || !process.env.MF_SEED_PASSWORD) {
  throw new Error('DATABASE_URL and MF_SEED_PASSWORD must be configured.');
}

const auditUrl = new URL(process.env.DATABASE_URL);
auditUrl.pathname = '/maturityflow_audit';
const db = new pg.Client({ connectionString: auditUrl.toString() });
await db.connect();
const branch = await db.query('SELECT id FROM branches ORDER BY created_at LIMIT 1');
await db.end();
const branchId = branch.rows[0]?.id;
if (!branchId) throw new Error('Seed the scratch database before running this checker.');

const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const failures = [];
page.on('pageerror', (error) => failures.push(`PAGEERROR: ${error.message}`));

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="identifier"]').fill('admin@bank.test');
  await page.locator('input[type="password"]').fill(process.env.MF_SEED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  await page.goto(`${base}/maturities?branch=${encodeURIComponent(branchId)}`, { waitUntil: 'networkidle' });

  const suffix = Date.now().toString().slice(-7);
  const account = `AUTO-${suffix}`;
  const originalName = `AUTOSAVE ${suffix}`;
  const editedName = `${originalName} VERIFIED`;
  const newAccount = page.locator('input[aria-label="Account number for new register row"]').first();
  const newCustomer = page.locator('input[aria-label="Customer name for new register row"]').first();

  // Blank rows are client-side drafts until they are complete. Delete must clear that draft just
  // like it clears a saved cell; otherwise a selected block appears undeletable.
  await newAccount.click();
  await newAccount.fill('DELETE-ME');
  await newAccount.selectText();
  await newAccount.press('Delete');
  if ((await newAccount.inputValue()) !== '') failures.push('Delete did not clear a blank-row draft.');

  await newAccount.fill(account);
  await newCustomer.fill(originalName);
  // This is the clerk's normal path: Down leaves the logical row and must trigger its save.
  await newCustomer.press('ArrowDown');
  await page.getByText('Row autosaved', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator(`input[value="${account}"]`).waitFor({ state: 'visible', timeout: 15_000 });

  // The input's value changes during fill, so locate it by the row's stable accessible name.
  const savedCustomer = page.locator(`input[aria-label="Customer name for ${originalName}"]`).first();
  await savedCustomer.fill(editedName);
  await savedCustomer.press('ArrowDown');
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });

  const persisted = await page.locator(`input[value="${editedName}"]`).count();
  if (persisted !== 1) failures.push(`Expected one persisted edited row, found ${persisted}.`);

  // Selecting the row number and pressing Delete should offer the audited Remove flow. This is
  // how old placeholder rows can be cleaned without silently deleting database history.
  if (persisted === 1) {
    const savedCell = page.locator(`input[value="${editedName}"]`);
    await savedCell.click();
    await savedCell.press('Shift+Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    const removePrompt = page.getByText(/Remove 1 row from the register\?/);
    if ((await removePrompt.count()) !== 1) failures.push('Delete on a complete row did not open Remove confirmation.');
    else await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  console.log(JSON.stringify({ ok: failures.length === 0, account, persisted, failures }, null, 2));
} finally {
  await browser.close();
}

process.exit(failures.length === 0 ? 0 : 1);
