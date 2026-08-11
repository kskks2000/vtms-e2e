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
   - `API_BASE_URL`: `http://localhost:8000` (VTMS 백엔드 주소. 마스터 CRUD 테스트가 데이터 정리를 위해 백엔드 API를 직접 호출할 때 쓴다 — 왜 UI 삭제를 안 쓰는지는 "알려진 제한사항" 참고)
   - `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`: 실제로 로그인 가능한 VTMS 테스트 계정

## 실행

```bash
npm test          # 헤드리스 실행
npm run test:ui   # Playwright UI 모드
npm run test:headed  # 브라우저 창을 띄워서 실행
```

### 눈으로 따라가며 보기

`-g`로 테스트 하나만 고르고, `SLOWMO`(ms)로 액션 사이에 지연을 준다:

```bash
npm run test:headed -- --workers=1 -g "거래처를 등록하면"
SLOWMO=500 npm run test:headed -- --workers=1 -g "거래처를 등록하면"
```

`SLOWMO`는 기본값 0이라 평소 실행에는 영향이 없다. 다만 `fill`/`click` 같은
입력 액션에만 붙고 `goto`나 `waitFor` 대기에는 걸리지 않아, 체감 차이가 작을
수 있다(실측: 로그인 테스트가 `SLOWMO=1000`에서 4.7초 → 7.9초). 액션 하나씩
멈춰가며 보려면 Inspector가 낫다:

```bash
npx playwright test --debug -g "거래처를 등록하면"
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
  support/master-api.ts          # 마스터 CRUD 테스트 데이터를 백엔드 API로 직접 등록/삭제
  auth/login.spec.ts             # 로그인 성공/실패/유효성 검사
  smoke/app-loads.spec.ts        # 로그인 화면 로드 + 접근성 트리 활성화 스모크
  smoke/modules.spec.ts          # 8개 모듈 내비게이션 스모크
  master/partners-crud.spec.ts   # 마스터 · 거래처 등록/수정 (삭제는 알려진 버그로 제외)
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
- **마스터 화면의 삭제 확인 다이얼로그가 실제로는 삭제하지 않는다 (실제
  앱 버그)**: "삭제" 확인 버튼을 누르면 다이얼로그는 닫히지만 백엔드로
  DELETE 요청이 전혀 전송되지 않고, 화면이 이후 상호작용에 응답하지
  않는 상태가 된다(네트워크 로그로 직접 확인 — DELETE 요청 0회). 백엔드
  DELETE API 자체는 정상 동작한다(직접 호출하면 204 반환). vtms 소스는
  건드리지 않기로 했으므로, 테스트에서 만든 데이터 정리는 항상 UI가
  아니라 `tests/support/master-api.ts`로 백엔드 API를 직접 호출한다.
  마스터 화면의 삭제 동작 자체를 검증하는 테스트는 이 버그가 해결되기
  전까지 작성하지 않는다.
- **검색창은 입력 즉시 접근성 라벨이 사라진다**: 마스터 화면의 검색
  필드는 `labelText`가 아니라 `hintText`만 쓴다(폼 필드와 다름). Flutter는
  hintText 기반 접근성 라벨을 필드가 비어있을 때만 노출하고, 값이 입력된
  순간 그 라벨을 지운다(실측: 입력 직후 `getByLabel('검색')`이 요소를
  0개 찾음, `aria-label`이 `null`이 됨 — 실제 `<input>`은 값과 함께 여전히
  존재/가시 상태). `fill()`이나 `press()`를 검색 필드에 다시 걸면 최대
  타임아웃까지 멈춘다. `tests/master/partners-crud.spec.ts`의
  `searchAndWaitForSingleResult`처럼, 비어있을 때 한 번 클릭해 포커스를
  준 뒤 `page.keyboard.type()` / `page.keyboard.press('Enter')`로 우회한다
  (포커스된 엘리먼트 기준으로 동작해 라벨 재조회가 필요 없다).
- **텍스트 필드를 채운 뒤 곧바로 다른 필드를 채우거나 제출하면 값이
  유실될 수 있다**: `fill()`로 DOM `<input>`의 값은 정확히 써져도, 그
  값이 Flutter의 Dart 쪽 폼 상태(TextEditingController)로 넘어가는 데
  별도의 비동기 시간이 걸린다. 이 동기화가 끝나기 전에 제출하면, 그
  필드가 처음 열렸을 때의 초기값(대개 빈 문자열, 수정 폼이면 수정 전
  값)으로 저장된다 — 네트워크 로그로 실제 요청 바디까지 확인된 사실이다.
  `tests/support/reliable-fill.ts`의 `fillReliably`(단일 필드, DOM 확인
  후 짧게 settle)와 `fillFieldsReliably`(여러 필드를 채운 뒤 제출 직전에
  전체를 한 번 더 검증·재입력)로 방어하지만, 100% 결정론적이지는 않다 —
  드물게 첫 시도에서 실패해도 `retries: 1`이 잡아 최종적으로는 통과하는
  경우가 있다(6회 연속 전체 스위트 실행에서 전부 최종 통과 확인, 개별
  시도 단위로는 가끔 flaky). 새 폼 상호작용 테스트를 작성할 때는 반드시
  이 두 헬퍼를 통해 입력하고, 일반 `fill()`을 직접 쓰지 않는다.
- **로컬 실행이 이유 없이 로그인부터 막히면 시스템 시계를 의심할 것**:
  Firebase가 발급한 ID 토큰의 타임스탬프가 로컬 시계보다 미래로 보이면
  백엔드가 `유효하지 않은 Firebase 토큰입니다: Token used too early`로
  거부한다(수 초 이내의 시계 오차로도 발생). `sntp -sS time.apple.com`
  (또는 시스템 설정 > 일반 > 날짜 및 시간에서 "자동으로 설정" 껐다 켜기)
  으로 시계를 동기화하면 해결된다. 이 프로젝트나 vtms 코드와는 무관한
  로컬 환경 문제다.
- **트레이스 뷰어의 스냅샷 창은 항상 빈 화면이다 (고장이 아니다)**: UI
  모드나 HTML 리포트에서 액션을 선택하면 가운데에 가짜 브라우저 창이
  뜨는데, 주소만 찍히고 내용은 투명 체크무늬만 나온다. 이 창은 화면
  사진이 아니라 **기록해 둔 DOM을 다시 그려서** 보여주는 영역인데,
  Flutter 웹은 CanvasKit으로 모든 UI를 `<canvas>` 하나에 WebGL로 그리기
  때문에 재구성할 DOM이 없다(접근성 트리를 켜서 생기는 `flt-semantics`
  노드는 시각 스타일이 없는 투명 오버레이라 아무것도 보이지 않는다).
  예전에는 `--web-renderer html`로 빌드하면 실제 DOM이 나왔지만, 설치된
  Flutter 3.44.1에는 그 옵션 자체가 없다(HTML 렌더러 제거됨). 즉 채울
  방법이 없으니 이 창은 쓰지 않는다. 실제 화면은 다음에서 본다:
  - **Attachments 탭**: `playwright.config.ts`가 `screenshot: 'on'`이라
    통과한 테스트에도 종료 시점 화면이 첨부된다. (`only-on-failure`가
    아닌 이유가 바로 이것이다.)
  - **상단 타임라인 필름스트립**: 썸네일에 마우스를 올리면 그 시점의
    실제 화면이 확대된다. DOM 재구성이 아니라 진짜 스크린캐스트 프레임이다.
  - **headed / `--debug` 실행**: 위 "눈으로 따라가며 보기" 참고.
