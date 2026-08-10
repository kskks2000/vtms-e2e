# VTMS E2E 테스트 프로젝트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `vtms-e2e` 저장소에 Playwright(TypeScript) 기반 E2E 테스트 프로젝트를 만들어, VTMS 웹 앱(Flutter 웹)의 로그인 플로우와 8개 모듈 내비게이션을 자동으로 검증한다.

**Architecture:** 독립 Node.js/TypeScript 프로젝트. `@playwright/test`로 Chromium을 구동해 `BASE_URL`(로컬 또는 라이브 서버)의 VTMS 웹 앱을 블랙박스로 조작한다. Flutter 웹은 기본적으로 CanvasKit로 렌더링되어 텍스트/버튼이 실제 DOM이 아니므로, 매 테스트 시작 시 Flutter가 삽입하는 `flt-semantics-placeholder`를 클릭해 접근성(semantics) 트리를 활성화한 뒤 표준 Playwright 로케이터(`getByRole`, `getByLabel`, `getByText`)로 요소를 찾는다. 로그인은 `globalSetup`에서 1회만 실제 Firebase Auth UI 플로우로 수행하고 `storageState`에 세션을 저장해, 로그인 후 상태가 필요한 테스트들이 이를 재사용한다.

**Tech Stack:** Node.js, TypeScript, `@playwright/test`, `dotenv`.

## Global Constraints

- 대상 서버는 `BASE_URL` 환경변수로 전환한다 (기본: 로컬 프로덕션 빌드 정적 서빙, 필요 시 라이브 `http://www.logistics.ai.kr`). `BASE_URL`이 없으면 설정 로드 시점에 명확한 에러로 실패한다.
- **로컬 서버는 반드시 `flutter build web` 프로덕션 빌드를 정적으로 서빙한다 — `flutter run -d web-server`(개발 모드, DDC/DWDS hot-reload)는 사용하지 않는다.** Task 1 구현 중 실제로 확인됨: `flutter run -d web-server`는 Playwright의 자동화된 Chromium이 접속했을 때 정적 에셋은 전부 로드되지만 Dart `main()`이 전혀 실행되지 않고 무한정 멈춘다(120초+ 대기해도 DOM 변화 없음, single-debug-connection 계열의 dev-tooling 한계로 추정). `flutter build web` 결과물(`build/web`)을 `python3 -m http.server` 같은 평범한 정적 서버로 서빙하면 정상 동작한다.
- 브라우저는 Chromium 데스크탑 뷰포트(1280×800) 1개 프로젝트만 구성한다. 모바일/태블릿 반응형 뷰포트는 범위 밖.
- CI(GitHub Actions 등)는 이번 단계에서 구성하지 않는다. 로컬 실행(`npx playwright test`)만 지원한다.
- 실패 시 트레이스는 `on-first-retry`, 스크린샷은 `only-on-failure`로 보관한다. HTML 리포터를 사용한다.
- 8개 모듈과 경로(확정, `vtms/lib/core/navigation/app_destinations.dart` 및 `app_router.dart` 기준): 마스터(`/master`), 오더 생성(`/order`), 운송계획(`/planning`), 실행(`/execution`), 트래킹(`/tracking`), 실적(`/performance`), 정산(`/settlement`), KPI(`/kpi`).
- 로그인 화면 필드/버튼 텍스트(확정, `vtms/lib/features/auth/login_screen.dart` 기준): 이메일 필드 라벨 `이메일`, 비밀번호 필드 라벨 `비밀번호`, 제출 버튼 텍스트 `로그인`(Google 로그인 버튼은 `Google 계정으로 로그인`이라 부분 문자열이 겹치므로 로케이터는 반드시 `exact: true`를 쓴다), 빈 이메일 에러 `이메일을 입력해 주세요.`, 빈 비밀번호 에러 `비밀번호를 입력해 주세요.`, 잘못된 자격증명 에러(`vtms/lib/core/auth/firebase_auth_service.dart`의 `wrong-password`/`user-not-found`/`invalid-credential`) `이메일 또는 비밀번호가 올바르지 않습니다.`
- **좌측/하단 내비게이션 레일은 접근성(semantics) 트리에 전혀 노출되지 않는다** (Task 2 구현 중 실제로 확인됨: role 불일치가 아니라 해당 영역에 접근성 노드 자체가 없음 — 순수 캔버스 렌더링으로 추정, `Semantics` 위젯이 없는 것으로 보임). 따라서 모듈 간 이동은 내비게이션 아이템을 클릭하는 대신 해시 기반 URL로 직접 이동한다(예: `page.goto('/#/order')`). vtms 소스는 건드리지 않는다 — 이 사실은 참고용으로만 기록하고, 접근성 개선은 이 플랜의 범위 밖이다.
- **알려진 vtms 앱 이슈 (재현 확인됨, vtms 소스는 건드리지 않고 테스트에서 알려진 이슈로 허용 처리):**
  1. `lib/core/navigation/app_router.dart`의 `redirect` 로직 — Firebase 인증 상태가 아직 `unknown`일 때 모듈 경로로 콜드 딥링크하면 `/splash`로 리다이렉트됐다가, 인증이 끝난 뒤 원래 요청했던 경로를 기억하지 못하고 무조건 `/master`로 보낸다(원래 경로가 유실됨). 재현률은 auth 해석 속도와의 타이밍에 좌우되어 비결정적이다. 테스트에서는 항상 `/master`에서 완전히 부팅한 뒤 클라이언트 사이드 해시 변경으로 이동해 이 레이스를 피한다.
  2. 인증된 화면이면 모듈과 무관하게(단순 `/master` 대기만으로도, 로그인 직후에도) `pageerror`(메시지가 리터럴 문자열 `"Error"`, 소스맵 없어 원인 불명)가 매우 높은 빈도(컨트롤러 실측 기준 사실상 100%)로 발생한다. 기능에는 영향이 없다. 테스트에서는 `pageerror.message === 'Error'`인 경우를 알려진 이슈로 허용하고, 그 외 에러는 그대로 실패시킨다.
  3. `/tracking` 모듈은 로컬(`localhost`) 대상 테스트 시 네이버 지도 API(`oapi.map.naver.com/v3/auth`)가 401을 반환한다 — 네이버 지도 client ID가 도메인 제한(라이브 서버 도메인만 허용)에 걸려 있는 것으로 추정되는 로컬 환경 한계이며, 앱 버그가 아니다. `/tracking` 테스트에서만 이 특정 콘솔 에러를 허용한다.
