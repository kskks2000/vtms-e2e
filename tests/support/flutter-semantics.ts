import type { Page } from '@playwright/test';

/**
 * Flutter 웹은 접근성(semantics) 트리가 꺼진 채로 시작해 위젯이 캔버스에만
 * 그려진다. Flutter 엔진이 첫 렌더링 시 삽입하는 `flt-semantics-placeholder`
 * 버튼을 클릭하면 접근성 트리가 켜지고, 이후 각 위젯이 대응하는 DOM
 * 노드(aria-label 등 포함)로 노출되어 getByRole/getByLabel/getByText가
 * 동작한다.
 */
const SEMANTICS_TIMEOUT_MS = 30_000;

// 앱이 스스로 뜨기를 기다리는 시간. 릴리스 번들을 정적 서빙하면 이보다 훨씬
// 빨리 렌더링되므로 그 경우엔 이 시간을 다 쓰지 않고 곧바로 빠져나간다.
const APP_BOOT_GRACE_MS = 5_000;

/**
 * 개발 서버(`flutter run -d web-server`)로 서빙할 때 DWDS는 디버그 서비스가
 * 접속할 때까지 `main()`을 붙잡아 둔다. Playwright가 띄우는 브라우저는 그
 * 연결을 만들지 않으므로 앱이 영영 시작되지 않는다 — DDC 모듈 609개를 전부
 * 받고 CanvasKit까지 로드한 뒤에도 `flutter-view`가 0개고, 실패하거나 지연된
 * 요청은 한 건도 없다(60초까지 실측 확인). 겉으로 드러나는 증상은 아래
 * `flt-semantics-placeholder` 타임아웃뿐이라 원인을 짐작할 수가 없다.
 *
 * DWDS는 이 게이트와 함께 `window.$dartRunMain`을 노출해 두므로 직접 불러
 * 넘어간다. 릴리스 번들에는 이 훅 자체가 없어 호출은 조용히 건너뛴다.
 */
async function startAppIfDwdsIsHoldingMain(page: Page): Promise<void> {
  const hasRendered = async () => (await page.locator('flutter-view').count()) > 0;

  const deadline = Date.now() + APP_BOOT_GRACE_MS;
  while (Date.now() < deadline) {
    if (await hasRendered()) return;
    await page.waitForTimeout(250);
  }

  await page.evaluate(() => {
    const runMain = (window as { $dartRunMain?: () => void }).$dartRunMain;
    if (typeof runMain === 'function') runMain();
  });
}

export async function enableFlutterSemantics(page: Page): Promise<void> {
  await startAppIfDwdsIsHoldingMain(page);

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
