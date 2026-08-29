"""E2E 업무흐름이 만든 오더/운송만 제거한다.

공개 API는 실행이 시작된 운송이나 확정 오더를 삭제할 수 없다. 정상적인 제품
규칙을 테스트 정리 때문에 느슨하게 만들지 않도록, 테스트가 기록한 고유 notes를
키로 관련 행만 개발 DB에서 정리한다.
"""
from __future__ import annotations

import sys

from sqlalchemy import bindparam, text

from app.core.config import settings
from app.db.session import SessionLocal


def table(name: str) -> str:
    return f'"{settings.DB_SCHEMA}"."{name}"'


def main(token: str) -> None:
    db = SessionLocal()
    try:
        order_ids = list(
            db.execute(
                text(f"SELECT id FROM {table('orders')} WHERE notes = :token"),
                {"token": token},
            ).scalars()
        )
        if not order_ids:
            return

        shipment_ids = list(
            db.execute(
                text(
                    f"SELECT DISTINCT shipment_id FROM {table('shipment_orders')} "
                    "WHERE order_id IN :ids"
                ).bindparams(bindparam("ids", expanding=True)),
                {"ids": order_ids},
            ).scalars()
        )

        if shipment_ids:
            for child in (
                "claims",
                "eta_predictions",
                "exceptions",
                "proofs_of_delivery",
                "spot_quotes",
                "tenders",
                "tracking_events",
                "assignments",
                "shipment_stops",
                "shipment_orders",
            ):
                db.execute(
                    text(
                        f"DELETE FROM {table(child)} WHERE shipment_id IN :ids"
                    ).bindparams(bindparam("ids", expanding=True)),
                    {"ids": shipment_ids},
                )
            db.execute(
                text(
                    f"DELETE FROM {table('status_history')} "
                    "WHERE entity_type = 'shipment' AND entity_id IN :ids"
                ).bindparams(bindparam("ids", expanding=True)),
                {"ids": shipment_ids},
            )
            db.execute(
                text(f"DELETE FROM {table('shipments')} WHERE id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": shipment_ids},
            )

        for child in (
            "claims",
            "customer_invoice_lines",
            "exceptions",
            "order_charges",
            "order_items",
            "order_references",
            "order_stops",
        ):
            db.execute(
                text(f"DELETE FROM {table(child)} WHERE order_id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": order_ids},
            )
        db.execute(
            text(
                f"DELETE FROM {table('status_history')} "
                "WHERE entity_type = 'order' AND entity_id IN :ids"
            ).bindparams(bindparam("ids", expanding=True)),
            {"ids": order_ids},
        )
        db.execute(
            text(f"DELETE FROM {table('orders')} WHERE id IN :ids").bindparams(
                bindparam("ids", expanding=True)
            ),
            {"ids": order_ids},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main(sys.argv[1])
