import { chromium } from '@playwright/test';
import { gotoAndEnableSemantics } from './tests/support/flutter-semantics';
import { requireEnv } from './tests/support/env';

async function globalSetup(): Promise<void> {
  const baseURL = requireEnv('BASE_URL');
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await gotoAndEnableSemantics(page, '/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/master', { timeout: 30_000 });

  await context.storageState({ path: 'playwright/.auth/user.json' });
  await browser.close();
}

export default globalSetup;