- 범위 밖: 모듈별 상세 CRUD/폼 플로우, 반응형 뷰포트 테스트, 안드로이드 앱 E2E, CI 파이프라인, Google OAuth 로그인 자동화, VTMS 앱 소스 수정(접근성 포함).
- `.env.local`, `playwright/.auth/`(로그인 세션 포함), `playwright-report/`, `test-results/`, `node_modules/`는 절대 커밋하지 않는다.

## 사전 준비 (구현 시작 전에 확인)

이 플랜의 테스트는 두 가지 외부 의존성이 준비되어 있어야 실제로 통과한다. 코드/설정 작성 자체는 이 의존성 없이도 진행할 수 있지만, **각 태스크의 "테스트 실행" 스텝을 실제로 초록불로 만들려면** 아래가 필요하다:

1. **로컬 VTMS 웹 서버**: `../vtms` 저장소에서 백엔드(`cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000`)를 띄우고, 프론트는 `API_BASE_URL=http://localhost:8000 bash scripts/build_web.sh`로 프로덕션 빌드한 뒤 `cd build/web && python3 -m http.server 3000`으로 정적 서빙한다(`flutter run -d web-server`는 쓰지 않는다 — 위 Global Constraints 참고). CORS가 `http://localhost:3000`을 허용하도록 이미 구성되어 있으므로 `.env.local`의 `BASE_URL`은 `http://localhost:3000`(반드시 `127.0.0.1`이 아닌 `localhost`)으로 맞춘다.
2. **E2E 전용 테스트 계정**: VTMS의 Firebase Auth + 백엔드 사용자 테이블에 실제로 로그인 가능한 계정(이메일/비밀번호)이 있어야 한다. 이 계정 생성은 이 플랜의 범위 밖이며(vtms 백엔드/Firebase 콘솔 작업), 이미 존재하는 계정을 `.env.local`의 `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`에 채워 넣는다.

