import { execFile } from 'child_process';

/**
 * 이 머신의 시계가 실제 시각보다 뒤처져 있지 않은지 먼저 확인한다.
 *
 * 로그인 화면은 백엔드에 이메일/비밀번호를 직접 보내지 않는다. 먼저
 * Firebase(`signInWithEmailAndPassword`)로 인증해 ID 토큰을 받고, 그 토큰을
 * `POST /api/auth/firebase`로 넘겨 자체 JWT를 발급받는다
 * (`../vtms/lib/core/auth/auth_controller.dart`). 토큰의 `iat`는 Google 서버가
 * **실제 시각**으로 찍는데, 검증은 이 맥에서 도는 백엔드가 **자기 시계**로
 * 한다. 그래서 로컬 시계가 느리면 방금 발급된 토큰이 "미래에 발급된 토큰"으로
 * 보인다.
 *
 * vtms 백엔드는 `app/core/firebase.py`에서 `verify_firebase_token()`을
 * `clock_skew_in_seconds` 없이 호출하고, google-auth(2.30.0)의 기본 허용치는
 * **0초**다. 즉 1초만 밀려도 검증이 실패한다 (실측 확인 — 401 응답 본문:
 * `Token used too early, 1786457712 < 1786457713`). 앱은 이 401을 화면에
 * 표시하지 않고 `/#/login`에 그대로 머무르므로, 증상은
 * `waitForURL('**\/master')` 30초 타임아웃으로만 나타난다 — 잘못 빌드된
 * 번들(`bundle-preflight.ts`)과 구분이 되지 않는 그 모호한 실패다.
 *
 * 검사 방향이 한쪽뿐인 이유: 깨지는 조건은 `iat > now`, 즉 시계가 **느릴** 때만
 * 이다. 시계가 빠른 경우 토큰이 실제보다 오래된 것으로 보이지만 `exp`가 1시간
 * 뒤라 여유가 충분해서 문제가 되지 않는다.
 */

// 오프셋 임계값. Firebase의 `iat`는 초 단위로 내림되고 백엔드 허용치는 0초라,
// 시계가 조금이라도 느리면 초 경계에 걸리는 순간 실패한다(0.3초 느리면 매 초의
// 30% 구간에서 실패). 즉 "안전한 지연"이라는 값은 원래 없다. 그렇다고 0에
// 가깝게 잡으면 정상적으로 동기화된 머신에서도 스위트가 막히므로, 실패가 드문
// 사고가 아니라 상시 현상이 되는 지점을 임계값으로 둔다.
const MAX_LAG_SECONDS = 0.5;

// NTP 질의는 UDP 한 방이라 그냥 유실되거나, 짧은 간격으로 여러 번 물으면
// 서버가 응답을 거를 수 있다(실측 확인 — 셸에서 연속 5회는 전부 성공했는데
// 바로 이어진 global-setup에서는 한 번에 실패해 검사가 통째로 건너뛰어졌다).
// 정작 시계가 틀어졌을 때 검사가 조용히 빠지는 것이 이 preflight의 최악의
// 실패 방식이므로, 서로 다른 제공자를 순서대로 시도해 처음 답하는 곳을 쓴다.
const NTP_SERVERS = ['time.apple.com', 'pool.ntp.org', 'time.google.com'];
const SNTP_WAIT_SECONDS = 3;
const SNTP_TIMEOUT_MS = 8_000;

/**
 * `sntp <server>`의 출력에서 오프셋(초)을 뽑는다.
 *
 * 관심 있는 줄은 이런 형태다:
 *   `+2.010962 +/- 0.010742 time.apple.com 17.253.114.43`
 * 앞뒤로 서버 상태 덤프(`addr: ...`, `}` 등)가 섞여 나오므로 줄 단위로 훑어
 * 마지막으로 일치한 값을 쓴다.
 *
 * 부호는 **로컬 시계에 더해야 하는 보정값**이다. 따라서 양수 = 로컬이 그만큼
 * 느리다 (실측 확인 — sntp가 `+2.010962`를 보고한 시점에 백엔드가 실제로 1초
 * 뒤처진 시각으로 토큰을 검증해 `Token used too early`로 거부했다).
 */
