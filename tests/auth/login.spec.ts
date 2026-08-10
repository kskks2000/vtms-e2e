import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';
import { requireEnv } from '../support/env';
import { fillReliably } from '../support/reliable-fill';

test('올바른 계정으로 로그인하면 메인 화면으로 이동한다', async ({
  page,
}) => {
  await gotoAndEnableSemantics(page, '/login');

  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  await fillReliably(page.getByLabel('이메일'), email);
  await fillReliably(page.getByLabel('비밀번호'), password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await page.waitForURL('**/master');
  await expect(page.getByText('마스터', { exact: true })).toBeVisible();
});

test('잘못된 비밀번호로 로그인하면 에러 메시지가 표시되고 로그인 화면에 머문다', async ({
  page,
}) => {
  await gotoAndEnableSemantics(page, '/login');

  const email = requireEnv('TEST_USER_EMAIL');
  const wrongPassword = 'wrong-password-e2e-check';

  await fillReliably(page.getByLabel('이메일'), email);
  await fillReliably(page.getByLabel('비밀번호'), wrongPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await expect(
    page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('빈 값으로 제출하면 입력 검증 메시지가 표시된다', async ({ page }) => {
  await gotoAndEnableSemantics(page, '/login');

  await page.getByRole('button', { name: '로그인', exact: true }).click();

  // getByText 대신 정확한 span 선택자를 쓴다: Flutter의 스크린리더 라이브
  // 리전 알리미가 같은 텍스트를 두 번째 접근성 노드로 중복 노출해
  // getByText가 strict-mode 충돌(두 개 이상 매치)로 실패한다.
  await expect(
    page.locator('span:text-is("이메일을 입력해 주세요.")'),
  ).toBeVisible();
  await expect(
    page.locator('span:text-is("비밀번호를 입력해 주세요.")'),
  ).toBeVisible();
});
