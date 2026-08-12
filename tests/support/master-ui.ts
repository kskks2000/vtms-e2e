import { expect, type Page } from '@playwright/test';
import { fillFieldsReliably, fillReliably } from './reliable-fill';
import type { MasterMeta, PlannedField } from './master-meta';

/**
 * 마스터 화면(범용 CRUD)을 UI로 조작하는 헬퍼. 23종 마스터가 같은 화면을
 * 공유하므로 조작 방법도 한 곳에 모은다.
 *
 * 이 화면의 버튼은 일반 click()이 hit-test 상 성공한 것처럼 보여도 실제
 * onPressed 핸들러를 띄우지 못하는 경우가 실측으로 확인됐다(삭제 확인
 * 다이얼로그에서 처음 발견, 이후 같은 화면의 다른 버튼에서도 재현). 그래서
 * 이 파일의 모든 버튼 클릭은 dispatchEvent를 쓴다.
 */

const LIST_TIMEOUT_MS = 10_000;

/**
 * 화면에 떠 있는 모달을 잡는다.
 *
 * Flutter의 `AlertDialog`는 접근성 트리에 `dialog`가 아니라 **`alertdialog`**
 * 롤로 나온다(실측 확인 — 삭제 확인 다이얼로그의 aria 스냅샷이
 * `- alertdialog:` 였다). ARIA에서 둘은 별개 롤이라 `getByRole('dialog')`는
 * 이걸 잡지 못하고, 다이얼로그가 멀쩡히 떠 있는데도 로케이터가 0건이 되어
 * 대기하다 타임아웃 난다. 위젯에 따라 어느 쪽으로도 나올 수 있으므로 둘 다
 * 받는다.
 */
function modal(page: Page) {
  return page.getByRole('alertdialog').or(page.getByRole('dialog'));
}

/**
 * 상단 탭에서 마스터 하나를 선택한다.
 *
 * 탭 버튼은 label과 subtitle을 한 위젯 안에 같이 그리고, Flutter는 그 둘을
 * 합쳐 하나의 접근성 이름으로 노출한다(예: label '권역/노선' + subtitle
 * '배송 권역' → "권역/노선 배송 권역"). 그래서 label만으로 exact 매칭하면
 * 어떤 버튼에도 걸리지 않고, dispatchEvent가 엘리먼트를 기다리다 테스트
 * 타임아웃까지 그대로 멈춘다(10초짜리 LIST_TIMEOUT_MS는 다음 줄의 expect에만
 * 걸리므로 여기선 도움이 안 된다). 메타데이터에서 같은 방식으로 이름을
 * 조립해 맞춘다 — 23종 전부 subtitle이 있고 조합 이름은 서로 겹치지 않는다.
 */
export async function selectMaster(page: Page, meta: MasterMeta): Promise<void> {
  const tabName = `${meta.label} ${meta.subtitle}`.trim();
  await page.getByRole('button', { name: tabName, exact: true }).first().dispatchEvent('click');
  await expect(
    page.getByRole('button', { name: `${meta.label} 등록`, exact: true }),
  ).toBeVisible({ timeout: LIST_TIMEOUT_MS });
}

/**
 * 검색창에 값을 넣고 결과가 정확히 1건이 될 때까지 기다린다.
 *
 * 검색 필드는 labelText가 아니라 hintText('검색')만 쓴다. Flutter는 hintText
 * 기반 접근성 라벨을 필드가 비어 있을 때만 노출하고 값이 입력되면 지우므로,
 * fill() 후 같은 로케이터로 다시 접근하면 최대 타임아웃까지 멈춘다. 비어 있을
 * 때 한 번 클릭해 포커스를 준 뒤에는 포커스된 엘리먼트 기준으로 동작하는
 * page.keyboard만 쓴다(라벨 재조회가 필요 없다).
 */
export async function searchForSingleRow(
  page: Page,
  value: string,
): Promise<void> {
  await page.getByLabel('검색').click();
  await page.keyboard.type(value, { delay: 20 });
  await page.keyboard.press('Enter');
  await expect(page.getByText('총 1건', { exact: true })).toBeVisible({
    timeout: LIST_TIMEOUT_MS,
  });
}

/**
 * 등록 폼을 열고 계획된 필드를 모두 채운 뒤 저장한다.
 *
 * date 컬럼은 폼이 readOnly + 날짜 선택기라 fill()이 통하지 않는다. 필드를
 * 클릭해 Material 날짜 선택기를 열고 초기값(오늘)을 그대로 확정한다.
 */
