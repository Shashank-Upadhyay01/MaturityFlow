import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3000/login');
  await page.fill('#identifier', 'admin');
  await page.fill('#password', process.env.MF_SEED_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((url) => !url.pathname.includes('/login'));
  await page.goto('http://localhost:3000/maturities', { waitUntil: 'networkidle' });
  await page.locator('[data-register-tab="missed"]').click();
  await page.waitForTimeout(500);

  const customTaken = page.locator('button[title="Taken — open custom payment for this missed day"]').first();
  if (!(await customTaken.isVisible())) throw new Error('No admin custom-payment control was shown for a missed day.');
  await customTaken.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: /./ }).waitFor();
  if (!(await dialog.locator('#take-pay-kicker').isVisible())) {
    throw new Error('Missed-day Taken did not open the payment editor directly.');
  }
  const selected = dialog.locator('input[type="checkbox"]:checked');
  if ((await selected.count()) !== 1) throw new Error('The selected missed day was not preselected exactly once.');
  if (!(await dialog.getByText('Visit total (cash)', { exact: true }).first().isVisible())) {
    throw new Error('Custom cash amount is unavailable.');
  }
  if (!(await dialog.getByText('Online (optional)', { exact: true }).first().isVisible())) {
    throw new Error('Custom online amount is unavailable.');
  }
  console.log('PASS admin missed-day Taken opens the custom payment editor with the day selected');
} finally {
  await browser.close();
}
