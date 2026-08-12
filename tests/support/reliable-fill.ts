import { expect, type Locator } from '@playwright/test';

const RETRY_ATTEMPTS = 3;
const VALUE_ASSERT_TIMEOUT_MS = 3_000;
/**
 * 클릭 직후 곧바로 타이핑하면 Flutter가 입력 핸들러를 붙이기 전이라 첫 글자가
 * 유실된다(실측: "123456"을 쳤는데 필드에 "23456"이 들어감). 포커스가 자리
 * 잡을 시간을 준다.
 */
const FOCUS_SETTLE_MS = 250;
/** DOM 값이 맞은 뒤에도 Dart 컨트롤러 반영에 약간의 시간이 더 필요하다. */
const SYNC_SETTLE_MS = 300;

/**
 * Flutter 웹 텍스트 필드에 값을 넣는다. **실제 키 입력**을 쓴다.
 *
 * Playwright의 `fill()`은 DOM `<input>`의 value를 직접 세팅하고 input 이벤트를
 * 한 번 쏘는데, Flutter 웹은 이 값을 Dart의 TextEditingController로 가져오지
 * 못하는 경우가 있다. 증상이 특히 나쁜 이유는 **DOM 검증을 통과한다는 점**이다
 * — `toHaveValue`로 확인하면 새 값이 정확히 보이는데도, 제출 시점에는 컨트롤러가
 * 빈 값을 들고 있어 폼이 "필수 항목입니다"로 막히거나 예전 값이 그대로 저장된다.
 *
 * 실측 근거(거래처 등록 폼, 네트워크까지 확인):
 * - `fill()` 사용 시 → 두 필수 필드가 DOM 검증을 통과했는데도 제출 시 둘 다
 *   `[invalid] 필수 항목입니다` 상태가 되고 **POST 요청 자체가 나가지 않음**
 * - 키 입력 사용 시 → `POST /api/master/partners`가 정확한 본문으로 나가고,
 *   수정도 `PUT`에 새 값이 실려 목록에 반영됨
 *
 * 그래서 클릭으로 포커스를 준 뒤 전체 선택 → 삭제 → `keyboard.type`으로 친다.
 * 값이 어긋나면 전체 과정을 재시도한다(포커스 레이스가 간헐적이라 1회로는
 * 부족하다).
 */
export async function fillReliably(
  locator: Locator,
  value: string,
  attempts = RETRY_ATTEMPTS,
): Promise<void> {
  const page = locator.page();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await locator.click();
    await page.waitForTimeout(FOCUS_SETTLE_MS);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    if (value !== '') {
      await page.keyboard.type(value, { delay: 15 });
    }
    try {
      await expect(locator).toHaveValue(value, {
        timeout: VALUE_ASSERT_TIMEOUT_MS,
      });
      await page.waitForTimeout(SYNC_SETTLE_MS);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
  }
}

/**
 * 여러 필드를 연달아 채운다. 나중에 채운 필드 때문에 먼저 채운 필드가
 * 초기값으로 되돌아가는 경우가 있어(실측 확인), 전부 채운 뒤 한 번 더 훑어
 * 어긋난 필드만 다시 채운다.
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
