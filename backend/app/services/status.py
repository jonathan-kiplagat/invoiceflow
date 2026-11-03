"""Invoice status rules.

Stored lifecycle facts: draft (never sent), sent_at, cancelled_at, and the recorded payments.
The visible status is derived from those facts - an invoice only becomes Paid or Partially
Paid because payments were recorded, never on its own.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.timeutil import today_local
from app.models import Invoice, Quotation

INVOICE_STATUSES = ("draft", "sent", "partially_paid", "paid", "overdue", "cancelled")
QUOTATION_STATUSES = ("draft", "sent", "accepted", "declined", "expired", "converted")


def derive_invoice_status(inv: Invoice, today: date | None = None) -> str:
    today = today or today_local()
    if inv.cancelled_at is not None:
        return "cancelled"
    paid = inv.amount_paid or Decimal("0")
    total = inv.total or Decimal("0")
    if paid > 0 and paid >= total:
        return "paid"
    if inv.sent_at is None and paid == 0:
        return "draft"
    if inv.due_date < today:
        return "overdue"
    if paid > 0:
        return "partially_paid"
    return "sent"


def refresh_invoice(inv: Invoice) -> None:
    inv.balance_due = (inv.total or Decimal("0")) - (inv.amount_paid or Decimal("0"))
    inv.status = derive_invoice_status(inv)


def refresh_overdue(db: Session, business_id: int) -> None:
    """Automatic overdue detection: flag open invoices whose due date (Nairobi time) has passed."""
    today = today_local()
    db.execute(
        update(Invoice)
        .where(
            Invoice.business_id == business_id,
            Invoice.status.in_(("sent", "partially_paid")),
            Invoice.due_date < today,
        )
        .values(status="overdue")
        .execution_options(synchronize_session=False)
    )
    db.execute(
        update(Quotation)
        .where(
            Quotation.business_id == business_id,
            Quotation.status == "sent",
            Quotation.valid_until < today,
        )
        .values(status="expired")
        .execution_options(synchronize_session=False)
    )
    db.commit()
