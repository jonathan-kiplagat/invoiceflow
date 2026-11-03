import csv
import io
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentBusiness, owned_customer, owned_invoice, owned_payment
from app.api.responses import csv_response, csv_safe, pdf_response
from app.core.security import new_share_token
from app.core.timeutil import utcnow
from app.models import Customer, EmailLog, Invoice, Payment
from app.schemas.common import Page
from app.schemas.documents import (
    EmailSendIn,
    EmailSendOut,
    InvoiceIn,
    InvoiceOut,
    InvoiceSummaryOut,
    InvoiceUpdateIn,
    PaymentIn,
    PaymentListOut,
    PaymentOut,
    ShareInfoOut,
)
from app.services import documents as docs
from app.services.payments import delete_payment, record_payment
from app.services.pdf import render_document, view_from_model, view_from_payload
from app.services.sharing import (
    EmailNotConfigured,
    email_draft,
    mailto_url,
    send_email,
    share_url,
    whatsapp_message,
    whatsapp_url,
)
from app.services.status import refresh_invoice, refresh_overdue
from app.core.config import get_settings

router = APIRouter(tags=["invoices"])

SORTS = {
    "issue_date": Invoice.issue_date, "due_date": Invoice.due_date, "number": Invoice.number,
    "total": cast(Invoice.total, Float), "balance_due": cast(Invoice.balance_due, Float),
    "status": Invoice.status, "updated_at": Invoice.updated_at,
}


def _summary(inv: Invoice) -> dict:
    out = InvoiceSummaryOut.model_validate(inv).model_dump()
    out["customer_name"] = (inv.customer_snapshot or {}).get("name")
    return out


def _filtered(business_id: int, q, status_, customer_id, date_from, date_to):
    stmt = select(Invoice).where(Invoice.business_id == business_id)
    if status_:
        wanted = [s for s in status_.split(",") if s]
        if "unpaid" in wanted:
            wanted = [s for s in wanted if s != "unpaid"] + ["sent", "partially_paid", "overdue"]
        stmt = stmt.where(Invoice.status.in_(wanted))
    if customer_id:
        stmt = stmt.where(Invoice.customer_id == customer_id)
    if date_from:
        stmt = stmt.where(Invoice.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.issue_date <= date_to)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.outerjoin(Customer, Customer.id == Invoice.customer_id).where(or_(
            func.lower(Invoice.number).like(like), func.lower(Customer.name).like(like),
            func.lower(Customer.company).like(like), func.lower(Invoice.notes).like(like),
        ))
    return stmt


@router.get("/invoices", response_model=Page[InvoiceSummaryOut])
def list_invoices(
    business: CurrentBusiness, db: DB,
    q: str | None = Query(default=None, max_length=100),
    status: str | None = Query(default=None, max_length=100),
    customer_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
    sort: Literal["issue_date", "due_date", "number", "total", "balance_due", "status", "updated_at"] = "issue_date",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=200),
) -> Page[InvoiceSummaryOut]:
    refresh_overdue(db, business.id)
    stmt = _filtered(business.id, q, status, customer_id, date_from, date_to)
    total = db.execute(select(func.count()).select_from(stmt.with_only_columns(Invoice.id).subquery())).scalar_one()
    col = SORTS[sort]
    stmt = stmt.order_by(col.desc() if order == "desc" else col.asc(), Invoice.id.desc())
    rows = db.execute(stmt.offset((page - 1) * page_size).limit(page_size)).scalars().unique().all()
    return Page(items=[_summary(i) for i in rows], total=total, page=page, page_size=page_size)


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
def create_invoice(data: InvoiceIn, business: CurrentBusiness, db: DB, response: Response) -> Invoice:
    # Idempotent: a retried offline sync with the same client_uuid returns the original invoice.
    existing = docs.find_by_client_uuid(db, Invoice, business.id, data.client_uuid)
    if existing is not None:
        response.status_code = 200
        return existing
    try:
        inv = docs.create_invoice(db, business, data)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = docs.find_by_client_uuid(db, Invoice, business.id, data.client_uuid)
        if existing is not None:  # concurrent duplicate submission
            response.status_code = 200
            return existing
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not save the invoice, please retry") from None
    db.refresh(inv)
    return inv


@router.post("/invoices/preview.pdf")
def preview_invoice_pdf(data: InvoiceIn, business: CurrentBusiness, db: DB) -> Response:
    """Render an unsaved invoice exactly as it will look once saved."""
    if data.new_customer is not None:
        customer = docs.customer_snapshot(docs.Customer(**data.new_customer.model_dump()))
    elif data.customer_id:
        customer = docs.customer_snapshot(owned_customer(db, business, data.customer_id))
    else:
        customer = None
    view = view_from_payload(data, business, "invoice", "PREVIEW", customer)
    return pdf_response(render_document(view, data.template, business.logo), "invoice-preview", download=False)


