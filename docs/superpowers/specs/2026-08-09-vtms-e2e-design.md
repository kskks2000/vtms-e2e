# VTMS E2E 테스트 프로젝트 설계

- 날짜: 2026-08-09
- 대상 저장소: `vtms-e2e` (본 저장소)
- 테스트 대상: `../vtms` (Flutter 웹+안드로이드 TMS, FastAPI 백엔드, 라이브 `www.logistics.ai.kr`)

## 배경

`vtms`는 Flutter 단일 코드베이스로 웹/안드로이드를 지원하는 TMS이며, 7개 업무 모듈(마스터·오더 생성·운송계획·실행·트래킹·실적·정산) + KPI 대시보드로 구성된다. 인증은 Firebase Auth(이메일/비밀번호, Google)를 사용하고, 인증 후 `go_router`의 `StatefulShellRoute`로 `/master`, `/order` 등 8개 경로를 오간다.

`vtms-e2e`는 이 웹 앱을 블랙박스로 자동화 테스트하는 별도 저장소다. `vtms` 소스는 건드리지 않는다.

## 스택 & 전체 구조

- **Playwright Test (TypeScript)**. npm 패키지 매니저.
- **대상 서버**: `BASE_URL` 환경변수로 전환. 기본은 로컬(`flutter run -d web-server`로 띄운 주소), 필요 시 라이브 서버(`http://www.logistics.ai.kr`)로도 실행 가능.
- **브라우저 프로젝트**: 우선 Chromium 데스크탑 뷰포트(1280×800) 1개만 구성한다. VTMS는 반응형(모바일/태블릿/데스크탑)이지만 초기 스모크 범위에서는 데스크탑 하나로 좁힌다. 모바일/태블릿 뷰포트 및 반응형 네비게이션(하단 NavigationBar, 축소된 NavigationRail) 검증은 이후 확장 과제로 남긴다.
- **CI 없음** — 이번 단계는 로컬 실행(`npx playwright test`)만 지원한다. GitHub Actions 등 CI 파이프라인은 테스트가 안정화된 후 별도로 추가한다.

## 디렉터리 구조

```
vtms-e2e/
  package.json
  tsconfig.json
  playwright.config.ts
  global-setup.ts              # 1회 로그인 → storageState 저장
  .env.example                 # BASE_URL / TEST_USER_EMAIL / TEST_USER_PASSWORD 템플릿
  README.md
  tests/
    fixtures.ts                # semantics 자동 활성화 page fixture
    auth/
      login.spec.ts            # 로그인 성공 / 실패 / 유효성 검사
    smoke/
      modules.spec.ts          # storageState 재사용, 8개 모듈 내비게이션 스모크
  playwright/.auth/user.json   # 생성물 (gitignore)
  playwright-report/           # 생성물 (gitignore)
  test-results/                # 생성물 (gitignore)
```

## Flutter Web Semantics 문제와 해결 전략

Flutter 웹은 기본적으로 CanvasKit 렌더러를 사용해 UI를 캔버스에 그린다. 텍스트/버튼이 실제 DOM 노드가 아니므로, Playwright의 `getByRole` / `getByText` 같은 표준 로케이터는 Flutter가 접근성(semantics) 트리를 활성화해 DOM 오버레이(ARIA 노드)를 만들기 전까지는 아무것도 찾지 못한다.

**해결책**: `tests/fixtures.ts`에서 기본 `page` fixture를 확장한다. 페이지 로드 후 Flutter가 최초 렌더링 시 심어두는 접근성 활성화 버튼(`flt-semantics-placeholder`, 화면 전체를 덮는 투명 버튼)을 자동으로 클릭해 semantics 트리를 켠 뒤 테스트에 `page`를 전달한다. 이 fixture를 쓰는 모든 테스트는 이후 표준 `getByRole`/`getByLabel`/`getByText` 로케이터를 그대로 사용할 수 있다.

이 접근은 vtms 앱 코드를 전혀 수정하지 않는다는 장점이 있지만, Flutter/Playwright 버전에 따라 placeholder의 정확한 셀렉터나 활성화 타이밍이 달라질 수 있다는 리스크가 있다. 구현 단계에서 실제 렌더링 결과를 보고 셀렉터와 대기 조건(예: 특정 role 요소가 나타날 때까지 대기)을 확정한다.

## 인증 전략

로그인은 실제 Firebase Auth 플로우를 UI로 통과시킨다(`.env.local`의 `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` 계정 사용).

