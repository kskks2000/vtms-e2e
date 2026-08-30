"""테스트가 만든 마스터 행 하나를 토큰으로 찾아 **물리** 삭제한다.

왜 필요한가: 마스터 23종 중 9종은 `soft_delete_col = "deleted_at"` 이라
화면 삭제도 API 삭제도 `UPDATE ... SET deleted_at = now()` 로 끝난다. 화면·API·
검색은 전부 `deleted_at IS NULL` 로 걸러서 "정리됐다"고 보이지만 행은 영구히
남는다. 실측(2026-08-30): 이 스위트가 그렇게 447건을 쌓아 두고 있었고, 실행
한 번마다 9종 × 1건씩 늘어난다.

왜 `E2E%` 로 뭉뚱그려 지우지 않는가: `fullyParallel: true` 라 워커 5개가 동시에
돈다. 접두사로 지우면 한 테스트가 다른 테스트가 쓰고 있는 행을 지운다. 그래서
호출자가 넘긴 **그 테스트의 고유 토큰**에 걸리는 행만 지운다.

안전장치: 토큰이 `E2E` 로 시작하는 형식이 아니면 아무것도 하지 않고 실패한다.
실수로 빈 문자열이나 일반 문자열이 넘어와 테이블을 비우는 일을 막는다.

사용: python master-purge.py <master_key> <token>
출력: 지운 행 수
"""
from __future__ import annotations

import re
import sys

from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal
from app.masters.config import MASTERS_BY_KEY

# 이 스위트가 쓰는 토큰 형식만 허용한다:
#   masters-crud   E2E-<13자리ms>-<난수>
#   partners-crud  E2E-PARTNER-<13자리ms>
TOKEN_PATTERN = re.compile(r"^E2E-[A-Za-z0-9-]+$")


def main(master_key: str, token: str) -> None:
    if not TOKEN_PATTERN.match(token):
        raise SystemExit(
            f"거부: 토큰 형식이 아닙니다 ({token!r}). "
            f"이 스크립트는 테스트가 만든 고유 토큰에 걸리는 행만 지웁니다."
        )

    cfg = MASTERS_BY_KEY.get(master_key)
    if cfg is None:
        raise SystemExit(f"거부: 알 수 없는 마스터 키입니다 ({master_key!r}).")

    schema = settings.DB_SCHEMA
    db = SessionLocal()
    try:
        # 토큰이 어느 컬럼에 들어갔는지는 마스터마다 다르다(master-meta.ts의
        # planFor가 고른다). 텍스트 컬럼 전체를 대상으로 찾는다.
        text_cols = [
            row[0]
            for row in db.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = :t "
                    "AND data_type IN ('text', 'character varying')"
                ),
                {"s": schema, "t": cfg.table},
            )
        ]
        if not text_cols:
            print(0)
            return

        cond = " OR ".join(f'"{c}" LIKE :pat' for c in text_cols)
        deleted = db.execute(
            text(f'DELETE FROM "{schema}"."{cfg.table}" WHERE {cond}'),
            {"pat": f"%{token}%"},
        ).rowcount
        db.commit()
        print(deleted)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