Task 2, 3은 이 테스트 계정이 없으면 실행 자체가 명확한 에러로 실패하도록 만든다(조용히 스킵하지 않는다).

---

### Task 1: 프로젝트 초기화 + Flutter semantics 활성화 + 첫 스모크 테스트

**Files:**
- Create: `package.json` (via `npm init -y` + `npm install`)
- Create: `tsconfig.json`
- Create: `playwright.config.ts`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `README.md`
- Create: `tests/support/flutter-semantics.ts`
- Test: `tests/smoke/app-loads.spec.ts`

**Interfaces:**
- Produces: `enableFlutterSemantics(page: Page): Promise<void>` and `gotoAndEnableSemantics(page: Page, path: string): Promise<void>`, exported from `tests/support/flutter-semantics.ts`. Task 2, 3 import both.
- Produces: `playwright.config.ts`의 `use.baseURL`은 `.env.local`의 `BASE_URL`에서 온다. `globalSetup`은 이 태스크에서는 아직 설정하지 않는다(Task 2에서 파일이 생기면 추가).

- [ ] **Step 1: 저장소 초기화 및 의존성 설치**

```bash
npm init -y
npm install -D @playwright/test dotenv typescript @types/node
npx playwright install chromium
```

- [ ] **Step 2: `package.json`의 메타데이터/스크립트 수정**

`npm init -y`가 만든 `package.json`을 열어 `name`, `description`, `scripts`를 아래처럼 채운다(버전 필드는 `npm install`이 채운 값을 그대로 둔다):

```json
{
  "name": "vtms-e2e",
  "version": "0.1.0",
  "private": true,
  "description": "VTMS 웹 앱(Flutter web)에 대한 Playwright E2E 테스트",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "...",
    "@types/node": "...",
    "dotenv": "...",
    "typescript": "..."
  }
}
```

(`devDependencies`의 `...`는 `npm install`이 이미 채워 넣은 실제 버전을 그대로 유지한다.)

- [ ] **Step 3: `tsconfig.json` 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node", "@playwright/test"]
  },
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: `.env.example` 작성**

```bash
# vtms-e2e 환경 설정. 복사해서 .env.local 로 만들고 값을 채운다.
#   cp .env.example .env.local

# 테스트 대상 VTMS 웹 앱 주소.
# 로컬: (../vtms 에서) flutter run -d web-server --web-port=8090 으로 띄운 뒤 아래 값 사용.
# 라이브 서버 검증 시에만 http://www.logistics.ai.kr 로 바꾼다.
BASE_URL=http://localhost:8090

# e2e 전용 테스트 계정 (Firebase Auth + VTMS 백엔드에 실제로 로그인 가능해야 함)
TEST_USER_EMAIL=
TEST_USER_PASSWORD=
```

- [ ] **Step 5: `.gitignore`에 Playwright 관련 항목 추가**

기존 `.gitignore` 끝에 아래 블록을 추가한다 (기존 파일은 `.env*`, `node_modules/`, `build/` 등은 이미 커버하지만 Playwright 산출물 디렉터리는 커버하지 않는다):

```
# =========================
# Playwright
# =========================
/test-results/
/playwright-report/
/playwright/.auth/
```

- [ ] **Step 6: `tests/support/flutter-semantics.ts` 작성**

```typescript
import type { Page } from '@playwright/test';

/**
 * Flutter 웹은 접근성(semantics) 트리가 꺼진 채로 시작해 위젯이 캔버스에만
 * 그려진다. Flutter 엔진이 첫 렌더링 시 삽입하는 `flt-semantics-placeholder`
 * 버튼을 클릭하면 접근성 트리가 켜지고, 이후 각 위젯이 대응하는 DOM
 * 노드(aria-label 등 포함)로 노출되어 getByRole/getByLabel/getByText가
 * 동작한다.
 */
export async function enableFlutterSemantics(page: Page): Promise<void> {
  const placeholder = page.locator('flt-semantics-placeholder');
  await placeholder.waitFor({ state: 'attached', timeout: 30_000 });
  await placeholder.click();
  await placeholder.waitFor({ state: 'detached', timeout: 30_000 });
}

export async function gotoAndEnableSemantics(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(path);
  await enableFlutterSemantics(page);
}
```

