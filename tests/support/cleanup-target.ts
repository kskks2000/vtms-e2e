import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { authHeaders } from './master-api';
import { requireEnv } from './env';

const execFileAsync = promisify(execFile);

/**
 * 워크플로 스펙의 정리 경로가 **테스트 대상과 같은 DB**를 향하는지 확인한다.
 *
 * 마스터 스펙의 정리(`master-api.ts`)는 HTTP로 `API_BASE_URL`을 호출하므로 대상을
 * 자동으로 따라간다. 반면 워크플로 스펙의 정리(`workflow-cleanup.py`)는 그럴 수
 * 없다 — 이 스위트가 만든 오더는 `completed`, 운송은 `closed`로 끝나는데 공개
 * API는 `draft` 오더와 `planned` 운송만 지울 수 있기 때문이다
 * (`../vtms/backend/app/orders/service.py`의 `delete_order`,
 * `app/planning/service.py`의 `delete_shipment`). 그래서 정리는 DB에 직접 SQL을
 * 날리고, 그 DB는 `../vtms/backend` 설정에서 온다.
 *
 * 두 대상이 갈라지면 스위트는 여전히 그린인 채로 (a) 만든 오더를 대상 서버에
 * 남기고 (b) 엉뚱한 DB의 행을 지울 수 있다. 그 조용한 실패를 막는 것이 이
 * 가드다. 실측(2026-08-30): 가동계 `www.logistics.ai.kr`와 로컬 백엔드는 같은
 * DB(`db.logistics.ai.kr/dblogis/vtms`)를 보고 있어 통과한다.
 */

interface DbIdentity {
  order_no: string | null;
  order_count: number;
  dsn: string;
}

interface OrderListResponse {
  items?: Array<{ id: number; order_no: string }>;
  total?: number;
}

export type TargetCheck =
  | { ok: true; note?: string }
  | { ok: false; reason: string };

/**
 * 대상 서버가 아는 오더와 정리 DB가 아는 오더를 대조한다. 부수효과가 없는 순수
 * 함수라 DB 없이 그대로 테스트할 수 있다.
 *
 * 오더 건수는 판정에 쓰지 않는다 — API 응답은 tenant로 걸러지지만 DB의
 * `count(*)`는 전체 tenant를 세므로 같은 DB라도 두 값이 다를 수 있다.
 */
export function compareTargets(
  api: { orderId: number | null; orderNo: string | null },
  db: DbIdentity,
  apiBaseUrl: string,
): TargetCheck {
  if (api.orderId === null) {
    return {
      ok: true,
      note:
        `대상(${apiBaseUrl})에 조회 가능한 오더가 없어 정리 DB(${db.dsn})와의 ` +
        `동일성을 확인하지 못했습니다. 비어 있는 환경이라 지울 것도 남길 것도 ` +
        `없지만, 이 실행에서는 가드가 아무것도 보장하지 않습니다.`,
    };
  }

  if (db.order_no === null) {
    return {
      ok: false,
      reason:
        `대상 서버(${apiBaseUrl})의 오더 id=${api.orderId}(${api.orderNo})가 ` +
        `정리 DB(${db.dsn})에는 없습니다. 서로 다른 DB입니다.`,
    };
  }

  if (db.order_no !== api.orderNo) {
    return {
      ok: false,
      reason:
        `오더 id=${api.orderId}가 대상 서버(${apiBaseUrl})에서는 ` +
        `${api.orderNo}인데 정리 DB(${db.dsn})에서는 ${db.order_no}입니다. ` +
        `서로 다른 DB입니다.`,
    };
  }

  return { ok: true };
}

async function probeApi(): Promise<{
  orderId: number | null;
  orderNo: string | null;
}> {
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const res = await fetch(`${apiBaseUrl}/api/orders?limit=1`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(
      `정리 대상 검증: 대상 서버 오더 조회 실패 (${apiBaseUrl}) — HTTP ${res.status}`,
    );
  }
  const body = (await res.json()) as OrderListResponse;
  const first = body.items?.[0];
  return first
    ? { orderId: first.id, orderNo: first.order_no }
    : { orderId: null, orderNo: null };
}

async function probeDb(orderId: number): Promise<DbIdentity> {
  const backendDir = path.resolve(process.cwd(), '../vtms/backend');
  const { stdout } = await execFileAsync(
    path.join(backendDir, '.venv/bin/python'),
    [
      path.resolve(process.cwd(), 'tests/support/cleanup-db-identity.py'),
      String(orderId),
    ],
    { cwd: backendDir, env: { ...process.env, PYTHONPATH: backendDir } },
  );
  return JSON.parse(stdout) as DbIdentity;
}

/**
 * 아무것도 쓰기 전에 호출한다. 대상이 갈라져 있으면 즉시 던져서, 대상 서버에
 * 찌꺼기를 남기거나 엉뚱한 DB를 지우기 전에 실행을 멈춘다.
 */
export async function assertCleanupDbMatchesTarget(): Promise<void> {
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const api = await probeApi();
  // 비교할 오더가 없으면 DB 조회는 의미가 없다. id 자리에는 아무 값이나 넣어도
  // 되지만, 조회가 실제로 건너뛰어졌음이 드러나도록 존재할 수 없는 id를 쓴다.
  const db = await probeDb(api.orderId ?? -1);

  const result = compareTargets(api, db, apiBaseUrl);
  if (result.ok) {
    if (result.note) console.warn(`[정리 대상 검증] ${result.note}`);
    return;
  }

  throw new Error(
    [
      '정리 대상 DB가 테스트 대상과 다릅니다.',
      '',
      result.reason,
      '',
      '이 스펙이 만드는 오더는 completed, 운송은 closed로 끝나는데 공개 API는',
      'draft 오더와 planned 운송만 지울 수 있어서, 정리는 DB에 직접 SQL을 날립니다',
      '(tests/support/workflow-cleanup.py). 그 DB는 API_BASE_URL이 아니라',
      '../vtms/backend 설정에서 옵니다. 이대로 진행하면 만든 오더가 대상 서버에',
      '그대로 남고, 엉뚱한 DB의 행을 지울 수 있습니다.',
      '',
      '해결 — 다음 중 하나:',
      `  - API_BASE_URL을 ../vtms/backend가 보는 DB의 서버로 맞춘다`,
      `  - ../vtms/backend/.env의 DATABASE_URL을 대상 서버의 DB로 맞춘다`,
      `    (../vtms는 읽기 전용이므로 사용자가 직접 바꿔야 합니다)`,
      `  - 이 스펙을 빼고 돌린다: --grep-invert "오더 생성"`,
    ].join('\n'),
  );
}
