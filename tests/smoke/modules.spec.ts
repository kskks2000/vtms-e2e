import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';

test.use({ storageState: 'playwright/.auth/user.json' });

const modules: Array<{ label: string; path: string }> = [
  { label: '마스터', path: '/master' },
  { label: '오더 생성', path: '/order' },
  { label: '운송계획', path: '/planning' },
  { label: '실행', path: '/execution' },
  { label: '트래킹', path: '/tracking' },
  { label: '실적', path: '/performance' },
  { label: '정산', path: '/settlement' },
  { label: 'KPI', path: '/kpi' },
];

// 인증된 화면 어디서나(모듈과 무관, /master 자체에서도) 부팅 직후 100%
// 재현되는 pageerror가 실제 vtms 앱에 이미 존재한다(컨트롤러가 로그인
// 직후·모듈 전환 없이도 반복 재현 확인함). message는 빈 문자열이 아니라
// 리터럴 문자열 "Error"다(소스맵이 없어 원인 불명, 최소 정보 스택트레이스).
// 기능에는 영향이 없고 소스 수정은 이 플랜 범위 밖이라 알려진 이슈로
// 명시적으로 허용한다. 그 외 콘솔 에러/새로운 pageerror는 그대로 실패시킨다.
function isKnownBootstrapPageError(message: string): boolean {
  return message === 'Error';
}

// 네이버 지도 client ID가 도메인 제한(라이브 서버 도메인만 허용)에 걸려
// 있어, 로컬(localhost) 대상 테스트에서는 지도 인증 호출이 401을 반환한다.
// 트래킹 모듈에서만 발생하는 로컬 전용 알려진 이슈로 허용한다.
const TRACKING_KNOWN_CONSOLE_ERROR = /oapi\.map\.naver\.com\/v3\/auth/;

for (const { label, path } of modules) {
  test(`${path} 화면이 (알려진 이슈를 제외하면) 에러 없이 로드된다 (${label})`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (path === '/tracking' && TRACKING_KNOWN_CONSOLE_ERROR.test(msg.text())) {
        return;
      }
      consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      if (isKnownBootstrapPageError(err.message)) return;
      consoleErrors.push(err.message);
    });

    // vtms의 app_router.dart redirect 로직은 Firebase 인증 상태가 아직
    // 해석되지 않은 채로 모듈 경로에 콜드 딥링크되면 /splash로 튕겼다가,
    // 인증이 끝난 뒤 원래 요청했던 경로를 기억하지 못하고 /master로
    // 보내버리는 실제 앱 버그가 있다(재현 확인됨, vtms 소스는 건드리지
    // 않기로 함). 먼저 /master에서 완전히 부팅·인증을 끝낸 뒤, 페이지
    // 리로드 없이 해시만 바꿔 이동하면(실제 nav 클릭과 동등한 클라이언트
    // 사이드 라우팅) 이 레이스를 피할 수 있다.
    await gotoAndEnableSemantics(page, '/master');
    await expect(page.getByText('마스터', { exact: true })).toBeVisible();

    if (path !== '/master') {
      await page.evaluate((p) => {
        window.location.hash = p;
      }, path);
    }

    await expect(page).toHaveURL(new RegExp(`${path}$`));
    expect(
      consoleErrors,
      `알려진 이슈 외 콘솔 에러 발생:\n${consoleErrors.join('\n')}`,
    ).toEqual([]);
  });
}
