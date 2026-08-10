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
  support/env.ts                 # 필수 환경변수 검증 헬퍼
  support/reliable-fill.ts       # fill()이 커밋되지 않는 레이스를 방어하는 헬퍼
  auth/login.spec.ts             # 로그인 성공/실패/유효성 검사
  smoke/app-loads.spec.ts        # 로그인 화면 로드 + 접근성 트리 활성화 스모크
  smoke/modules.spec.ts          # 8개 모듈 내비게이션 스모크
global-setup.ts                  # 1회 로그인 → storageState 저장
```

## 알려진 제한사항

- **부팅 pageerror 허용 목록의 실제 범위**: `modules.spec.ts`의
  `isKnownBootstrapPageError`는 메시지가 정확히 `"Error"`인 pageerror를
  허용한다. 소스맵이 없는 Flutter 릴리스 빌드에서는 잡히지 않은 Dart
  예외 대부분이 이 동일한 일반 메시지로 노출되기 때문에, 코드상으로는
  좁아 보여도 실질적으로는 이 앱의 Dart 예외 채널을 거의 대부분 음소거
  한다. 따라서 그린 스위트를 "Dart 예외가 전혀 없었다"는 뜻으로 읽으면
  안 된다. (소스맵 없이는 더 나은 신호가 없고, vtms를 소스맵 포함으로
  다시 빌드하는 것은 이 프로젝트 범위 밖이다.)
- **트레이스에 비밀번호 평문 포함**: `retries: 1`이 켜져 있어(재시도
  시 트레이스를 남기기 위함), 재시도가 발생한 실행의 `trace.zip`/HTML
  리포트에는 Playwright가 `fill()` 인자를 그대로 기록하기 때문에
  `TEST_USER_PASSWORD`가 평문으로 남는다. `playwright-report/`와
  `test-results/`는 이미 `.gitignore`에 포함되어 있어 저장소 유출은
  아니지만, 이 아티팩트를 공유할 때는 주의해야 한다.
