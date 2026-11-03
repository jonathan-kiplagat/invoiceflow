"""Create/update logic shared by invoices and quotations."""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.phone import format_phone
from app.core.timeutil import today_local, utcnow
from app.models import (
    Business,
    Customer,
    Invoice,
    InvoiceItem,
    Quotation,
    QuotationItem,
    TaxRate,
)
from app.schemas.documents import DocumentBaseIn
from app.services.business import business_snapshot, payment_instructions_text
from app.services.calculations import compute_line, compute_totals
from app.services.numbering import next_number
from app.services.status import refresh_invoice


def customer_snapshot(c: Customer | None) -> dict | None:
    if c is None:
        return None
    return {
        "name": c.name,
        "company": c.company,
        "email": c.email,
        "phone": format_phone(c.phone),
        "phone_e164": c.phone,
        "billing_address": c.billing_address,
        "tax_id": c.tax_id,
    }


def get_owned_customer(db: Session, business_id: int, customer_id: int) -> Customer:
    c = db.get(Customer, customer_id)
    if c is None or c.business_id != business_id:
        # Same response for "missing" and "someone else's" so IDs cannot be probed.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return c


def _resolve_customer(db: Session, business: Business, payload: DocumentBaseIn) -> Customer | None:
    if payload.new_customer is not None:
        c = Customer(business_id=business.id, **payload.new_customer.model_dump())
        db.add(c)
        db.flush()
        return c
    if payload.customer_id is not None:
        return get_owned_customer(db, business.id, payload.customer_id)
    return None


def _owned_tax_rate_ids(db: Session, business_id: int) -> set[int]:
    return set(db.execute(select(TaxRate.id).where(TaxRate.business_id == business_id)).scalars())


def _build_items(db: Session, business: Business, payload: DocumentBaseIn, item_cls):
    owned = _owned_tax_rate_ids(db, business.id)
    items, lines = [], []
    for pos, it in enumerate(payload.items):
        tax_rate_id = it.tax_rate_id if it.tax_rate_id in owned else None
        line = compute_line(
            it.quantity, it.unit_price, it.discount_type, it.discount_value, it.tax_rate, payload.pricing_mode
        )
        lines.append(line)
        items.append(
            item_cls(
                position=pos,
                description=it.description,
                quantity=it.quantity,
                unit_price=it.unit_price,
                discount_type=it.discount_type,
                discount_value=it.discount_value,
                tax_rate_id=tax_rate_id,
                tax_name=it.tax_name,
                tax_rate=it.tax_rate,
                line_subtotal=line.subtotal,
                line_discount=line.discount,
                line_tax=line.tax,
                line_total=line.total,
            )
        )
    totals = compute_totals(lines, payload.shipping, payload.pricing_mode)
    return items, totals


def apply_payload(db: Session, business: Business, doc: Invoice | Quotation, payload: DocumentBaseIn) -> None:
    item_cls = InvoiceItem if isinstance(doc, Invoice) else QuotationItem
    customer = _resolve_customer(db, business, payload)
    doc.customer_id = customer.id if customer else None
    doc.customer_snapshot = customer_snapshot(customer)
    doc.business_snapshot = business_snapshot(business)
    doc.issue_date = payload.issue_date
    doc.currency = payload.currency
    doc.pricing_mode = payload.pricing_mode
    doc.template = payload.template
    doc.notes = payload.notes
    doc.terms = payload.terms
    doc.payment_instructions = (
        payload.payment_instructions
        if payload.payment_instructions is not None
        else payment_instructions_text(business.settings)
    )
    items, totals = _build_items(db, business, payload, item_cls)
    doc.items.clear()
    db.flush()
    doc.items.extend(items)
    doc.subtotal = totals.subtotal
    doc.discount_total = totals.discount_total
    doc.tax_total = totals.tax_total
    doc.shipping = totals.shipping
    doc.total = totals.total
    if payload.client_revision:
        doc.last_client_revision = payload.client_revision


def find_by_client_uuid(db: Session, model, business_id: int, client_uuid: str | None):
    if not client_uuid:
        return None
    return db.execute(
        select(model).where(model.business_id == business_id, model.client_uuid == client_uuid)
    ).scalar_one_or_none()


def check_version(doc, version: int, client_revision: str | None, force: bool) -> bool:
    """Optimistic concurrency.

    Returns True when the update should be applied, False when it is a harmless retry of an
    update the server already applied. Raises 409 when the server copy is newer.
    """
    if doc.version == version:
        return True
    if client_revision and doc.last_client_revision == client_revision:
        return False  # Retry of an update that already succeeded - idempotent no-op.
    if force:
        return True
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        {
            "code": "version_conflict",
            "message": "This document was changed on another device. Review the newer version before saving.",
            "server_version": doc.version,
        },
    )


