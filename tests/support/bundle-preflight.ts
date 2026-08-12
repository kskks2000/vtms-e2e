import { requireEnv } from './env';

/**
 * 서빙 중인 Flutter 번들이 이 테스트 환경을 향해 빌드된 것인지 먼저 확인한다.
 *
 * `../vtms/scripts/build_web.sh`는 `API_BASE_URL`이 비어 있어도 항상
 * `--dart-define=API_BASE_URL=`(빈 문자열)을 넘기고, 그 빈 값이
 * `app_config.dart`의 기본값을 덮어써서 앱이 same-origin 상대경로(`/api/...`)로
 * 백엔드를 부르는 배포용 번들이 된다. 이 번들을 정적 서버로 띄우면 API 요청이
 * 정적 서버로 가서 `501 Unsupported method ('POST')`로 죽는데, 화면에는 아무
 * 표시가 없어 증상이 `waitForURL('**\/master')` 30초 타임아웃으로만 나타난다.
 * 느린 시계(`Token used too early`, `clock-preflight.ts` 참고)와 증상이 똑같아
 * 구분이 안 되는 이 모호한 실패를 없애기 위해, 로그인을 시도하기 전에 번들을
 * 직접 들여다보고 즉시 설명적으로 실패한다.
 *
 * BASE_URL과 API_BASE_URL의 origin이 같을 때(운영처럼 백엔드가 프런트를 같이
 * 서빙하는 구성)는 상대경로가 정상이므로 검사를 건너뛴다.
 */
export async function assertBundleTargetsApiBaseUrl(): Promise<void> {
  const baseUrl = requireEnv('BASE_URL');
  const apiBaseUrl = requireEnv('API_BASE_URL');

  if (new URL(baseUrl).origin === new URL(apiBaseUrl).origin) return;

  const bundleUrl = new URL('/main.dart.js', baseUrl).toString();
  const res = await fetch(bundleUrl);
  if (!res.ok) {
    throw new Error(
      `번들(${bundleUrl})을 읽지 못했습니다: HTTP ${res.status}. ` +
        `BASE_URL이 맞는지, 정적 서버가 떠 있는지 확인하세요.`,
    );
  }
  const bundle = await res.text();

  // 앱이 다른 origin의 API를 부르려면 그 주소가 번들 안에 문자열로 박혀 있어야 한다.
  const host = new URL(apiBaseUrl).host; // 예: localhost:8000
  if (bundle.includes(host)) return;

  // `flutter run -d web-server`의 dartdevc 빌드는 애플리케이션 코드를
  // main.dart.js에 합치지 않고 *.dart.lib.js 모듈로 나눈다. main.dart.js만
  // 검색하면 --dart-define이 제대로 전달된 개발 서버도 잘못된 번들로 판정한다.
  // 부트스트랩에 등록된 AppConfig 모듈을 찾아 실제 주입값까지 확인한다.
  const bootstrapMatch = /["']src["']\s*:\s*["']([^"']*main_module\.bootstrap\.js)["']/.exec(
    bundle,
  );
  if (bootstrapMatch) {
    const bootstrapUrl = new URL(bootstrapMatch[1], baseUrl);
    const bootstrapRes = await fetch(bootstrapUrl);
    if (bootstrapRes.ok) {
      const bootstrap = await bootstrapRes.text();
      const configModulePaths = [
        ...bootstrap.matchAll(
          /["']src["']\s*:\s*["']([^"']*app_config\.dart\.lib\.js)["']/g,
        ),
      ].map((match) => match[1]);

      for (const modulePath of configModulePaths) {
        const moduleRes = await fetch(new URL(modulePath, baseUrl));
        if (moduleRes.ok && (await moduleRes.text()).includes(host)) return;
      }
    }
  }

  throw new Error(
    [
      `서빙 중인 번들에 API 주소(${host})가 주입되지 않았습니다.`,
      `배포용(same-origin 상대경로) 번들이라 로그인 직후 백엔드 요청이 정적`,
      `서버로 가서 501로 실패합니다. vtms에서 아래로 재빌드하세요`,
      `(API_BASE_URL을 빼면 같은 문제가 반복됩니다):`,
      ``,
      `  cd ../vtms`,
      `  PATH="$HOME/development/flutter/bin:$PATH" \\`,
      `    API_BASE_URL=${apiBaseUrl} bash scripts/build_web.sh`,
      ``,
      `성공하면 "주입된 정의 수"가 API_BASE_URL 포함 개수로 늘고, 아래가 0이`,
      `아닌 수를 돌려줍니다:`,
      ``,
      `  curl -s ${new URL('/main.dart.js', baseUrl)} | grep -c ${host}`,
    ].join('\n'),
  );
}
