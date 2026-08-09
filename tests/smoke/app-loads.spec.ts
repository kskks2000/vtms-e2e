import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';

test('로그인 화면이 로드되고 접근성 트리가 활성화된다', async ({ page }) => {
  // Navigate to login and enable Flutter semantics
  // Note: This test expects the Flutter app to render an flt-semantics-placeholder
  // element after loading. The helper will wait up to 90 seconds for it to appear.
  await gotoAndEnableSemantics(page, '/login');

  // Once semantics are enabled, these locators should find the form elements
  await expect(page.getByLabel('이메일')).toBeVisible();
  await expect(page.getByLabel('비밀번호')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '로그인', exact: true }),
  ).toBeVisible();
});