@router.get("/invoices/export.csv")
def export_invoices(
    business: CurrentBusiness, db: DB, q: str | None = None, status: str | None = None,
    customer_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
) -> Response:
    refresh_overdue(db, business.id)
    rows = db.execute(_filtered(business.id, q, status, customer_id, date_from, date_to).order_by(Invoice.issue_date, Invoice.id)).scalars().unique()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Invoice number", "Customer", "Issue date", "Due date", "Status", "Currency", "Subtotal", "Discount", "Tax", "Shipping", "Total", "Amount paid", "Balance due"])
    for i in rows:
        w.writerow([i.number, csv_safe((i.customer_snapshot or {}).get("name")), i.issue_date, i.due_date, i.status, i.currency, i.subtotal, i.discount_total, i.tax_total, i.shipping, i.total, i.amount_paid, i.balance_due])
    return csv_response(buf.getvalue(), "invoices")


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    inv = owned_invoice(db, business, invoice_id)
    old = inv.status
    refresh_invoice(inv)
    if inv.status != old:
        db.commit()
    return inv


@router.put("/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(invoice_id: int, data: InvoiceUpdateIn, business: CurrentBusiness, db: DB) -> Invoice:
    inv = owned_invoice(db, business, invoice_id)
    if not docs.check_version(inv, data.version, data.client_revision, data.force_overwrite):
        return inv
    docs.update_invoice(db, business, inv, data)
    db.commit()
    db.refresh(inv)
    return inv


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int, business: CurrentBusiness, db: DB) -> Response:
    inv = owned_invoice(db, business, invoice_id)
    if db.execute(select(Payment.id).where(Payment.invoice_id == inv.id).limit(1)).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This invoice has recorded payments. Cancel it instead, or delete the payments first.",
        )
    db.delete(inv)
    db.commit()
    return Response(status_code=204)


