# vtms-e2e 작업 규칙

## 최우선 규칙: `../vtms`는 읽기 전용이다

이 저장소는 VTMS를 **블랙박스로** 검증한다. `../vtms`(및 그 하위 전체)에
대해 어떤 변경도 하지 않는다. 진단 결과 원인이 vtms 쪽에 있더라도
**직접 고치지 말고 사용자에게 보고한다.**

### 금지 (사용자가 그때그때 명시적으로 지시한 경우에만 예외)

- `../vtms` 안의 파일 수정·생성·삭제 (소스, `.env`, 설정, 스크립트 전부)
- 빌드 산출물을 만들거나 바꾸는 명령: `flutter build`, `flutter pub get`,
  `scripts/build_web.sh`, `dart` 실행 등 — **`build/web`도 건드리지 않는다.**
  `.gitignore` 대상이라 `git status`에는 안 잡히지만 사용자의 배포 산출물이다.
- vtms 서버 프로세스 조작: uvicorn / 정적 서버의 시작·종료·재시작,
  환경변수 바꿔 띄우기
- vtms 저장소의 git 조작 (commit, checkout, stash 등)

### 허용

- **읽기**: 소스 grep, 설정 확인, 빌드 산출물 내용 확인, 프로세스/포트 상태
  조회. 원인 규명에 필요하며 아무것도 바꾸지 않는다.
- **테스트 실행에 따른 데이터 쓰기**: 스위트가 백엔드 API를 통해 거래처 등
  레코드를 등록·수정·삭제하는 것은 정상 동작이다. 연결된
  `db.logistics.ai.kr`은 개발/테스트 DB이므로 이것 때문에 확인을 요청하지
  않는다. 정리는 `tests/support/master-api.ts`가 맡는다.

### vtms 쪽이 원인일 때 취할 행동

고치지 말고, **무엇이 왜 잘못됐는지와 사용자가 직접 실행할 정확한 명령**을
제시하고 멈춘다.

자주 나오는 사례 — 로그인이 `global-setup`에서 타임아웃하고 콘솔에
`501 Unsupported method ('POST')`가 찍히면, 서빙 중인 번들이 배포용
(same-origin 상대경로)이라는 뜻이다. `scripts/build_web.sh`는 `API_BASE_URL`이
비어 있어도 `--dart-define=API_BASE_URL=`(빈 문자열)을 넘겨
`lib/core/config/app_config.dart`의 기본값 `http://localhost:8000`을
덮어쓴다. 시계 오차(`Token used too early`)와 증상이 똑같으니 혼동하지 말 것.

확인 (읽기만 하므로 허용):

```bash
curl -s http://localhost:3000/main.dart.js | grep -c localhost:8000   # 0이면 배포용 번들
```

사용자에게 안내할 명령 (직접 실행하지 않는다):

```bash
cd ../vtms
PATH="/Users/robert/development/flutter/bin:$PATH" \
  API_BASE_URL=http://localhost:8000 bash scripts/build_web.sh
```

배포 직전에는 반대로 `API_BASE_URL` 없이 다시 빌드해야 한다는 점도 함께
알린다 — 로컬용 번들을 올리면 운영에서 localhost를 호출한다.

## 그 외

- 셋업·실행 방법과 알려진 제한사항(Flutter 웹 fill 레이스, 검색창 라벨 소실,
  마스터 삭제 다이얼로그 버그 등)은 `README.md`에 있다. 새 테스트를 쓰기 전에
  「알려진 제한사항」을 먼저 읽는다.
- 폼 입력은 항상 `tests/support/reliable-fill.ts`의 `fillReliably` /
  `fillFieldsReliably`를 쓴다. 일반 `fill()`을 직접 쓰지 않는다.