- [ ] **Step 7: `playwright.config.ts` 작성**

```typescript
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
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
```

- [ ] **Step 8: 실패하는 스모크 테스트 작성 — `tests/smoke/app-loads.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';

test('로그인 화면이 로드되고 접근성 트리가 활성화된다', async ({ page }) => {
  await gotoAndEnableSemantics(page, '/login');

  await expect(page.getByLabel('이메일')).toBeVisible();
  await expect(page.getByLabel('비밀번호')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '로그인', exact: true }),
  ).toBeVisible();
});
```

- [ ] **Step 9: 로컬 VTMS 웹 서버를 띄운 채로 테스트 실행**

사전 준비 섹션대로 `../vtms`에서 `flutter run -d web-server --web-port=8090`을 띄우고 `.env.local`의 `BASE_URL=http://localhost:8090`을 채운 뒤:

```bash
npm test
```

Expected: `tests/smoke/app-loads.spec.ts`의 테스트 1개 PASS. 실패한다면 먼저 `npx playwright test --headed`로 실제 화면에서 접근성 placeholder 클릭이 되는지, `flt-semantics-placeholder` 셀렉터가 실제 DOM에 존재하는지(`npx playwright test --debug`의 Pick Locator로 확인)부터 점검한다.

- [ ] **Step 10: `README.md` 작성**

```markdown
# vtms-e2e

VTMS 웹 앱(Flutter web)에 대한 Playwright E2E 테스트 프로젝트. `../vtms` 소스는
전혀 건드리지 않고 블랙박스로 브라우저를 자동화해 검증한다.

## 준비

1. `../vtms`에서 로컬 웹 서버를 띄운다:
   \`\`\`bash
   cd ../vtms
   flutter pub get
   flutter run -d web-server --web-port=8090
   \`\`\`
2. 이 저장소에서 의존성을 설치한다:
   \`\`\`bash
   npm install
   npx playwright install chromium
   \`\`\`
3. `.env.example`을 복사해 `.env.local`을 만들고 값을 채운다:
   \`\`\`bash
   cp .env.example .env.local
   \`\`\`
   - `BASE_URL`: 위에서 띄운 로컬 주소 (예: `http://localhost:8090`)
   - `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`: 실제로 로그인 가능한 VTMS 테스트 계정

## 실행

\`\`\`bash
npm test          # 헤드리스 실행
npm run test:ui   # Playwright UI 모드
npm run test:headed  # 브라우저 창을 띄워서 실행
\`\`\`

## 라이브 서버 대상으로 실행

배포 전/후 확인용으로 라이브 서버를 직접 대상으로 돌릴 수도 있다:

\`\`\`bash
BASE_URL=http://www.logistics.ai.kr npm test
\`\`\`

## Flutter 웹 접근성(semantics)에 대한 메모

Flutter 웹은 기본적으로 CanvasKit로 렌더링되어 텍스트/버튼이 실제 DOM이 아니다.
`tests/support/flutter-semantics.ts`의 `gotoAndEnableSemantics`가 페이지 이동 후
Flutter의 접근성 활성화 버튼을 자동으로 클릭해 접근성 트리를 켠다. 모든 스펙은
이 헬퍼로 첫 진입을 해야 `getByRole`/`getByLabel`/`getByText`가 동작한다.

## 구조

\`\`\`
tests/
  support/flutter-semantics.ts   # 접근성 활성화 헬퍼
  auth/login.spec.ts             # 로그인 성공/실패/유효성 검사
  smoke/modules.spec.ts          # 8개 모듈 내비게이션 스모크
global-setup.ts                  # 1회 로그인 → storageState 저장
\`\`\`
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json playwright.config.ts \
  .env.example .gitignore README.md tests/support/flutter-semantics.ts \
  tests/smoke/app-loads.spec.ts
git commit -m "Scaffold Playwright e2e project with Flutter semantics helper"
```