def ensure_editable_invoice(inv: Invoice) -> None:
    if inv.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Cancelled invoices cannot be edited")


def create_invoice(db: Session, business: Business, payload) -> Invoice:
    inv = Invoice(
        business_id=business.id,
        client_uuid=payload.client_uuid or str(uuid.uuid4()),
        number=next_number(db, business.id, "invoice", payload.issue_date),
        due_date=payload.due_date,
        amount_paid=Decimal("0"),
        version=1,
    )
    apply_payload(db, business, inv, payload)
    if payload.status == "sent":
        inv.sent_at = utcnow()
    refresh_invoice(inv)
    db.add(inv)
    return inv


def update_invoice(db: Session, business: Business, inv: Invoice, payload) -> None:
    ensure_editable_invoice(inv)
    apply_payload(db, business, inv, payload)
    inv.due_date = payload.due_date
    if payload.status == "sent" and inv.sent_at is None:
        inv.sent_at = utcnow()
    if inv.amount_paid > inv.total:
        raise HTTPException(
            422,
            "The new total is lower than the payments already recorded. Remove or adjust payments first.",
        )
    refresh_invoice(inv)
    inv.version += 1


def create_quotation(db: Session, business: Business, payload) -> Quotation:
    q = Quotation(
        business_id=business.id,
        client_uuid=payload.client_uuid or str(uuid.uuid4()),
        number=next_number(db, business.id, "quotation", payload.issue_date),
        valid_until=payload.valid_until,
        status="sent" if payload.status == "sent" else "draft",
        version=1,
    )
    apply_payload(db, business, q, payload)
    if payload.status == "sent":
        q.sent_at = utcnow()
    db.add(q)
    return q


def copy_items(src_items, item_cls):
    return [
        item_cls(
            position=i.position, description=i.description, quantity=i.quantity, unit_price=i.unit_price,
            discount_type=i.discount_type, discount_value=i.discount_value, tax_rate_id=i.tax_rate_id,
            tax_name=i.tax_name, tax_rate=i.tax_rate, line_subtotal=i.line_subtotal,
            line_discount=i.line_discount, line_tax=i.line_tax, line_total=i.line_total,
        )
        for i in src_items
    ]


def _copy_header(src, dst, business: Business) -> None:
    for f in (
        "customer_id", "customer_snapshot", "currency", "pricing_mode", "template", "notes", "terms",
        "payment_instructions", "shipping", "subtotal", "discount_total", "tax_total", "total",
    ):
        setattr(dst, f, getattr(src, f))
    dst.business_snapshot = business_snapshot(business)


def duplicate_invoice(db: Session, business: Business, src: Invoice) -> Invoice:
    today = today_local()
    terms = business.settings.payment_terms_days
    inv = Invoice(
        business_id=business.id, client_uuid=str(uuid.uuid4()),
        number=next_number(db, business.id, "invoice", today),
        issue_date=today, due_date=today + timedelta(days=terms), amount_paid=Decimal("0"), version=1,
    )
    _copy_header(src, inv, business)
    inv.items = copy_items(src.items, InvoiceItem)
    refresh_invoice(inv)
    db.add(inv)
    return inv


def duplicate_quotation(db: Session, business: Business, src: Quotation) -> Quotation:
    today = today_local()
    q = Quotation(
        business_id=business.id, client_uuid=str(uuid.uuid4()),
        number=next_number(db, business.id, "quotation", today),
        issue_date=today, valid_until=today + timedelta(days=business.settings.quote_validity_days),
        status="draft", version=1,
    )
    _copy_header(src, q, business)
    q.items = copy_items(src.items, QuotationItem)
    db.add(q)
    return q


def convert_quotation(db: Session, business: Business, q: Quotation) -> Invoice:
    if q.converted_invoice_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This quotation has already been converted")
    if q.status in ("declined",):
        raise HTTPException(status.HTTP_409_CONFLICT, "A declined quotation cannot be converted")
    today = today_local()
    inv = Invoice(
        business_id=business.id, client_uuid=str(uuid.uuid4()),
        number=next_number(db, business.id, "invoice", today),
        issue_date=today, due_date=today + timedelta(days=business.settings.payment_terms_days),
        amount_paid=Decimal("0"), version=1, quotation_id=q.id,
    )
    _copy_header(q, inv, business)
    inv.items = copy_items(q.items, InvoiceItem)
    refresh_invoice(inv)
    db.add(inv)
    db.flush()
    q.converted_invoice_id = inv.id
    q.converted_at = utcnow()
    q.status = "converted"
    q.version += 1
    return inv
