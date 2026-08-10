import { chromium } from '@playwright/test';
import { gotoAndEnableSemantics } from './tests/support/flutter-semantics';
import { requireEnv } from './tests/support/env';
import { fillReliably } from './tests/support/reliable-fill';

async function globalSetup(): Promise<void> {
  const baseURL = requireEnv('BASE_URL');
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    await gotoAndEnableSemantics(page, '/login');
    await fillReliably(page.getByLabel('이메일'), email);
    await fillReliably(page.getByLabel('비밀번호'), password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await page.waitForURL('**/master', { timeout: 30_000 });

    await context.storageState({ path: 'playwright/.auth/user.json' });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