@router.post("/invoices/{invoice_id}/duplicate", response_model=InvoiceOut, status_code=201)
def duplicate_invoice(invoice_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    src = owned_invoice(db, business, invoice_id)
    inv = docs.duplicate_invoice(db, business, src)
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/invoices/{invoice_id}/send", response_model=InvoiceOut)
def mark_sent(invoice_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    """Mark as sent: an explicit user action (the app does not know whether the customer received it)."""
    inv = owned_invoice(db, business, invoice_id)
    docs.ensure_editable_invoice(inv)
    if not inv.items:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add at least one item before sending")
    if inv.customer_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose a customer before sending")
    if inv.sent_at is None:
        inv.sent_at = utcnow()
        refresh_invoice(inv)
        inv.version += 1
        db.commit()
    return inv


@router.post("/invoices/{invoice_id}/cancel", response_model=InvoiceOut)
def cancel_invoice(invoice_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    inv = owned_invoice(db, business, invoice_id)
    if inv.cancelled_at is None:
        inv.cancelled_at = utcnow()
        refresh_invoice(inv)
        inv.version += 1
        db.commit()
    return inv


@router.post("/invoices/{invoice_id}/reopen", response_model=InvoiceOut)
def reopen_invoice(invoice_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    inv = owned_invoice(db, business, invoice_id)
    if inv.cancelled_at is not None:
        inv.cancelled_at = None
        refresh_invoice(inv)
        inv.version += 1
        db.commit()
    return inv


@router.get("/invoices/{invoice_id}/pdf")
def invoice_pdf(
    invoice_id: int, business: CurrentBusiness, db: DB,
    template: Literal["modern", "corporate", "elegant", "classic"] | None = None, download: bool = False,
) -> Response:
    inv = owned_invoice(db, business, invoice_id)
    refresh_invoice(inv)
    pdf = render_document(view_from_model(inv, business), template or inv.template, business.logo)
    return pdf_response(pdf, f"invoice-{inv.number}", download)


# ---------------------------------------------------------------------------- sharing

@router.post("/invoices/{invoice_id}/share-link", response_model=ShareInfoOut)
def create_share_link(invoice_id: int, business: CurrentBusiness, db: DB) -> ShareInfoOut:
    inv = owned_invoice(db, business, invoice_id)
    if inv.share_token is None:
        inv.share_token = new_share_token()
        db.commit()
    return share_info(invoice_id, business, db)


@router.delete("/invoices/{invoice_id}/share-link", response_model=ShareInfoOut)
def revoke_share_link(invoice_id: int, business: CurrentBusiness, db: DB) -> ShareInfoOut:
    inv = owned_invoice(db, business, invoice_id)
    inv.share_token = None
    db.commit()
    return share_info(invoice_id, business, db)


@router.get("/invoices/{invoice_id}/share-info", response_model=ShareInfoOut)
def share_info(invoice_id: int, business: CurrentBusiness, db: DB) -> ShareInfoOut:
    inv = owned_invoice(db, business, invoice_id)
    snap = inv.customer_snapshot or {}
    msg = whatsapp_message(inv, business)
    subject, body = email_draft(inv, business)
    url = share_url(inv)
    return ShareInfoOut(
        share_url=url,
        pdf_url=f"{get_settings().public_app_url.rstrip('/')}/api/v1/public/invoices/{inv.share_token}/pdf" if inv.share_token else None,
        whatsapp_phone=snap.get("phone_e164"),
        whatsapp_message=msg,
        whatsapp_url=whatsapp_url(snap.get("phone_e164"), msg),
        email_to=snap.get("email"),
        email_subject=subject,
        email_body=body,
        mailto_url=mailto_url(snap.get("email"), subject, body),
        email_integration_enabled=get_settings().email_enabled,
    )


@router.post("/invoices/{invoice_id}/email", response_model=EmailSendOut)
def email_invoice(invoice_id: int, data: EmailSendIn, business: CurrentBusiness, db: DB) -> EmailSendOut:
    inv = owned_invoice(db, business, invoice_id)
    try:
        to = str(TypeAdapter(EmailStr).validate_python(data.to.strip()))
    except ValidationError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid email address") from None
    attachment = None
    if data.attach_pdf:
        pdf = render_document(view_from_model(inv, business), inv.template, business.logo)
        attachment = (f"Invoice-{inv.number}.pdf", pdf)
    log = EmailLog(business_id=business.id, invoice_id=inv.id, to_email=to, subject=data.subject, created_at=utcnow(), status="failed")
    try:
        send_email(to, data.subject, data.body, business.email, attachment)
    except EmailNotConfigured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Email sending is not configured on this server. Download the PDF and send it from your email app.",
        ) from None
    except Exception as exc:  # noqa: BLE001 - report SMTP failures to the user without internals
        log.error = type(exc).__name__
        db.add(log)
        db.commit()
        return EmailSendOut(status="failed", detail="The email server did not accept the message. Nothing was sent.")
    log.status = "accepted"
    db.add(log)
    db.commit()
    return EmailSendOut(status="accepted", detail=f"Accepted by the mail server for delivery to {to}.")


# ---------------------------------------------------------------------------- payments

@router.get("/invoices/{invoice_id}/payments", response_model=list[PaymentOut])
def invoice_payments(invoice_id: int, business: CurrentBusiness, db: DB) -> list[Payment]:
    return owned_invoice(db, business, invoice_id).payments


@router.post("/invoices/{invoice_id}/payments", response_model=InvoiceOut, status_code=201)
def add_payment(invoice_id: int, data: PaymentIn, business: CurrentBusiness, db: DB, response: Response) -> Invoice:
    inv = owned_invoice(db, business, invoice_id)
    _, created = record_payment(db, inv, data)
    if not created:
        response.status_code = 200
    db.commit()
    db.refresh(inv)
    return inv


@router.get("/payments", response_model=Page[PaymentListOut])
def list_payments(
    business: CurrentBusiness, db: DB,
    q: str | None = Query(default=None, max_length=100), method: str | None = None,
    date_from: date | None = None, date_to: date | None = None,
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=200),
) -> Page[PaymentListOut]:
    stmt = select(Payment).join(Invoice).where(Payment.business_id == business.id).options(selectinload(Payment.invoice))
    if method:
        stmt = stmt.where(Payment.method == method)
    if date_from:
        stmt = stmt.where(Payment.payment_date >= date_from)
    if date_to:
        stmt = stmt.where(Payment.payment_date <= date_to)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.outerjoin(Customer, Customer.id == Invoice.customer_id).where(or_(
            func.lower(Invoice.number).like(like), func.lower(Payment.reference).like(like), func.lower(Customer.name).like(like)
        ))
    total = db.execute(select(func.count()).select_from(stmt.with_only_columns(Payment.id).subquery())).scalar_one()
    rows = db.execute(stmt.order_by(Payment.payment_date.desc(), Payment.id.desc()).offset((page - 1) * page_size).limit(page_size)).scalars().all()
    items = [
        {**PaymentOut.model_validate(p).model_dump(), "invoice_number": p.invoice.number,
         "customer_name": (p.invoice.customer_snapshot or {}).get("name"), "currency": p.invoice.currency}
        for p in rows
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/payments/export.csv")
def export_payments(business: CurrentBusiness, db: DB) -> Response:
    rows = db.execute(select(Payment).where(Payment.business_id == business.id).order_by(Payment.payment_date, Payment.id)).scalars()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Invoice", "Customer", "Method", "Reference", "Currency", "Amount", "Notes"])
    for p in rows:
        w.writerow([p.payment_date, p.invoice.number, csv_safe((p.invoice.customer_snapshot or {}).get("name")), p.method, csv_safe(p.reference), p.invoice.currency, p.amount, csv_safe(p.notes)])
    return csv_response(buf.getvalue(), "payments")


@router.delete("/payments/{payment_id}", response_model=InvoiceOut)
def remove_payment(payment_id: int, business: CurrentBusiness, db: DB) -> Invoice:
    payment = owned_payment(db, business, payment_id)
    inv = delete_payment(db, payment)
    db.commit()
    db.refresh(inv)
    return inv