---

### Task 2: 로그인 인증 — `global-setup.ts` + `login.spec.ts`

**Files:**
- Create: `tests/support/env.ts`
- Create: `global-setup.ts`
- Modify: `playwright.config.ts` (globalSetup 추가)
- Test: `tests/auth/login.spec.ts`

**Interfaces:**
- Consumes: `gotoAndEnableSemantics(page, path)` from `tests/support/flutter-semantics.ts` (Task 1).
- Produces: `requireEnv(name: string): string`, exported from `tests/support/env.ts`. `global-setup.ts`와 `login.spec.ts`가 함께 사용한다.
- Produces: `playwright/.auth/user.json` (로그인된 storageState 파일, gitignore 처리됨). Task 3의 `modules.spec.ts`가 `test.use({ storageState: 'playwright/.auth/user.json' })`로 재사용한다.

- [ ] **Step 1: 공용 `requireEnv` 헬퍼 작성 — `tests/support/env.ts`**

```typescript
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `환경변수 ${name}가 설정되지 않았습니다. .env.local을 확인하세요.`,
    );
  }
  return value;
}
```

- [ ] **Step 2: 실패하는 로그인 테스트 작성 — `tests/auth/login.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { gotoAndEnableSemantics } from '../support/flutter-semantics';
import { requireEnv } from '../support/env';

test('올바른 계정으로 로그인하면 메인 화면으로 이동한다', async ({
  page,
}) => {
  await gotoAndEnableSemantics(page, '/login');

  await page.getByLabel('이메일').fill(requireEnv('TEST_USER_EMAIL'));
  await page.getByLabel('비밀번호').fill(requireEnv('TEST_USER_PASSWORD'));
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await page.waitForURL('**/master');
  await expect(page.getByText('마스터', { exact: true })).toBeVisible();
});

test('잘못된 비밀번호로 로그인하면 에러 메시지가 표시되고 로그인 화면에 머문다', async ({
  page,
}) => {
  await gotoAndEnableSemantics(page, '/login');

  await page.getByLabel('이메일').fill(requireEnv('TEST_USER_EMAIL'));
  await page.getByLabel('비밀번호').fill('wrong-password-e2e-check');
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await expect(
    page.getByText('이메일 또는 비밀번호가 올바르지 않습니다.'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('빈 값으로 제출하면 입력 검증 메시지가 표시된다', async ({ page }) => {
  await gotoAndEnableSemantics(page, '/login');

  await page.getByRole('button', { name: '로그인', exact: true }).click();

  await expect(page.getByText('이메일을 입력해 주세요.')).toBeVisible();
  await expect(page.getByText('비밀번호를 입력해 주세요.')).toBeVisible();
});
```

- [ ] **Step 3: 로그인 테스트 실행 확인**

`login.spec.ts`는 `global-setup.ts` 없이도 각 테스트가 자체적으로 UI 로그인을 수행하므로, Task 1에서 만든 semantics 헬퍼만 있으면 동작한다.

Run: `npx playwright test tests/auth/login.spec.ts`

- `.env.local`의 `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`가 비어 있으면 Expected: FAIL — `requireEnv`가 "환경변수 ... 설정되지 않았습니다" 에러를 던진다. 사전 준비 섹션대로 실제 테스트 계정 값을 채운 뒤 다시 실행한다.
- 값이 채워져 있으면 Expected: PASS (3개 테스트 모두). 로케이터가 안 맞아 실패하면 Global Constraints에 적어둔 정확한 라벨/버튼 문자열과 `exact: true` 사용 여부를 다시 확인한다.

- [ ] **Step 4: `global-setup.ts` 작성**

`login.spec.ts` 자체는 이 파일이 필요 없지만, Task 3의 `modules.spec.ts`가 매번 로그인을 반복하지 않도록 로그인 상태를 한 번만 만들어 `storageState`로 저장해 두는 것이 이 스텝의 목적이다.

