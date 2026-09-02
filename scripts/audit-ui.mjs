/**
 * Read-only production UI audit.
 *
 * Visits every fixed application route as an Admin, captures the layouts that are most likely
 * to regress at desktop/mobile widths, and reports structural, accessibility and runtime issues.
 * It never submits a business form or changes data.
 *
 *   node scripts/audit-ui.mjs [base-url] [output-directory]
 */
/* global document, getComputedStyle, CSS */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const output = process.argv[3] ?? 'screenshots/ui-audit';
mkdirSync(output, { recursive: true });

const routes = [
  '/dashboard',
  '/maturities',
  '/import',
  '/cashbook',
  '/maturities/new',
  '/maturity-calendar',
  '/payouts',
  '/follow-up',
  '/cash-planner',
  '/customers',
  '/agents',
  '/branches',
  '/reports',
  '/audit',
  '/account',
  '/account/password',
  '/settings/organisation',
  '/settings/holidays',
  '/settings/users',
];

const captures = new Set([
  '/dashboard',
  '/maturities',
  '/cashbook',
  '/maturity-calendar',
  '/payouts',
  '/audit',
  '/settings/users',
]);

const executable = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(executable) ? executable : undefined,
  args: ['--no-sandbox'],
});

function slug(path) {
  return path === '/' ? 'home' : path.slice(1).replaceAll('/', '-');
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.fill('#identifier', 'admin@bank.test');
  await page.fill('#password', process.env.MF_SEED_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 });
  return page;
}

async function inspectPage(page, route, mode) {
  const consoleErrors = [];
  const pageErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const started = performance.now();
  const response = await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  const loadMs = Math.round(performance.now() - started);
  await page.waitForTimeout(120);

  const structure = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) return text;
      }
      const id = element.getAttribute('id');
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
      const nativeLabels = 'labels' in element
        ? [...(element.labels ?? [])].map((label) => label.textContent ?? '').join(' ').trim()
        : '';
      return (
        element.getAttribute('aria-label') ||
        explicit ||
        nativeLabels ||
        element.getAttribute('title') ||
        element.textContent ||
        element.getAttribute('alt') ||
        ''
      ).trim();
    };

    const unnamedControls = [...document.querySelectorAll('button, a[href], input, select, textarea')]
      .filter(visible)
      .filter((element) => !accessibleName(element))
      .slice(0, 20)
      .map((element) =>
        `${element.tagName.toLowerCase()}` +
        `${element.getAttribute('name') ? `[name=${element.getAttribute('name')}]` : ''}` +
        `${element.getAttribute('id') ? `#${element.getAttribute('id')}` : ''}` +
        `${element.getAttribute('placeholder') ? `[placeholder=${element.getAttribute('placeholder')}]` : ''}` +
        `${element.getAttribute('data-cash-cell') ? `[cash-cell=${element.getAttribute('data-cash-cell')}]` : ''}`,
      );

    const missingAlt = [...document.querySelectorAll('img')]
      .filter(visible)
      .filter((image) => image.getAttribute('alt') === null)
      .map((image) => image.getAttribute('src'));

    const documentOverflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const accidentalOverflow = [...document.querySelectorAll('main *')]
      .filter(visible)
      .filter((element) => {
        if (element.closest('.mf-hscroll')) return false;
        const style = getComputedStyle(element);
        return style.overflowX === 'visible' && element.scrollWidth - element.clientWidth > 3;
      })
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        class: String(element.className).slice(0, 120),
        overflow: element.scrollWidth - element.clientWidth,
      }));

    return {
      title: document.title,
      h1Count: document.querySelectorAll('h1').length,
      mainCount: document.querySelectorAll('main').length,
      documentOverflow,
      unnamedControls,
      missingAlt,
      accidentalOverflow,
    };
  });

  if (captures.has(route)) {
    await page.screenshot({ path: `${output}/${mode}-${slug(route)}.png`, fullPage: true });
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  return {
    route,
    status: response?.status() ?? null,
    finalPath: new URL(page.url()).pathname,
    loadMs,
    ...structure,
    consoleErrors,
    pageErrors,
  };
}

async function audit(mode, viewport, colorScheme, selectedRoutes = routes) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await login(context);
  const results = [];
  for (const route of selectedRoutes) results.push(await inspectPage(page, route, mode));
  await context.close();
  return results;
}

try {
  const desktop = await audit('desktop-light', { width: 1440, height: 900 }, 'light');
  const dark = await audit(
    'desktop-dark',
    { width: 1440, height: 900 },
    'dark',
    ['/dashboard', '/maturities', '/cashbook', '/audit'],
  );
  const mobile = await audit(
    'mobile-light',
    { width: 390, height: 844 },
    'light',
    ['/dashboard', '/maturities', '/cashbook', '/maturity-calendar', '/audit'],
  );
  const report = { generatedAt: new Date().toISOString(), base, desktop, dark, mobile };
  writeFileSync(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

  const all = [...desktop, ...dark, ...mobile];
  const failures = all.filter(
    (item) =>
      item.status !== 200 ||
      item.finalPath === '/login' ||
      item.mainCount !== 1 ||
      item.documentOverflow > 3 ||
      item.unnamedControls.length > 0 ||
      item.missingAlt.length > 0 ||
      item.consoleErrors.length > 0 ||
      item.pageErrors.length > 0,
  );
  const timings = desktop.map(({ route, loadMs }) => ({ route, loadMs })).sort((a, b) => b.loadMs - a.loadMs);
  console.log(JSON.stringify({ pages: all.length, failures, slowest: timings.slice(0, 8) }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