export async function createRow(
  page: Page,
  meta: MasterMeta,
  fields: PlannedField[],
): Promise<void> {
  await page
    .getByRole('button', { name: `${meta.label} 등록`, exact: true })
    .dispatchEvent('click');

  const textFields = fields.filter((f) => f.column.type !== 'date');
  const dateFields = fields.filter((f) => f.column.type === 'date');

  // 첫 필드가 뜨는 것으로 폼이 열렸음을 확인한다. 제목('… 등록')은 툴바 버튼과
  // 문구가 같아 모호하므로 기다림의 기준으로 쓰지 않는다.
  const first = textFields[0] ?? dateFields[0];
  await expect(page.getByLabel(first.label)).toBeVisible({
    timeout: LIST_TIMEOUT_MS,
  });

  for (const field of dateFields) {
    await pickToday(page, field.label);
  }
  // 여러 필드를 연달아 채우면 먼저 채운 값이 초기값으로 되돌아가는 경우가 있어
  // (reliable-fill.ts 참고) 제출 직전에 전체를 한 번 더 검증·재입력한다.
  await fillFieldsReliably(
    textFields.map((f) => ({ locator: page.getByLabel(f.label), value: f.value })),
  );

  await page.getByRole('button', { name: '등록', exact: true }).dispatchEvent('click');
}

/** 검색 결과 첫 행의 수정 버튼을 눌러 값 하나를 바꾸고 저장한다. */
export async function editFirstRow(
  page: Page,
  meta: MasterMeta,
  edit: { label: string; value: string },
): Promise<void> {
  await page
    .getByRole('button', { name: '수정', exact: true })
    .first()
    .dispatchEvent('click');
  await expect(page.getByLabel(edit.label)).toBeVisible({
    timeout: LIST_TIMEOUT_MS,
  });

  await fillReliably(page.getByLabel(edit.label), edit.value);
  await page.getByRole('button', { name: '저장', exact: true }).dispatchEvent('click');
}

/**
 * 검색 결과 첫 행을 **화면에서** 지운다. 행의 삭제 아이콘 → '삭제 확인'
 * 다이얼로그 → '삭제' 확인까지 실제 사용자 경로를 그대로 밟는다.
 *
 * 행의 삭제 아이콘(tooltip '삭제')과 다이얼로그의 확인 버튼('삭제')은 접근성
 * 이름이 같다. 다이얼로그가 뜬 뒤에는 두 개가 동시에 존재해 strict mode에
 * 걸리므로, 확인 버튼은 반드시 다이얼로그 범위 안에서 찾는다.
 */
export async function deleteFirstRowViaUi(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: '삭제', exact: true })
    .first()
    .dispatchEvent('click');

  const dialog = modal(page);
  await expect(dialog.getByText('삭제 확인', { exact: true })).toBeVisible({
    timeout: LIST_TIMEOUT_MS,
  });
  await dialog
    .getByRole('button', { name: '삭제', exact: true })
    .dispatchEvent('click');

  // 저장 성공 토스트는 몇 초 뒤 사라지는 일시적 UI라 이것만으로 판정하지
  // 않는다. 목록이 다시 로드돼 행이 사라졌는지를 최종 근거로 삼는다.
  await expect(page.getByText('총 0건', { exact: true })).toBeVisible({
    timeout: LIST_TIMEOUT_MS,
  });
}

/**
 * 날짜 필드를 눌러 선택기를 열고 초기값(오늘)을 그대로 확정한다.
 *
 * 두 가지가 이 화면의 다른 버튼들과 다르다(둘 다 실측 확인).
 *
 * 1. 날짜 필드는 readOnly TextField + onTap 이라 `dispatchEvent('click')`으로는
 *    선택기가 **열리지 않는다**(다이얼로그 0건). 실제 `click()`만 Flutter의 탭
 *    핸들러를 깨운다.
 * 2. 확정 버튼은 '확인'이 아니라 **'OK'** 다. 앱에 한국어 Material 로컬라이제이션
 *    델리게이트가 없어 날짜 선택기가 영어로 뜬다('확인' 0건 / 'OK' 1건).
 *    나중에 한국어가 붙으면 '확인'이 되므로 둘 다 받는다.
 */
async function pickToday(page: Page, label: string): Promise<void> {
  await page.getByLabel(label).click();
  const dialog = modal(page);
  await dialog
    .getByRole('button', { name: 'OK', exact: true })
    .or(dialog.getByRole('button', { name: '확인', exact: true }))
    .click();
  await expect(page.getByLabel(label)).not.toHaveValue('', {
    timeout: LIST_TIMEOUT_MS,
  });
}
