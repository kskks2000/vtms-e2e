import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';

test('로그인 화면이 로드되고 접근성 트리가 활성화된다', async ({ page }) => {
  // flt-semantics-placeholder가 나타나고 사라질 때까지 각각 최대 30초씩
  // 기다린다(내부 대기 예산 최대 60초). 테스트 타임아웃은 config에서 90초로
  // 설정되어 있어 이 예산을 넉넉히 수용한다.
  await gotoAndEnableSemantics(page, '/login');

  // Once semantics are enabled, these locators should find the form elements
  await expect(page.getByLabel('이메일')).toBeVisible();
  await expect(page.getByLabel('비밀번호')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '로그인', exact: true }),
  ).toBeVisible();
});
