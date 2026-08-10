import type { Page } from '@playwright/test';

/**
 * Flutter 웹은 접근성(semantics) 트리가 꺼진 채로 시작해 위젯이 캔버스에만
 * 그려진다. Flutter 엔진이 첫 렌더링 시 삽입하는 `flt-semantics-placeholder`
 * 버튼을 클릭하면 접근성 트리가 켜지고, 이후 각 위젯이 대응하는 DOM
 * 노드(aria-label 등 포함)로 노출되어 getByRole/getByLabel/getByText가
 * 동작한다.
 */
const SEMANTICS_TIMEOUT_MS = 30_000;

export async function enableFlutterSemantics(page: Page): Promise<void> {
  const placeholder = page.locator('flt-semantics-placeholder');
  await placeholder.waitFor({ state: 'attached', timeout: SEMANTICS_TIMEOUT_MS });
  await placeholder.dispatchEvent('click');
  await placeholder.waitFor({ state: 'detached', timeout: SEMANTICS_TIMEOUT_MS });
}

export async function gotoAndEnableSemantics(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(`/#${path}`);
  await enableFlutterSemantics(page);
}
