import { expect, type Locator } from '@playwright/test';

const FILL_RETRY_ATTEMPTS = 3;
const FILL_RETRY_ASSERT_TIMEOUT_MS = 2_000;

/**
 * Flutter 웹 텍스트 필드는 fill()로 DOM 값을 써도 내부 폼 상태(Dart
 * TextEditingController)에 반영되지 않고 사라지는 레이스가 있다 — 값이
 * 아예 커밋되지 않는 경우 assertion의 재시도 대기만으로는 해결되지
 * 않는다(같은 값을 계속 재확인할 뿐 fill을 다시 시도하지 않기 때문).
 * fill() 자체를 값이 실제로 붙을 때까지 재시도한다.
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
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
}
