# vtms-e2e

VTMS 웹 앱(Flutter web)에 대한 Playwright E2E 테스트 프로젝트. `../vtms` 소스는
전혀 건드리지 않고 블랙박스로 브라우저를 자동화해 검증한다.

## 준비

1. `../vtms`에서 프로덕션 빌드를 만들고 정적 서버로 서빙한다:
   ```bash
   cd ../vtms
   API_BASE_URL=http://localhost:8000 bash scripts/build_web.sh
   cd build/web && python3 -m http.server 3000
   ```
   (주의: `flutter run -d web-server`는 hot-reload 개발 서버라 Playwright 자동화와 호환되지 않습니다. 반드시 프로덕션 빌드로 정적 서빙을 해야 합니다.)

2. 이 저장소에서 의존성을 설치한다:
   ```bash
   npm install
   npx playwright install chromium
   ```

3. `.env.example`을 복사해 `.env.local`을 만들고 값을 채운다:
   ```bash
   cp .env.example .env.local
   ```
   - `BASE_URL`: `http://localhost:3000` (위의 정적 서버 주소, CORS를 위해 127.0.0.1이 아닌 localhost 사용)
   - `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`: 실제로 로그인 가능한 VTMS 테스트 계정

## 실행

```bash
npm test          # 헤드리스 실행
npm run test:ui   # Playwright UI 모드
npm run test:headed  # 브라우저 창을 띄워서 실행
```

## 라이브 서버 대상으로 실행

배포 전/후 확인용으로 라이브 서버를 직접 대상으로 돌릴 수도 있다:

```bash
BASE_URL=http://www.logistics.ai.kr npm test
```

## Flutter 웹 접근성(semantics)에 대한 메모

Flutter 웹은 기본적으로 CanvasKit로 렌더링되어 텍스트/버튼이 실제 DOM이 아니다.
`tests/support/flutter-semantics.ts`의 `gotoAndEnableSemantics`가 페이지 이동 후
Flutter의 접근성 활성화 버튼을 자동으로 클릭해 접근성 트리를 켠다. 모든 스펙은
이 헬퍼로 첫 진입을 해야 `getByRole`/`getByLabel`/`getByText`가 동작한다.

## 구조

```
tests/
  support/flutter-semantics.ts   # 접근성 활성화 헬퍼
  auth/login.spec.ts             # 로그인 성공/실패/유효성 검사
  smoke/modules.spec.ts          # 8개 모듈 내비게이션 스모크
global-setup.ts                  # 1회 로그인 → storageState 저장
```
