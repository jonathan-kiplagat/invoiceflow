"""Document numbering, e.g. INV-{YYYY}-{SEQ:4} -> INV-2026-0042."""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BusinessSettings, Invoice, Quotation

_SEQ = re.compile(r"\{SEQ(?::(\d))?\}")


def format_number(fmt: str, seq: int, on: date) -> str:
    out = fmt.replace("{YYYY}", f"{on.year:04d}").replace("{YY}", f"{on.year % 100:02d}").replace(
        "{MM}", f"{on.month:02d}"
    )

    def _seq(m: re.Match) -> str:
        width = int(m.group(1) or 1)
        return f"{seq:0{width}d}"

    return _SEQ.sub(_seq, out)


def next_number(db: Session, business_id: int, kind: str, on: date) -> str:
    """Allocate the next number atomically.

    The settings row is locked (SELECT ... FOR UPDATE on PostgreSQL; SQLite serialises
    writers) and the counter advanced in the caller's transaction. If a number was already
    used (e.g. the user lowered the counter), we skip ahead until a free number is found.
    """
    settings = db.execute(
        select(BusinessSettings).where(BusinessSettings.business_id == business_id).with_for_update()
    ).scalar_one()
    model = Invoice if kind == "invoice" else Quotation
    fmt = settings.invoice_number_format if kind == "invoice" else settings.quote_number_format
    seq = settings.next_invoice_seq if kind == "invoice" else settings.next_quote_seq
    for _ in range(10_000):
        candidate = format_number(fmt, seq, on)
        exists = db.execute(
            select(model.id).where(model.business_id == business_id, model.number == candidate)
        ).first()
        seq += 1
        if not exists:
            break
    else:  # pragma: no cover - pathological
        raise RuntimeError("Could not allocate a document number")
    if kind == "invoice":
        settings.next_invoice_seq = seq
    else:
        settings.next_quote_seq = seq
    return candidate
