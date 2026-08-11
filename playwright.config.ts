import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error(
    'BASE_URL이 설정되지 않았습니다. .env.example을 복사해 .env.local을 만들고 값을 채우세요.',
  );
}

// 액션 사이에 넣을 지연(ms). 헤드리스 CI 실행에는 영향이 없도록 기본값 0이며,
// 브라우저를 눈으로 따라갈 때만 켠다:
//   SLOWMO=500 npm run test:headed -- --workers=1
// slowMo는 CLI 플래그가 없어서 설정으로만 줄 수 있다. 한 스텝씩 멈춰가며 보려면
// 이것보다 `npx playwright test --debug`(Inspector)가 낫다.
// global-setup.ts는 자체적으로 chromium.launch()를 호출하므로 여기 영향을 받지
// 않는다 — 로그인 준비 단계는 항상 최고 속도로 돈다.
const slowMo = Number(process.env.SLOWMO ?? 0);
if (!Number.isFinite(slowMo) || slowMo < 0) {
  throw new Error(`SLOWMO는 0 이상의 숫자여야 합니다: ${process.env.SLOWMO}`);
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  globalSetup: require.resolve('./global-setup'),
  fullyParallel: true,
  retries: 1,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Flutter 웹은 CanvasKit으로 모든 UI를 단일 <canvas>에 그리므로, 트레이스
    // 뷰어의 DOM 재구성 스냅샷이 항상 빈 화면으로 나온다(캔버스 픽셀은 DOM에
    // 없고, 접근성 트리를 켜서 생기는 flt-semantics 노드는 시각 스타일이 없는
    // 투명 오버레이다). 실제 화면을 확인할 수단이 필요해서 통과한 테스트에도
    // 스크린샷을 남긴다 — 리포트 용량과 맞바꾼 선택이다.
    screenshot: 'on',
    launchOptions: { slowMo },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
