from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.money import format_money
from app.models import Invoice, Payment
from app.schemas.documents import PaymentIn
from app.services.status import refresh_invoice


def _recalculate(db: Session, inv: Invoice) -> None:
    db.flush()
    amounts = db.execute(select(Payment.amount).where(Payment.invoice_id == inv.id)).scalars().all()
    inv.amount_paid = sum(amounts, Decimal("0"))
    refresh_invoice(inv)
    inv.version += 1


def record_payment(db: Session, inv: Invoice, data: PaymentIn) -> tuple[Payment, bool]:
    """Record a payment against an invoice. Returns (payment, created).

    Idempotent per client_uuid so a retried request never records the same payment twice.
    The caller commits; payment insert + invoice totals/status update happen in one transaction.
    """
    if data.client_uuid:
        existing = db.execute(
            select(Payment).where(Payment.business_id == inv.business_id, Payment.client_uuid == data.client_uuid)
        ).scalar_one_or_none()
        if existing is not None:
            if existing.invoice_id != inv.id:
                raise HTTPException(status.HTTP_409_CONFLICT, "This payment reference was already used")
            return existing, False
    if inv.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Payments cannot be recorded on a cancelled invoice")
    if inv.total <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "This invoice has no amount due")
    balance = inv.total - inv.amount_paid
    if data.amount > balance:
        raise HTTPException(
            422,
            f"Amount exceeds the outstanding balance of {format_money(balance, inv.currency)}",
        )
    payment = Payment(
        business_id=inv.business_id,
        invoice_id=inv.id,
        client_uuid=data.client_uuid,
        payment_date=data.payment_date,
        amount=data.amount,
        method=data.method,
        reference=(data.reference or "").strip() or None,
        notes=(data.notes or "").strip() or None,
    )
    db.add(payment)
    _recalculate(db, inv)
    return payment, True


def delete_payment(db: Session, payment: Payment) -> Invoice:
    inv = payment.invoice
    db.delete(payment)
    _recalculate(db, inv)
    return inv
