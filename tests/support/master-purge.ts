import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 마스터 테스트가 만든 행을 토큰으로 찾아 **물리** 삭제한다.
 *
 * `master-api.ts`의 `cleanupRowsViaApi` / `deletePartnerByCode`(HTTP)와 짝을
 * 이루는 뒷정리다. 그쪽은 마스터 23종 중 9종에서 소프트 삭제로 끝나
 * (`soft_delete_col = "deleted_at"`) 행이 DB에 영구히 남는다. 화면·API·검색이
 * 전부 `deleted_at IS NULL`로 걸러서 겉으로는 정리된 것처럼 보이지만, 실행
 * 한 번마다 9종 × 1건씩 쌓인다(실측 2026-08-30: 447건 누적).
 *
 * HTTP로는 할 수 없어서 DB에 직접 붙는다 — 백엔드에 물리 삭제 엔드포인트가
 * 없고, 정리 편의로 제품에 그런 걸 만들 수도 없다. 그래서 `workflow-cleanup.py`
 * 와 같은 제약을 그대로 물려받는다: **연결 대상이 `API_BASE_URL`이 아니라
 * `../vtms/backend` 설정에서 온다.** 두 대상이 갈라지면 조용히 엉뚱한 DB를
 * 지우므로, 이 함수를 쓰는 스펙은 반드시 `cleanup-target.ts`의
 * `assertCleanupDbMatchesTarget`을 `beforeAll`에서 먼저 돌려야 한다.
 *
 * 실패해도 던지지 않는다 — 이건 검증 경로가 아니라 뒷정리이고, 정리가
 * 안 됐다고 통과한 테스트를 실패로 뒤집으면 진짜 신호가 가려진다. 대신
 * 경고를 남긴다.
 */
export async function purgeRowsViaDb(
  masterKey: string,
  token: string,
): Promise<void> {
  const backendDir = path.resolve(process.cwd(), '../vtms/backend');
  try {
    const { stdout } = await execFileAsync(
      path.join(backendDir, '.venv/bin/python'),
      [
        path.resolve(process.cwd(), 'tests/support/master-purge.py'),
        masterKey,
        token,
      ],
      { cwd: backendDir, env: { ...process.env, PYTHONPATH: backendDir } },
    );
    const deleted = Number(stdout.trim());
    if (!Number.isFinite(deleted)) {
      console.warn(
        `[물리 정리] ${masterKey}/${token}: 예상치 못한 출력 — ${stdout.trim()}`,
      );
    }
  } catch (error) {
    console.warn(
      `[물리 정리] ${masterKey}/${token} 실패 — DB에 행이 남았을 수 있습니다: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
