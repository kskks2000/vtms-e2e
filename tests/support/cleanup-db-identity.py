"""정리 대상 DB의 신원을 읽어 온다. 아무것도 바꾸지 않는다 — SELECT 만 한다.

`workflow-cleanup.py`는 `API_BASE_URL`을 쓰지 않는다. `../vtms/backend`의
`settings`/`SessionLocal`을 import 해서 **로컬 백엔드가 설정한 DB**에 직접 SQL을
날린다. 그래서 테스트 대상(`API_BASE_URL`)과 정리 대상(이 DB)이 갈라질 수 있고,
갈라지면 두 가지가 동시에, 그리고 **조용히** 일어난다:

  (a) 스펙이 만든 오더·운송이 대상 서버에 그대로 남는다 (정리가 헛돈다)
  (b) 같은 notes 토큰이 우연히 걸리면 엉뚱한 DB의 행을 지운다

둘 다 실패로 드러나지 않아 그린 스위트로 보인다. `cleanup-target.ts`가 쓰기
전에 이 스크립트로 두 대상이 같은 DB인지 대조한다.

사용: python cleanup-db-identity.py <order_id>
출력: {"order_no": str|null, "order_count": int, "dsn": str}  (dsn 에 비밀번호 없음)
"""
from __future__ import annotations

import json
import sys

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.db.session import SessionLocal


def sanitized_dsn() -> str:
    """비밀번호를 뺀 `host:port/db/schema`. 실패 메시지에 그대로 실린다."""
    url = make_url(settings.DATABASE_URL)
    return f"{url.host}:{url.port}/{url.database}/{settings.DB_SCHEMA}"


def main(order_id: str) -> None:
    schema = settings.DB_SCHEMA
    db = SessionLocal()
    try:
        order_no = db.execute(
            text(f'SELECT order_no FROM "{schema}"."orders" WHERE id = :id'),
            {"id": int(order_id)},
        ).scalar()
        order_count = db.execute(
            text(f'SELECT count(*) FROM "{schema}"."orders"')
        ).scalar()
    finally:
        db.close()

    print(
        json.dumps(
            {
                "order_no": order_no,
                "order_count": int(order_count or 0),
                "dsn": sanitized_dsn(),
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
