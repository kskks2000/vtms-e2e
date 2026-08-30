import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';
import { cleanupRowsViaApi } from '../support/master-api';
import { purgeRowsViaDb } from '../support/master-purge';
import { assertCleanupDbMatchesTarget } from '../support/cleanup-target';
import { fetchMasterMetaSync, planFor } from '../support/master-meta';
import {
  createRow,
  deleteFirstRowViaUi,
  editFirstRow,
  searchForSingleRow,
  selectMaster,
} from '../support/master-ui';

test.use({ storageState: 'playwright/.auth/user.json' });

/**
 * 마스터 23종 전체에 대한 UI CRUD. 화면이 백엔드 메타데이터로 구동되는 범용
 * CRUD이므로 테스트도 같은 메타데이터에서 생성한다 — 백엔드에 마스터가 추가되면
 * 스펙을 고치지 않아도 테스트가 함께 늘어난다.
 *
 * 삭제는 반드시 **화면에서** 한다(행의 삭제 아이콘 → '삭제 확인' → '삭제').
 * API 삭제는 테스트가 중간에 실패해 UI 삭제에 도달하지 못했을 때 개발 DB에
 * 찌꺼기를 남기지 않기 위한 afterEach 안전망으로만 쓴다.
 *
 * 메타데이터는 수집 시점에 동기로 읽는다(master-meta.ts의 주석 참고).
 */
const masters = fetchMasterMetaSync();

// 물리 정리(purgeRowsViaDb)가 DB에 직접 붙고, 그 DB는 API_BASE_URL이 아니라
// ../vtms/backend 설정에서 온다. 두 대상이 갈라지면 엉뚱한 DB를 지우므로 쓰기
// 전에 같은 DB인지 확인한다 — 자세한 사유는 cleanup-target.ts 참고.
test.beforeAll(async () => {
  await assertCleanupDbMatchesTarget();
});

function uniqueToken(): string {
  return `E2E-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

for (const meta of masters) {
  test(`마스터 · ${meta.label}(${meta.key}) 등록 → 수정 → 화면에서 삭제`, async ({
    page,
  }) => {
    const token = uniqueToken();
    const plan = await planFor(meta, masters, token);

    // 구조적으로 UI 한 바퀴가 불가능한 마스터는 조용히 빠뜨리지 않고 사유와 함께
    // skip으로 드러낸다(예: 필수 pk가 폼에서 편집 불가, 검색 가능한 text 없음).
    test.skip(!plan.testable, plan.testable ? '' : plan.reason);
    if (!plan.testable) return;

    try {
      await gotoAndEnableSemantics(page, '/master');
      await expect(page.getByText('마스터', { exact: true })).toBeVisible();
      await selectMaster(page, meta);

      await createRow(page, meta, plan.fields);
      // 저장 성공 토스트는 몇 초 뒤 사라지는 일시적 UI라 판정 근거로 쓰지 않고,
      // 실제로 검색 결과에 나타나는지로 저장 성공을 확인한다.
      await searchForSingleRow(page, plan.searchValue);

      await editFirstRow(page, meta, plan.edit);
      await expect(page.getByText(plan.edit.value, { exact: true })).toBeVisible();

      // 검색은 여전히 토큰으로 좁혀진 상태다(planEdit이 검색 대상 값을 그대로
      // 두거나 토큰을 남기도록 고른다). 그래서 재검색 없이 바로 삭제한다.
      await deleteFirstRowViaUi(page);
    } finally {
      await cleanupRowsViaApi(meta.key, meta.pk, token);
      // API 삭제는 9종에서 소프트 삭제로 끝나 행이 DB에 남는다. 실행마다
      // 누적되므로 물리 삭제까지 한다 — 자세한 사유는 master-purge.ts 참고.
      await purgeRowsViaDb(meta.key, token);
    }
  });
}
