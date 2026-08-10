import { expect, type Locator } from '@playwright/test';

const FILL_RETRY_ATTEMPTS = 3;
const FILL_RETRY_ASSERT_TIMEOUT_MS = 2_000;
const SYNC_SETTLE_MS = 500;

/**
 * Flutter 웹 텍스트 필드는 fill()로 DOM `<input>`의 값을 써도, 그 값이
 * Dart 쪽 내부 폼 상태(TextEditingController)로 넘어가는 데 별도의
 * 비동기 시간이 걸린다. DOM 값 확인(toHaveValue)만으로는 이 동기화가
 * 끝났다는 보장이 되지 않는다 — 실측 확인: DOM은 새 값을 정확히 보여도,
 * 곧바로 제출 버튼을 누르면 Dart 컨트롤러가 아직 예전 값(필드가 처음
 * 열렸을 때의 초기값)을 들고 있어 그 예전 값으로 저장되는 경우가 있다
 * (네트워크 로그로 실제 요청 바디까지 확인). 그래서 두 단계로 방어한다:
 * (1) fill() 자체를 DOM 값이 실제로 붙을 때까지 재시도하고,
 * (2) DOM 확인 이후에도 Dart 동기화가 끝날 시간을 짧게 더 준다.
 */
export async function fillReliably(
  locator: Locator,
  value: string,
  attempts = FILL_RETRY_ATTEMPTS,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.fill(value);
    try {
      await expect(locator).toHaveValue(value, {
        timeout: FILL_RETRY_ASSERT_TIMEOUT_MS,
      });
      await locator.page().waitForTimeout(SYNC_SETTLE_MS);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
}

/**
 * 여러 필드를 연달아 채울 때, 나중에 채운 필드 때문에 먼저 채운 필드가
 * 초기값(대개 빈 문자열)으로 되돌아가는 경우가 있다(실측 확인 — 제출
 * 시점에 첫 필드가 DOM에서도 비어 있는 채로 "필수 항목입니다" 처리됨).
 * 각 필드를 fillReliably로 채운 뒤, 제출 직전에 전체를 한 번 더 확인해
 * 값이 틀어진 필드가 있으면 다시 채운다.
 */
export async function fillFieldsReliably(
  fields: Array<{ locator: Locator; value: string }>,
): Promise<void> {
  for (const { locator, value } of fields) {
    await fillReliably(locator, value);
  }
  for (const { locator, value } of fields) {
    if ((await locator.inputValue()) !== value) {
      await fillReliably(locator, value);
    }
  }
}