export function parseSntpOffsetSeconds(output: string): number | null {
  let offset: number | null = null;
  for (const line of output.split('\n')) {
    const match = /^\s*([+-]\d+\.\d+)\s+\+\/-/.exec(line);
    if (match) offset = Number(match[1]);
  }
  return offset;
}

async function querySntp(server: string): Promise<number | null> {
  const output = await new Promise<string>((resolve) => {
    execFile(
      'sntp',
      ['-t', String(SNTP_WAIT_SECONDS), server],
      { timeout: SNTP_TIMEOUT_MS },
      // sntp는 응답을 정상적으로 받고도 종료 코드가 0이 아닌 경우가 있어서
      // error 여부로 판단하지 않고, 출력에서 오프셋을 뽑을 수 있는지로만
      // 판단한다. 실행 자체가 실패하면 stdout/stderr가 비어 파싱이 null이 된다.
      (_error, stdout, stderr) => resolve(`${stdout}\n${stderr}`),
    );
  });

  return parseSntpOffsetSeconds(output);
}

type ClockMeasurement = { lag: number; server: string };

async function measureClockLag(): Promise<ClockMeasurement | null> {
  for (const server of NTP_SERVERS) {
    const lag = await querySntp(server);
    if (lag !== null) return { lag, server };
  }
  return null;
}

export async function assertClockIsSynchronized(): Promise<void> {
  const measured = await measureClockLag();

  // 어느 서버도 답하지 않는 경우(sntp 없음, NTP 차단/오프라인)에는 스위트를
  // 막지 않는다. 이 검사는 모호한 실패를 설명해 주는 보조 장치일 뿐이고, 실제로
  // 시계가 맞는 머신에서 네트워크 사정 때문에 전체 테스트가 빨개지는 쪽이 더
  // 나쁘다. 대신 검사를 건너뛴 사실은 남긴다.
  if (measured === null) {
    console.warn(
      `[clock-preflight] 시계 오차를 확인하지 못해 검사를 건너뜁니다 ` +
        `(시도한 서버: ${NTP_SERVERS.join(', ')}). 로그인이 30초 타임아웃으로 ` +
        `실패하면 시계를 먼저 의심하세요.`,
    );
    return;
  }

  const { lag, server } = measured;
  if (lag < MAX_LAG_SECONDS) return;

  throw new Error(
    [
      `이 머신의 시계가 실제 시각보다 ${lag.toFixed(3)}초 느립니다`,
      `(${server} 기준, 허용 ${MAX_LAG_SECONDS}초).`,
      ``,
      `이 상태로는 로그인이 반드시 실패합니다. Firebase가 실제 시각으로 발급한`,
      `ID 토큰이 백엔드에게는 미래에 발급된 것으로 보이고, vtms 백엔드는`,
      `시계 오차 허용치 없이(google-auth 기본값 0초) 검증하기 때문에`,
      `POST /api/auth/firebase가 401로 거부됩니다:`,
      `  "유효하지 않은 Firebase 토큰입니다: Token used too early, ..."`,
      `앱은 이 401을 화면에 표시하지 않아, 증상은 waitForURL 30초 타임아웃으로만`,
      `나타납니다.`,
      ``,
      `해결 (관리자 권한 필요):`,
      ``,
      `  sudo sntp -sS ${server}`,
      ``,
      `확인 — 아래 오프셋이 0에 가까워야 합니다:`,
      ``,
      `  sntp ${server}`,
      ``,
      `반복된다면 시스템 설정 → 일반 → 날짜 및 시간에서 "시간 및 날짜 자동`,
      `설정"이 켜져 있는지 확인하세요.`,
    ].join('\n'),
  );
}
