import fs from 'node:fs';
import { requireEnv } from './env';

const STORAGE_STATE_PATH = 'playwright/.auth/user.json';

interface StorageState {
  origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
}

function readAccessToken(): string {
  const raw = fs.readFileSync(STORAGE_STATE_PATH, 'utf-8');
  const state = JSON.parse(raw) as StorageState;
  for (const origin of state.origins) {
    for (const item of origin.localStorage) {
      if (item.name === 'access_token') return item.value;
    }
  }
  throw new Error(
    `${STORAGE_STATE_PATH}에서 access_token을 찾지 못했습니다. global-setup이 먼저 실행됐는지 확인하세요.`,
  );
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${readAccessToken()}` };
}

function apiBaseUrl(): string {
  return requireEnv('API_BASE_URL');
}

/**
 * 검색어로 찾은 행을 백엔드 API로 지운다. **테스트의 삭제 검증 경로가 아니다** —
 * 삭제는 반드시 화면에서 한다(master-ui.ts의 deleteRowViaUi). 이 함수는 테스트가
 * 중간에 실패해서 UI 삭제까지 도달하지 못했을 때 개발 DB에 찌꺼기를 남기지
 * 않으려는 안전망이며, afterEach에서만 호출한다. 이미 지워졌으면 조용히 통과한다.
 */
export async function cleanupRowsViaApi(
  masterKey: string,
  pkName: string,
  searchValue: string,
): Promise<void> {
  const headers = authHeaders();
  const searchRes = await fetch(
    `${apiBaseUrl()}/api/master/${masterKey}?q=${encodeURIComponent(searchValue)}&limit=50`,
    { headers },
  );
  if (!searchRes.ok) return;
  const page = (await searchRes.json()) as {
    items: Array<Record<string, unknown>>;
  };
  for (const item of page.items) {
    const pk = item[pkName];
    if (pk === undefined || pk === null) continue;
    await fetch(
      `${apiBaseUrl()}/api/master/${masterKey}/${encodeURIComponent(String(pk))}`,
      { method: 'DELETE', headers },
    );
  }
}

/**
 * 거래처(partners) 레코드를 백엔드 API로 직접 등록한다. UI로 매 테스트마다
 * 등록 폼을 거치면 텍스트 필드 fill 레이스(reliable-fill.ts 참고)가 겹쳐
 * 누적되어 불안정해지므로, "수정" 동작만 검증하는 테스트는 사전 데이터를
 * API로 만들어두고 UI는 실제로 검증하려는 동작에만 쓴다.
 */
export async function createPartnerViaApi(
  code: string,
  name: string,
): Promise<void> {
  const res = await fetch(`${apiBaseUrl()}/api/master/partners`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  if (!res.ok) {
    throw new Error(`거래처 등록 실패 (code=${code}): HTTP ${res.status}`);
  }
}

/**
 * 거래처(partners) 마스터 레코드를 코드로 찾아 백엔드 API로 직접 삭제한다.
 * 마스터 화면의 삭제 확인 다이얼로그는 알려진 버그로 실제 DELETE 요청을
 * 보내지 않으므로(README의 "알려진 제한사항" 참고) 테스트 데이터 정리는
 * UI가 아니라 항상 이 방식을 쓴다. 레코드가 이미 없으면 조용히 통과한다
 * (idempotent — 테스트 실패로 정리가 두 번 불려도 안전).
 */
export async function deletePartnerByCode(code: string): Promise<void> {
  const headers = authHeaders();

  const searchRes = await fetch(
    `${apiBaseUrl()}/api/master/partners?q=${encodeURIComponent(code)}&limit=10`,
    { headers },
  );
  if (!searchRes.ok) {
    throw new Error(`거래처 검색 실패 (code=${code}): HTTP ${searchRes.status}`);
  }
  const page = (await searchRes.json()) as {
    items: Array<{ id: number; code: string }>;
  };
  const match = page.items.find((item) => item.code === code);
  if (!match) return;

  const deleteRes = await fetch(
    `${apiBaseUrl()}/api/master/partners/${match.id}`,
    { method: 'DELETE', headers },
  );
  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(
      `거래처 삭제 실패 (id=${match.id}): HTTP ${deleteRes.status}`,
    );
  }
}
