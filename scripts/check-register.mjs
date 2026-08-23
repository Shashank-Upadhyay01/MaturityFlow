/**
 * Drive the register the way a clerk would, and prove each new control does what it says.
 * Screenshots land in /tmp so the result can be eyeballed, not just asserted.
 */
import { chromium } from 'playwright';

const base = 'http://localhost:3000';
const email = process.argv[2] ?? 'admin@bank.test';
const tag = process.argv[3] ?? 'admin';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', email);
await page.fill('input[type="password"]', 'Maturity@2026');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
await page.goto(`${base}/maturities`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const rowCount = () => page.locator('table tbody tr').count();
const colIndex = async (label) => {
  const heads = await page.locator('table thead th').allTextContents();
  return heads.findIndex((h) => h.trim().toLowerCase().startsWith(label.toLowerCase()));
};
/** Read a numeric column out of the table, tolerating both <input value> and plain text. */
const columnNumbers = async (label) => {
  const i = await colIndex(label);
  if (i < 0) return [];
  const cells = page.locator(`table tbody tr td:nth-child(${i + 1})`);
  const n = await cells.count();
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const cell = cells.nth(k);
    const input = cell.locator('input');
    const raw = (await input.count()) ? await input.inputValue() : await cell.innerText();
    out.push(Number(String(raw).replace(/[^\d.-]/g, '')) || 0);
  }
  return out;
};
const isDesc = (a) => a.every((v, i) => i === 0 || a[i - 1] >= v);
const isAsc = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

// ---- 1. the Due today badge agrees with the Due today view -------------------------------
const badge = (await page.locator('button', { hasText: 'Due today' }).first().innerText()).match(/(\d+)\s*$/);
const badgeCount = badge ? Number(badge[1]) : -1;
await page.click('button:has-text("Due today")');
await page.waitForTimeout(600);
const dueRows = await rowCount();
check('Due today badge matches the rows it filters to', badgeCount === dueRows, `badge ${badgeCount}, rows ${dueRows}`);
await page.screenshot({ path: `/tmp/chk-${tag}-1-due.png` });

// ---- 2. every row in that view really is due today ---------------------------------------
const todays = await columnNumbers('Today');
check('Every row in Due today has an amount for today', todays.length > 0 && todays.every((v) => v > 0), `min ${Math.min(...todays)}`);

// ---- 3. Due today auto-sorts biggest first -----------------------------------------------
check('Due today auto-sorts largest first', isDesc(todays), todays.join(','));
const sortLabel = await page.locator('select[aria-label="Sort column"]').inputValue();
check('Sort control reflects the applied sort', sortLabel === 'today', sortLabel);

// ---- 4. the direction toggle actually reverses --------------------------------------------
await page.click('button[title*="Descending"]');
await page.waitForTimeout(400);
const asc = await columnNumbers('Today');
check('Direction toggle flips to ascending', isAsc(asc), asc.join(','));
await page.screenshot({ path: `/tmp/chk-${tag}-2-asc.png` });
await page.click('button[title*="Ascending"]');
await page.waitForTimeout(300);

// ---- 5. the day picker filters to exactly that day ----------------------------------------
await page.click('button:has-text("All")');
await page.waitForTimeout(400);
await page.click('button:has-text("Tomorrow")');
await page.waitForTimeout(600);
const payIdx = await colIndex('Payment');
const payCells = page.locator(`table tbody tr td:nth-child(${payIdx + 1}) input`);
const payVals = await payCells.evaluateAll((els) => els.map((e) => e.value));
const uniq = [...new Set(payVals)];
check('Tomorrow shows one payment date only', uniq.length === 1, `dates: ${uniq.join(' | ')} across ${payVals.length} rows`);
await page.screenshot({ path: `/tmp/chk-${tag}-3-tomorrow.png` });

// ---- 6. clearing the day restores the full list -------------------------------------------
await page.click('button:has-text("Clear day")');
await page.waitForTimeout(500);
check('Clear day restores more rows', (await rowCount()) > payVals.length, `${await rowCount()} rows`);

console.log(JSON.stringify({ results, errors: errors.slice(0, 10) }, null, 2));
await browser.close();
process.exit(results.every((r) => r.pass) && errors.length === 0 ? 0 : 1);
