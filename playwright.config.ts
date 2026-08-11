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
