import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const output = 'screenshots/directory-current';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="identifier"], input[name="email"], input[type="email"], input[type="text"]', 'admin@bank.test');
await page.fill('input[type="password"]', 'Maturity@2026');
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes('/login'));

await page.goto(`${base}/customers`, { waitUntil: 'networkidle' });
await page.locator('main button[aria-expanded="false"]').first().click();
await page.waitForTimeout(250);
await page.locator('main button[aria-expanded="false"]').first().click();
await page.waitForTimeout(250);
const customerText = await page.locator('main').innerText();
const customerTextLower = customerText.toLowerCase();
const customerPdf = await page.locator('a[href*="/customers/"][href$="/statement"]').first().getAttribute('href');
await page.screenshot({ path: `${output}/customer-expanded.png`, fullPage: false });

await page.goto(`${base}/agents`, { waitUntil: 'networkidle' });
await page.locator('main button[aria-expanded="false"]').first().click();
await page.waitForTimeout(250);
const agentText = await page.locator('main').innerText();
const agentPdf = await page.locator('a[href*="/agents/"][href$="/statement"]').first().getAttribute('href');
await page.screenshot({ path: `${output}/agent-expanded.png`, fullPage: false });

const [customerResponse, agentResponse] = await Promise.all([
  context.request.get(`${base}${customerPdf}`),
  context.request.get(`${base}${agentPdf}`),
]);
const [customerHtml, agentHtml] = await Promise.all([customerResponse.text(), agentResponse.text()]);
await page.goto(`${base}${customerPdf}`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${output}/customer-statement.png`, fullPage: true });
await page.goto(`${base}${agentPdf}`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${output}/agent-statement.png`, fullPage: true });
const result = {
  customer: {
    lifecycleVisible: ['maturity date', 'form submission', 'approval date', 'payment starts', 'final payment due'].every((label) => customerTextLower.includes(label)),
    scheduleVisible: ['scheduled', 'cash', 'online', 'paid'].every((label) => customerTextLower.includes(label)),
    pdfStatus: customerResponse.status(),
    pdfDetailed: customerHtml.includes('Payment starts') && customerHtml.includes('Remaining'),
  },
  agent: {
    lifecycleVisible: ['Maturity', 'Form', 'Approval', 'Starts', 'Due'].every((label) => agentText.includes(label)),
    pdfStatus: agentResponse.status(),
    pdfDetailed: agentHtml.includes('Detailed customer payment schedules') && agentHtml.includes('Payment starts'),
  },
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
const passed = result.customer.lifecycleVisible && result.customer.scheduleVisible
  && result.customer.pdfStatus === 200 && result.customer.pdfDetailed
  && result.agent.lifecycleVisible && result.agent.pdfStatus === 200 && result.agent.pdfDetailed
  && errors.length === 0;
process.exit(passed ? 0 : 1);
