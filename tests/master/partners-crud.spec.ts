import { test, expect, type Page } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';
import { fillReliably, fillFieldsReliably } from '../support/reliable-fill';
import { createPartnerViaApi, deletePartnerByCode } from '../support/master-api';

test.use({ storageState: 'playwright/.auth/user.json' });

function uniquePartnerCode(): string {
  return `E2E-PARTNER-${Date.now()}`;
}

// 검색창은 labelText가 아니라 hintText만 쓴다(master_screen.dart의
// toolbar). Flutter는 hintText 기반 접근성 라벨을 필드가 비어있을 때만
// aria-label로 노출하고, 값이 입력되면 그 라벨을 지운다(실측 확인 —
// 입력 직후 getByLabel('검색')이 요소를 0개 찾음). 그래서 fill()로 채운
// 뒤 같은 로케이터로 다시 press('Enter')를 걸면 매번 최대 타임아웃까지
// 멈춘다. 라벨 재조회가 필요 없는 page.keyboard로 우회한다: 비어있을 때
// 한 번 클릭해 포커스를 준 뒤, 이후는 포커스된 엘리먼트 기준으로 타이핑한다.
async function searchAndWaitForSingleResult(
  page: Page,
  code: string,
): Promise<void> {
  await page.getByLabel('검색').click();
  await page.keyboard.type(code, { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('총 1건', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

// 마스터 화면은 백엔드 메타데이터로 구동되는 범용 CRUD이며, 거래처(partners)는
// 그 중 화면이 열렸을 때 기본으로 선택되는 첫 번째 탭이다. 등록/수정만
// 다룬다 — 삭제 확인 다이얼로그는 알려진 버그(README 참고)로 제외했다.
test.describe('마스터 · 거래처 CRUD', () => {
  test('거래처를 등록하면 검색 결과에 나타난다', async ({ page }) => {
    const code = uniquePartnerCode();
    try {
      await gotoAndEnableSemantics(page, '/master');
      await expect(page.getByText('마스터', { exact: true })).toBeVisible();

      // 이 화면의 버튼들은 일반 click()이 hit-test 상으로는 성공한 것처럼
      // 보여도 실제 onPressed 핸들러를 못 띄우는 경우가 실측으로 확인됐다
      // (마스터 화면 삭제 확인 다이얼로그에서 처음 발견, 이후 같은 화면의
      // 다른 버튼에서도 재현). 이 파일의 모든 버튼 클릭은 dispatchEvent를
      // 쓴다.
      await page
        .getByRole('button', { name: '거래처 등록', exact: true })
        .dispatchEvent('click');
      // 두 필드를 연달아 채우면 먼저 채운 필드(거래처 코드)가 나중에 채운
      // 필드 때문에 초기값(빈 문자열)으로 되돌아가는 경우가 있다(실측
      // 확인). fillFieldsReliably가 제출 직전에 전체를 한 번 더 확인해
      // 틀어진 필드를 재입력한다(reliable-fill.ts 참고).
      await fillFieldsReliably([
        { locator: page.getByLabel('거래처 코드 *'), value: code },
        { locator: page.getByLabel('거래처명 *'), value: 'E2E 등록 테스트' },
      ]);
      await page
        .getByRole('button', { name: '등록', exact: true })
        .dispatchEvent('click');
      // 저장 성공 토스트(SnackBar)는 몇 초 후 자동으로 사라지는 일시적인
      // UI라 타이밍이 불안정하다 — 토스트 자체를 확인하는 대신, 실제로
      // 검색 결과에 나타나는지(searchAndWaitForSingleResult가 재시도하며
      // 대기)로 저장 성공을 검증한다.
      await searchAndWaitForSingleResult(page, code);
      await expect(page.getByText(code, { exact: true })).toBeVisible();
    } finally {
      await deletePartnerByCode(code);
    }
  });

  test('거래처를 수정하면 목록에 반영된다', async ({ page }) => {
    const code = uniquePartnerCode();
    // 수정 동작만 검증하는 테스트이므로, 사전 데이터는 UI가 아니라 백엔드
    // API로 직접 만든다 — 매 테스트마다 등록 폼까지 UI로 거치면 텍스트
    // 필드 fill 레이스가 두 번(등록+수정) 겹쳐 불안정해지는 것을 확인했다.
    await createPartnerViaApi(code, 'E2E 수정 전');
    try {
      await gotoAndEnableSemantics(page, '/master');
      await expect(page.getByText('마스터', { exact: true })).toBeVisible();

      await searchAndWaitForSingleResult(page, code);
      await page
        .getByRole('button', { name: '수정', exact: true })
        .first()
        .dispatchEvent('click');
      await expect(
        page.getByText('거래처 수정', { exact: true }),
      ).toBeVisible();

      await fillReliably(page.getByLabel('거래처명 *'), 'E2E 수정 후');
      await page
        .getByRole('button', { name: '저장', exact: true })
        .dispatchEvent('click');
      await expect(page.getByText('E2E 수정 후', { exact: true })).toBeVisible();
    } finally {
      await deletePartnerByCode(code);
    }
  });
});
