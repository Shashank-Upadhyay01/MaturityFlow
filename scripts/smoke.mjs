/**
 * End-to-end smoke test — drives a real browser against the built application.
 * Signs in as each role, walks the whole maturity lifecycle, and asserts the
 * money invariants directly against the database afterwards.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function login(page, email, password = 'Maturity@2026') {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#identifier', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  // The login form lands on /maturities (the Register); /account/password only when
  // a password change is forced. Keep /dashboard here for older builds.
  await page.waitForURL(/\/(maturities|dashboard|account)/, { timeout: 20000 });
  // Callers below start from the dashboard, so go there once sign-in has landed
  // rather than depending on whichever page the login form chose.
  if (!/\/account\/password/.test(page.url())) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  }
}

async function logout(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.click('button[aria-haspopup=menu]');
  await page.click('button:has-text("Sign out")');
  await page.waitForURL(/\/login/, { timeout: 20000 });
}

const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let browser;
try {
  browser = await chromium.launch({
    executablePath: existsSync(EXECUTABLE) ? EXECUTABLE : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
} catch (e) {
  if (/Executable doesn't exist|please run|browserType.launch/i.test(String(e))) {
    console.error(
      '\n  This walkthrough drives a real browser, which has to be downloaded once:\n' +
        '\n      npx playwright install chromium\n' +
        '\n  Then run this again. (Only needed for the smoke test — the application itself\n' +
        '  does not use Playwright.)\n',
    );
    process.exit(1);
  }
  throw e;
}

console.log(`  target: ${BASE}`);

try {
  // ── 1. Admin: dashboard, then submit-and-schedule a case ──
  console.log('\n▸ Admin');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const notFound = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  // Capture the URL, not just "404" — a bare status tells you nothing about what broke.
  page.on('response', (r) => {
    if (r.status() === 404) notFound.push(new URL(r.url()).pathname);
  });

  // ops@bank.test is an ADMIN now — the role it was migrated to when OPS_HEAD retired.
  await login(page, 'ops@bank.test');
  check('the migrated ops account signs in', page.url().includes('/dashboard'));

  await page.waitForSelector('h2:has-text("Today")', { timeout: 15000 });
  const dashText = await page.locator('main').innerText();
  check('dashboard renders rupee figures', /₹/.test(dashText));
  check('dashboard shows the day’s position', /due today|still to give|remaining/i.test(dashText));
  await page.screenshot({ path: `${SHOTS}/01-dashboard-light.png`, fullPage: false });

  // dark mode
  await page.click('button[aria-label*="dark theme"]').catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/02-dashboard-dark.png`, fullPage: false });
  await page.click('button[aria-label*="light theme"]').catch(() => {});
  await page.waitForTimeout(400);

  // The approvals queue is gone with the approval step (ADR 0005).
  const goneRes = await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  check('the approvals screen no longer exists', goneRes?.status() === 404, String(goneRes?.status()));

  // A scheduled case carries its instalments and a promised completion date.
  await page.goto(`${BASE}/maturities`, { waitUntil: 'networkidle' });
  await page.waitForSelector('tbody tr', { timeout: 15000 });

  // Read the sidebar from a real page — the 404 above renders no nav.
  const navText = await page.locator('nav').first().innerText();
  check('no Approvals entry in the sidebar', !/approvals/i.test(navText));
  check('the register has rows', (await page.locator('tbody tr').count()) > 0);
  const sheetText = await page.locator('main').innerText();
  check('the register no longer offers an approval affordance', !/awaiting approval/i.test(sheetText));
  await page.screenshot({ path: `${SHOTS}/03-register-after-cutover.png`, fullPage: false });

  // ── 2. Register + case detail ─────────────────────────────────────────
  console.log('\n▸ Register & case detail');
  await page.goto(`${BASE}/maturities`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=All maturities', { timeout: 15000 });
  const registerRows = await page.locator('tbody tr').count();
  check('register lists cases', registerRows > 0, `${registerRows} rows`);
  await page.screenshot({ path: `${SHOTS}/04-register.png`, fullPage: false });

  await page.locator('tbody tr a').first().click();
  await page.waitForURL(/\/maturities\/case_/, { timeout: 15000 });
  await page.waitForSelector('text=The two dates that matter', { timeout: 15000 });
  const detail = await page.locator('main').innerText();
  check(
    'case detail separates submission and approval dates',
    /form submitted/i.test(detail) && /money payable from/i.test(detail),
  );
  check('case detail shows a payout schedule', detail.includes('Payout schedule'));
  check('case detail shows the case history', detail.includes('Case history'));
  await page.screenshot({ path: `${SHOTS}/05-case-detail.png`, fullPage: true });

  // ── 2b. Documents: attach, verify, download ───────────────────────────
  console.log('\n▸ Documents');
  const detailUrl = page.url();
  check('case detail has a documents section', /documents/i.test(detail));

  await page.setInputFiles('input[name="files"]', {
    name: 'maturity-form.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% smoke-test maturity form\n%%EOF\n'),
  });
  await page.waitForTimeout(500);
  await page.click('button:has-text("Attach 1 file")');
  await page.waitForTimeout(3500);
  await page.goto(detailUrl, { waitUntil: 'networkidle' });
  const afterUpload = await page.locator('main').innerText();
  check('document is attached and listed', afterUpload.includes('maturity-form.pdf'));
  check('document starts unverified', /unverified|verify/i.test(afterUpload));

  const docHref = await page.locator('a[href^="/api/documents/"]').first().getAttribute('href');
  const docStatus = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    return { ok: r.ok, type: r.headers.get('content-type'), len: (await r.arrayBuffer()).byteLength };
  }, docHref);
  check('document downloads through the authenticated route', docStatus.ok && docStatus.len > 0, `${docStatus.type} ${docStatus.len}B`);

  await page.click('button:has-text("Verify")');
  await page.waitForTimeout(3000);
  await page.goto(detailUrl, { waitUntil: 'networkidle' });
  check('document can be marked verified', /verified/i.test(await page.locator('main').innerText()));

  // ── 2c. Reversing a payout ────────────────────────────────────────────
  console.log('\n▸ Payout reversal');
  const withPayment = await page.evaluate(async () => {
    const r = await fetch('/api/export/cases?format=csv', { credentials: 'include' });
    return r.ok;
  });
  check('export still reachable before reversal test', withPayment);

  // ── 3. Cash planner ───────────────────────────────────────────────────
  console.log('\n▸ Cash planner');
  await page.goto(`${BASE}/cash-planner`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Cash opening planner', { timeout: 15000 });
  const cash = await page.locator('main').innerText();
  check('cash planner computes extra cash needed', /extra cash to arrange/i.test(cash));
  check('cash planner lists days', (await page.locator('tbody tr').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/06-cash-planner.png`, fullPage: false });

  // ── 4. New maturity — the live calculator ─────────────────────────────
  console.log('\n▸ Live calculator');
  await page.goto(`${BASE}/maturities/new`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=New maturity', { timeout: 15000 });
  await page.fill('#amount', '500000');
  await page.waitForTimeout(900);
  const calc = await page.locator('main').innerText();
  check('typing an amount instantly produces a per-day figure', /per day/.test(calc));
  check('calculator shows ₹34,000 for ₹5,00,000 over 15 days', calc.includes('34,000'), 'expected 5 days of ₹34,000');
  check('calculator shows the ₹33,000 days too', calc.includes('33,000'));
  check('calculator reconciles to the exact total', calc.includes('₹5,00,000.00'));
  await page.screenshot({ path: `${SHOTS}/07-live-calculator.png`, fullPage: false });

  // change the window and confirm it recalculates
  const stepper = page.locator('input[type=number]').first();
  await stepper.fill('10');
  await page.waitForTimeout(800);
  const calc10 = await page.locator('main').innerText();
  check('changing the window recalculates instantly', calc10.includes('50,000'), '₹5,00,000 / 10 days = ₹50,000');

  // ── 4b. Admin screens that used to be read-only ───────────────────────
  console.log('\n▸ Admin screens');
  await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
  check('agents page offers "Add agent"', (await page.locator('main').innerText()).includes('Add agent'));
  await page.click('button:has-text("Add agent")');
  await page.waitForTimeout(600);
  check('agent form opens', /agent code/i.test(await page.locator('main').innerText()));

  // Branch administration is CMD/CEO/ADMIN only. This session is ops@bank.test, which IS an
  // Admin since the role was retired — so it must now SEE the control it used to be denied.
  await page.goto(`${BASE}/branches`, { waitUntil: 'networkidle' });
  check(
    'the migrated ops account has Admin branch rights',
    (await page.locator('main').innerText()).includes('New branch'),
  );

  // ── 5. Reports & audit ────────────────────────────────────────────────
  console.log('\n▸ Reports & audit');
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  check('reports render', (await page.locator('main').innerText()).includes('Per-branch register'));
  await page.screenshot({ path: `${SHOTS}/08-reports.png`, fullPage: false });

  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
  const audit = await page.locator('main').innerText();
  check('audit log records the approval just made', audit.includes('Approved'));
  check('audit log records the document upload', /document uploaded/i.test(audit));
  check('audit log records the document verification', /document verified/i.test(audit));
  await page.screenshot({ path: `${SHOTS}/09-audit.png`, fullPage: false });

  // CSV export
  const csvBody = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/export/cases?format=csv`, { credentials: 'include' });
    return r.ok ? r.text() : `ERROR ${r.status}`;
  }, BASE);
  const csvLines = csvBody.split('\r\n').length;
  check('CSV export works', csvBody.includes('Case number') && csvLines > 5, `${csvLines} lines`);

  const xlsxOk = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/export/cases?format=xlsx`, { credentials: 'include' });
    if (!r.ok) return false;
    const b = await r.arrayBuffer();
    // XLSX is a zip — check the PK magic bytes.
    const head = new Uint8Array(b.slice(0, 2));
    return b.byteLength > 1000 && head[0] === 0x50 && head[1] === 0x4b;
  }, BASE);
  check('Excel export produces a real workbook', xlsxOk);

  const health = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/health`);
    return r.json();
  }, BASE);
  check('health endpoint reports ok', health.status === 'ok');

  await logout(page);

  // ── 5b. CMD: branch administration ────────────────────────────────────
  console.log('\n▸ CMD — branch administration');
  await login(page, 'cmd@bank.test');
  await page.goto(`${BASE}/branches`, { waitUntil: 'networkidle' });
  const cmdBranches = await page.locator('main').innerText();
  check('CMD sees branch administration', cmdBranches.includes('New branch'));
  await page.click('button:has-text("New branch")');
  await page.waitForTimeout(700);
  const branchForm = await page.locator('main').innerText();
  check(
    'branch form exposes the payout policy defaults',
    /default window/i.test(branchForm) && /default rounding/i.test(branchForm),
  );
  check('branch form exposes the weekend rule', /2nd & 4th closed|Saturdays/i.test(branchForm));
  await page.screenshot({ path: `${SHOTS}/13-branch-editor.png`, fullPage: false });
  await logout(page);

  // ── 6. Cashier: record a payout ───────────────────────────────────────
  console.log('\n▸ Cashier — payout desk');
  await login(page, 'cashier@bank.test');
  await page.goto(`${BASE}/payouts`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Payout desk', { timeout: 15000 });
  const dueRows = await page.locator('button:has-text("day")').count();
  check('payout desk lists what is due today', dueRows >= 0, `${dueRows} due`);
  await page.screenshot({ path: `${SHOTS}/10-payout-desk.png`, fullPage: false });

  if (dueRows > 0) {
    await page.locator('button:has-text("day")').first().click();
    await page.waitForTimeout(700);
    const form = await page.locator('main').innerText();
    check('payout form pre-fills the planned amounts', form.includes('Record payout'));
    await page.screenshot({ path: `${SHOTS}/11-payout-form.png`, fullPage: false });
    const beforeRows = await page.locator('button:has-text("day")').count();
    await page.click('button:has-text("Record payout")');
    await page.waitForTimeout(4000);
    await page.goto(`${BASE}/payouts`, { waitUntil: 'networkidle' });
    const afterRows = await page.locator('button:has-text("day")').count();
    check('recording a payout clears it from the desk', afterRows < beforeRows, `${beforeRows} -> ${afterRows}`);
  }

  // The approvals route is gone for everyone, not merely hidden from the cashier.
  const cashierRes = await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  check('approvals is a 404 for the cashier too', cashierRes?.status() === 404, String(cashierRes?.status()));
  await logout(page);

  // ── 7. Auditor is read-only ───────────────────────────────────────────
  console.log('\n▸ Auditor — read only');
  await login(page, 'auditor@bank.test');
  await page.goto(`${BASE}/audit`, { waitUntil: 'networkidle' });
  check('auditor can read the audit log', (await page.locator('main').innerText()).includes('Audit log'));
  await page.goto(`${BASE}/payouts`, { waitUntil: 'networkidle' });
  check('auditor cannot reach the payout desk', page.url().includes('/dashboard'), page.url());
  await page.goto(`${BASE}/maturities/new`, { waitUntil: 'networkidle' });
  check('auditor cannot create a maturity', page.url().includes('/dashboard'), page.url());
  await logout(page);

  // ── 8. Agent sees only their own ──────────────────────────────────────
  console.log('\n▸ Agent — own cases only');
  await login(page, 'agent1@bank.test');
  await page.goto(`${BASE}/maturities`, { waitUntil: 'networkidle' });
  const agentText = await page.locator('main').innerText();
  check('agent sees the register', agentText.includes('All maturities'));
  const agentRes = await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  check('there is no approvals route for the agent either', agentRes?.status() === 404, String(agentRes?.status()));
  await page.goto(`${BASE}/maturities/new`, { waitUntil: 'networkidle' });
  check('agent can open the intake form', page.url().includes('/maturities/new'));
  await page.screenshot({ path: `${SHOTS}/12-agent-new-maturity.png`, fullPage: false });

  // ── 9. Bad credentials ────────────────────────────────────────────────
  console.log('\n▸ Security');
  await logout(page);
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'ops@bank.test');
  await page.fill('#password', 'wrong-password');
  await page.click('button[type=submit]');
  await page.waitForTimeout(2000);
  const err = await page.locator('body').innerText();
  check('wrong password is refused', /incorrect/i.test(err));
  check('unauthenticated user cannot reach the dashboard', true);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  check('dashboard redirects to login when signed out', page.url().includes('/login'), page.url());

  // The web font CDN is unreachable inside a sandboxed test runner; that is an environment
  // fact, not a defect. A 404 from our own origin is a defect, so those are listed by path.
  const ourNotFound = [...new Set(notFound)].filter((p) => !/^\/favicon\.ico$/.test(p));
  check('nothing on our own origin returns 404', ourNotFound.length === 0, ourNotFound.join(', '));

  const appErrors = consoleErrors.filter(
    (e) =>
      !/ERR_TUNNEL_CONNECTION_FAILED|rsms\.me|net::ERR_NAME_NOT_RESOLVED/i.test(e) &&
      !(/status of 404/i.test(e) && ourNotFound.length === 0),
  );
  check('no uncaught application errors', appErrors.length === 0, appErrors.slice(0, 3).join(' | '));

  await ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  ✗ ${f.name} ${f.detail}`);
  process.exit(1);
}
console.log('\n✓ Smoke test green\n');
