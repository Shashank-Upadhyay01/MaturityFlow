/**
 * Current first-use browser walkthrough. Mutates only the isolated scratch server on port 3100.
 * Seed it first with `npm run db:seed:scratch`, then start it with
 * `node scripts/start-smoke-server.mjs`.
 */
/* global document */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const target = new URL(base);
if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '3100') {
  throw new Error('First-use smoke tests are restricted to the isolated local server on port 3100.');
}

const output = 'screenshots/first-use';
mkdirSync(output, { recursive: true });
const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function login(page, identifier, password = process.env.MF_SEED_PASSWORD) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('#identifier', identifier);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 20_000 });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  console.log('\n▸ Admin first use');
  await login(page, 'admin@bank.test');
  check('admin signs in', !page.url().endsWith('/login'));

  await page.goto(`${base}/maturities`, { waitUntil: 'networkidle' });
  check('empty Register provides spreadsheet rows', (await page.locator('input[data-register-cell="true"]').count()) > 0);
  const firstCell = page.locator('input[data-register-cell="true"]').first();
  await firstCell.focus();
  const firstKey = await firstCell.getAttribute('data-register-column');
  await page.keyboard.press('ArrowRight');
  const rightKey = await page.evaluate(() => document.activeElement?.getAttribute('data-register-column'));
  check('Right Arrow moves to the next editable cell', Boolean(firstKey && rightKey && rightKey !== firstKey), `${firstKey} → ${rightKey}`);
  await page.keyboard.press('ArrowDown');
  const downKey = await page.evaluate(() => document.activeElement?.getAttribute('data-register-column'));
  check('Down Arrow stays in the same column', downKey === rightKey, String(downKey));

  const planResponse = page.waitForResponse((response) => response.url().includes('/api/register/plan'));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  check('lazy Plan endpoint succeeds', (await planResponse).status() === 200);
  await page.getByText('Today’s withdrawal').waitFor({ timeout: 15_000 });
  check('Plan board renders on demand', await page.getByText('Today’s withdrawal').isVisible());

  await page.goto(`${base}/maturities/new`, { waitUntil: 'networkidle' });
  if (await page.locator('#nc-name').isVisible().catch(() => false)) {
    await page.fill('#nc-name', 'First Use Customer');
    await page.fill('#nc-phone', '9000000001');
    await page.fill('#nc-account', 'FU0001');
    await page.getByRole('button', { name: 'Add customer', exact: true }).click();
    await page
      .getByLabel('Choose customer')
      .locator('option', { hasText: 'First Use Customer' })
      .waitFor({ state: 'attached', timeout: 15_000 });
  }
  await page.fill('#amount', '500000');
  await page.fill('#maturityOn', '2026-08-31');
  await page.waitForTimeout(250);
  const preview = await page.locator('main').innerText();
  check('maturity date produces a live exact schedule', /per day/i.test(preview) && /5,00,000/.test(preview));
  await page.getByRole('button', { name: /Submit & schedule/i }).click();
  await page.waitForURL(/\/maturities\/case_/, { timeout: 20_000 });
  const caseText = await page.locator('main').innerText();
  check('first case is submitted and auto-scheduled', /Payout schedule/i.test(caseText));
  check('case detail records the contractual maturity date', /31 Aug 2026|31-08-2026/.test(caseText));
  await page.screenshot({ path: `${output}/case-created.png`, fullPage: true });

  console.log('\n▸ Documents and exports');
  const fileInput = page.locator('input[name="files"]');
  await fileInput.setInputFiles({
    name: 'first-use-maturity-form.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% MaturityFlow first-use verification\n%%EOF\n'),
  });
  await page.getByRole('button', { name: /Attach 1 file/i }).click();
  await page.getByText('first-use-maturity-form.pdf').waitFor({ timeout: 15_000 });
  check('document upload is listed', await page.getByText('first-use-maturity-form.pdf').isVisible());
  const download = page.locator('a[href^="/api/documents/"]').first();
  const href = await download.getAttribute('href');
  const documentOk = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'include' });
    return response.ok && (await response.arrayBuffer()).byteLength > 0;
  }, href);
  check('authenticated document download works', documentOk);

  const exportsOk = await page.evaluate(async () => {
    const [csv, xlsx] = await Promise.all([
      fetch('/api/export/cases?format=csv'),
      fetch('/api/export/cases?format=xlsx'),
    ]);
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    return csv.ok && (await csv.text()).includes('Savings Account Number') && xlsx.ok && bytes[0] === 0x50 && bytes[1] === 0x4b;
  });
  check('CSV and Excel Register exports work', exportsOk);

  console.log('\n▸ Cashbook and audit');
  await page.goto(`${base}/cashbook`, { waitUntil: 'networkidle' });
  const cashCell = page.locator('input[data-cash-cell]').first();
  await cashCell.fill('1250');
  const cashColumn = await cashCell.getAttribute('data-cash-cell');
  await page.keyboard.press('ArrowDown');
  const nextCashCell = await page.evaluate(() => document.activeElement?.getAttribute('data-cash-cell'));
  check('Cashbook Arrow Down keeps focus in its grid', Boolean(nextCashCell && nextCashCell !== cashColumn), `${cashColumn} → ${nextCashCell}`);
  await page.keyboard.press('Delete');
  check('Delete clears the active Cashbook cell', await page.locator(`input[data-cash-cell="${nextCashCell}"]`).inputValue() === '');

  await page.goto(`${base}/audit?q=First+Use+Customer`, { waitUntil: 'networkidle' });
  const auditText = await page.locator('main').innerText();
  check('Audit search finds the first-use case', /First Use Customer/i.test(auditText));
  check('Audit record exposes inspectable metadata', (await page.getByText('Inspect record').count()) > 0);

  const health = await page.evaluate(async () => (await fetch('/api/health')).json());
  check('health endpoint reports ready', health.status === 'ok');
  check('no uncaught browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();

  console.log('\n▸ Role boundaries');
  const auditorContext = await browser.newContext();
  const auditor = await auditorContext.newPage();
  await login(auditor, 'auditor@bank.test');
  await auditor.goto(`${base}/audit`, { waitUntil: 'networkidle' });
  check('auditor can read the audit log', /Audit log/i.test(await auditor.locator('main').innerText()));
  await auditor.goto(`${base}/maturities/new`, { waitUntil: 'networkidle' });
  check('auditor cannot open maturity intake', !auditor.url().includes('/maturities/new'), auditor.url());
  await auditorContext.close();

  const agentContext = await browser.newContext();
  const agent = await agentContext.newPage();
  await login(agent, 'agent1@bank.test');
  await agent.goto(`${base}/maturities`, { waitUntil: 'networkidle' });
  check('agent Register is read-only', (await agent.getByRole('button', { name: /Add rows/i }).count()) === 0);
  await agent.goto(`${base}/maturities/new`, { waitUntil: 'networkidle' });
  check('agent can open maturity intake', agent.url().includes('/maturities/new'));
  await agentContext.close();

  const badContext = await browser.newContext();
  const bad = await badContext.newPage();
  await bad.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await bad.fill('#identifier', 'admin@bank.test');
  await bad.fill('#password', 'wrong-password');
  await bad.click('button[type="submit"]');
  await bad.getByText(/incorrect/i).waitFor({ timeout: 15_000 });
  check('wrong password is refused', bad.url().endsWith('/login'));
  await badContext.close();
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} first-use checks passed`);
if (failed.length) {
  for (const result of failed) console.log(`  ✗ ${result.name}: ${result.detail}`);
  process.exit(1);
}