- `login.spec.ts`는 로그인 플로우 자체를 검증하는 테스트이므로 매 테스트마다 새로 로그인한다(저장된 인증 상태를 쓰지 않음).
- 로그인 이후 상태가 필요한 다른 테스트(`modules.spec.ts` 등)는 매번 로그인을 반복하지 않는다. Playwright `globalSetup`에서 UI로 1회 로그인한 뒤 `storageState`(쿠키 + localStorage + IndexedDB — Firebase Auth JS SDK는 기본적으로 IndexedDB에 세션을 저장한다)를 `playwright/.auth/user.json`에 저장하고, 이후 테스트들은 `test.use({ storageState: 'playwright/.auth/user.json' })`로 재사용한다.
- 이 방식은 Firebase 인증 호출 횟수를 줄여 테스트 속도와 안정성을 높인다. IndexedDB storageState 캡처를 지원하는 최신 Playwright 버전이 필요하며, 구현 단계에서 실제 캡처/복원이 기대대로 동작하는지 확인한다.

## 테스트 범위

### `auth/login.spec.ts`

1. 올바른 이메일/비밀번호로 로그인 → `/master`로 리다이렉트되고 내비게이션(8개 모듈 메뉴)이 노출되는지 확인.
2. 올바른 이메일 + 잘못된 비밀번호 → 에러 배너 메시지가 노출되고 URL이 `/login`에 머무는지 확인.
3. 빈 이메일/비밀번호로 제출 → 클라이언트 측 폼 유효성 메시지(이메일/비밀번호 필수 입력 안내)가 노출되는지 확인. 이 케이스는 백엔드/Firebase 호출 없이 순수 UI 검증이다.

### `smoke/modules.spec.ts`

저장된 인증 상태(storageState)로 로그인된 채 시작한다. 좌측(데스크탑)/하단(모바일) 내비게이션의 8개 항목을 순서대로 클릭하며 각 모듈에 대해:

- URL이 예상 경로(`/master`, `/order`, `/planning`, `/execution`, `/tracking`, `/performance`, `/settlement`, `/kpi`)로 바뀌는지.
- 화면이 콘솔 에러 없이 로드되고, 해당 모듈 헤더의 타이틀 텍스트가 보이는지(예: 마스터 화면의 "마스터", 오더 화면의 "오더 목록" 등 — 정확한 문자열은 구현 단계에서 각 화면 소스를 보고 확정).

이 테스트는 8개 모듈에 대한 얕지만 넓은 회귀 안전망이며, 각 모듈의 상세 CRUD/폼 플로우는 이번 범위에 포함하지 않는다(추후 모듈별 스펙으로 확장 가능).

## 설정 & 환경변수

`.env.local`(gitignore 처리, 기존 `.gitignore`가 `.env*` 패턴을 이미 커버함):

```
BASE_URL=http://localhost:PORT     # flutter run -d web-server 로 띄운 로컬 주소
TEST_USER_EMAIL=...
TEST_USER_PASSWORD=...
```

`.env.example`은 값 없는 템플릿으로 커밋한다. `playwright.config.ts`는 `dotenv`로 `.env.local`을 로드하고 `BASE_URL`이 없으면 실행 시점에 명확한 에러로 실패한다(기본값으로 조용히 넘어가지 않음).

## 실행 방법

`package.json` 스크립트:

- `npm test` → `playwright test`
- `npm run test:ui` → `playwright test --ui`
- `npm run test:headed` → `playwright test --headed`

라이브 서버 대상 실행 예시: `BASE_URL=http://www.logistics.ai.kr npm test`

`README.md`에 vtms 프론트 로컬 구동 방법(`flutter run -d web-server --web-port=...`), `.env.local` 채우는 법, 테스트 실행법을 한국어로 안내한다.

## 에러 처리 / 관찰성

- 실패 시 트레이스를 자동 보관(`trace: 'on-first-retry'`), 스크린샷/비디오는 실패 시에만(`screenshot: 'only-on-failure'`).
- HTML 리포터 사용 (`playwright-report/`, gitignore 처리).
- `playwright/.auth/`, `playwright-report/`, `test-results/`, `node_modules/`는 gitignore(대부분 기존 `.gitignore`의 일반 패턴이 이미 커버).

## 범위 밖 (Out of scope)

- 모듈별 상세 CRUD/폼 플로우 테스트 (오더 생성, 배차, 정산 등 심화 시나리오)
- 모바일/태블릿 반응형 뷰포트 테스트
- 안드로이드 앱(APK/에뮬레이터) E2E — 이번 프로젝트는 웹만 대상으로 한다
- CI(GitHub Actions) 파이프라인
- Google 로그인(OAuth) 플로우 자동화 — 실제 구글 계정 자동화는 별도 검토 필요