```typescript
import { chromium } from '@playwright/test';
import { gotoAndEnableSemantics } from './tests/support/flutter-semantics';
import { requireEnv } from './tests/support/env';

async function globalSetup(): Promise<void> {
  const baseURL = requireEnv('BASE_URL');
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  await gotoAndEnableSemantics(page, '/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.waitForURL('**/master', { timeout: 30_000 });

  await context.storageState({ path: 'playwright/.auth/user.json' });
  await browser.close();
}

export default globalSetup;
```

- [ ] **Step 5: `playwright.config.ts`에 `globalSetup` 연결**

`playwright.config.ts`의 `defineConfig({...})` 안, `testDir` 다음 줄에 추가:

```typescript
  testDir: './tests',
  globalSetup: require.resolve('./global-setup'),
```

- [ ] **Step 6: `.env.local`에 실제 테스트 계정 값을 채운 뒤 테스트 실행**

로컬 VTMS 웹 서버(Task 1 사전 준비)가 떠 있는 상태에서:

```bash
npm test -- tests/auth/login.spec.ts
```

Expected: 3개 테스트 모두 PASS.
- `getByText('마스터', { exact: true })`가 안 잡히면 `npx playwright test tests/auth/login.spec.ts --debug`로 실제 접근성 트리를 확인한다.
- 에러 메시지 텍스트가 다르게 보이면 `../vtms/lib/core/auth/firebase_auth_service.dart`의 `_messageFor`를 다시 확인한다(코드가 바뀌었을 수 있음).

- [ ] **Step 7: Commit**

```bash
git add tests/support/env.ts global-setup.ts playwright.config.ts tests/auth/login.spec.ts
git commit -m "Add login e2e coverage with storageState-based auth reuse"
```

---

### Task 3: 8개 모듈 내비게이션 스모크 — `modules.spec.ts`

**Files:**
- Test: `tests/smoke/modules.spec.ts`

**Interfaces:**
- Consumes: `gotoAndEnableSemantics(page, path)` from `tests/support/flutter-semantics.ts` (Task 1). Consumes `playwright/.auth/user.json`, produced by `global-setup.ts` (Task 2).

- [ ] **Step 1: 실패하는 모듈 스모크 테스트 작성 — `tests/smoke/modules.spec.ts`**

```typescript
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
```

**참고 (설계 변경 이력):** 원래 설계는 좌측 내비게이션 레일의 각 메뉴를 클릭해 이동하는 방식이었으나, Task 2 구현 중 내비게이션 레일이 접근성 트리에 전혀 노출되지 않는다는 사실이 확인되어 해시 기반 URL 직접 이동으로 1차 변경했다. 이후 Task 3 구현 중, 인증 상태가 미해석인 채로 모듈 경로에 콜드 딥링크(`gotoAndEnableSemantics(page, path)`를 모듈 경로에 바로 호출)하면 위에서 설명한 리다이렉트 레이스 버그에 걸린다는 사실이 추가로 확인되어, "먼저 `/master`에서 완전히 부팅 → 클라이언트 사이드 해시 변경으로 이동" 방식으로 2차 변경했다. 컨트롤러가 8개 모듈 전체에 대해 이 접근으로 URL 이동이 안정적으로 성공함을 별도 스크립트로 검증했다.

- [ ] **Step 2: 로컬 VTMS 웹 서버가 떠 있는 상태에서 실행**

```bash
npm test -- tests/smoke/modules.spec.ts
```

Expected: 8개 테스트 모두 PASS. `playwright/.auth/user.json`이 없다는 에러가 나면 `npm test`(전체 실행, `globalSetup` 포함)를 먼저 한 번 돌려 storageState 파일을 생성한다.
- 특정 모듈만 실패하면 먼저 `npx playwright show-trace test-results/.../trace.zip` 또는 `npm run test:headed -- tests/smoke/modules.spec.ts -g "<모듈명>"`으로 재현해 실제 원인(로케이터 불일치인지, 앱 자체의 콘솔 에러인지)을 구분한다.

- [ ] **Step 3: 전체 스위트 실행으로 최종 확인**

```bash
npm test
```

Expected: `app-loads.spec.ts`(1) + `login.spec.ts`(3) + `modules.spec.ts`(8) 총 12개 테스트 모두 PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke/modules.spec.ts
git commit -m "Add 8-module navigation smoke coverage"
```
