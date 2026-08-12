import { chromium } from '@playwright/test';
import { gotoAndEnableSemantics } from './tests/support/flutter-semantics';
import { requireEnv } from './tests/support/env';
import { fillReliably } from './tests/support/reliable-fill';
import { assertBundleTargetsApiBaseUrl } from './tests/support/bundle-preflight';
import { assertClockIsSynchronized } from './tests/support/clock-preflight';

async function globalSetup(): Promise<void> {
  const baseURL = requireEnv('BASE_URL');
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  // 로그인이 실패하는 흔한 두 원인(잘못 빌드된 번들, 느린 시계)은 화면에
  // 아무 표시를 남기지 않아 증상이 똑같이 30초 타임아웃으로만 나타난다.
  // 어느 쪽인지 즉시 알 수 있도록 로그인 전에 각각을 직접 확인한다.
  await assertBundleTargetsApiBaseUrl();
  await assertClockIsSynchronized();

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
