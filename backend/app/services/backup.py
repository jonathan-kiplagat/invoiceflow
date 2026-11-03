"""Full-account JSON backup and restore.

Restore replaces all of the account's business data in a single transaction: either the
whole backup is applied or nothing changes. Record IDs are remapped, so a backup can be
restored into any account (e.g. after moving to a new server).
"""

from __future__ import annotations

import base64
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.timeutil import utcnow
from app.models import (
    Business,
    BusinessSettings,
    Customer,
    EmailLog,
    Invoice,
    InvoiceItem,
    Payment,
    Quotation,
    QuotationItem,
    TaxRate,
)

FORMAT = "invoiceflow-backup"
VERSION = 1

_SKIP = {"id", "business_id", "created_at", "updated_at"}


def _plain(obj, skip=()) -> dict:
    out = {}
    for col in obj.__table__.columns:
        if col.key in _SKIP or col.key in skip:
            continue
        v = getattr(obj, col.key)
        if isinstance(v, Decimal):
            v = format(v, "f")
        elif isinstance(v, (date, datetime)):
            v = v.isoformat()
        elif isinstance(v, bytes):
            v = base64.b64encode(v).decode("ascii")
        out[col.key] = v
    return out


def export_backup(db: Session, business: Business) -> dict:
    bid = business.id
    customers = db.execute(select(Customer).where(Customer.business_id == bid)).scalars().all()
    invoices = db.execute(select(Invoice).where(Invoice.business_id == bid)).scalars().unique().all()
    quotes = db.execute(select(Quotation).where(Quotation.business_id == bid)).scalars().unique().all()
    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": utcnow().isoformat(),
        "business": _plain(business, skip={"user_id"}),
        "settings": _plain(business.settings),
        "tax_rates": [{"_id": t.id, **_plain(t)} for t in business.tax_rates],
        "customers": [{"_id": c.id, **_plain(c)} for c in customers],
        "quotations": [
            {"_id": q.id, **_plain(q), "items": [_plain(i, skip={"quotation_id"}) for i in q.items]} for q in quotes
        ],
        "invoices": [
            {
                "_id": i.id, **_plain(i),
                "items": [_plain(it, skip={"invoice_id"}) for it in i.items],
                "payments": [_plain(p, skip={"invoice_id"}) for p in i.payments],
            }
            for i in invoices
        ],
    }


def _coerce(model, data: dict) -> dict:
    out = {}
    cols = {c.key: c for c in model.__table__.columns}
    for k, v in data.items():
        if k.startswith("_") or k in _SKIP or k not in cols or v is None:
            if k in cols and v is None and k not in _SKIP:
                out[k] = None
            continue
        pytype = None
        try:
            pytype = cols[k].type.python_type
        except NotImplementedError:
            pass
        if pytype is Decimal:
            v = Decimal(str(v))
        elif pytype is date and isinstance(v, str):
            v = date.fromisoformat(v)
        elif pytype is datetime and isinstance(v, str):
            v = datetime.fromisoformat(v)
        elif pytype is bytes and isinstance(v, str):
            v = base64.b64decode(v)
        out[k] = v
    return out


def restore_backup(db: Session, business: Business, data: dict) -> dict:
    if data.get("format") != FORMAT or data.get("version") != VERSION:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This is not an InvoiceFlow backup file")
    bid = business.id
    try:
        # 1. Wipe existing data (children first).
        db.execute(delete(Payment).where(Payment.business_id == bid))
        db.execute(delete(EmailLog).where(EmailLog.business_id == bid))
        inv_ids = select(Invoice.id).where(Invoice.business_id == bid)
        quo_ids = select(Quotation.id).where(Quotation.business_id == bid)
        db.execute(delete(InvoiceItem).where(InvoiceItem.invoice_id.in_(inv_ids)))
        db.execute(delete(QuotationItem).where(QuotationItem.quotation_id.in_(quo_ids)))
        db.query(Quotation).filter(Quotation.business_id == bid).update({Quotation.converted_invoice_id: None})
        db.execute(delete(Invoice).where(Invoice.business_id == bid))
        db.execute(delete(Quotation).where(Quotation.business_id == bid))
        db.execute(delete(Customer).where(Customer.business_id == bid))
        business.settings.default_tax_rate_id = None
        db.flush()
        db.execute(delete(TaxRate).where(TaxRate.business_id == bid))
        db.flush()
        db.expire_all()

        # 2. Business profile and settings.
        biz_data = _coerce(Business, data.get("business", {}))
        biz_data.pop("user_id", None)
        for k, v in biz_data.items():
            setattr(business, k, v)
        settings_data = _coerce(BusinessSettings, data.get("settings", {}))
        old_default_rate = settings_data.pop("default_tax_rate_id", None)

        tax_map: dict[int, int] = {}
        for t in data.get("tax_rates", []):
            rate = TaxRate(business_id=bid, **_coerce(TaxRate, t))
            db.add(rate)
            db.flush()
            tax_map[t["_id"]] = rate.id
        for k, v in settings_data.items():
            setattr(business.settings, k, v)
        business.settings.default_tax_rate_id = tax_map.get(old_default_rate)

        cust_map: dict[int, int] = {}
        for c in data.get("customers", []):
            row = Customer(business_id=bid, **_coerce(Customer, c))
            db.add(row)
            db.flush()
            cust_map[c["_id"]] = row.id

        def _items(src, cls):
            out = []
            for it in src:
                d = _coerce(cls, it)
                d["tax_rate_id"] = tax_map.get(d.get("tax_rate_id"))
                out.append(cls(**d))
            return out

        quo_map: dict[int, int] = {}
        pending_convert: list[tuple[Quotation, int]] = []
        for q in data.get("quotations", []):
            d = _coerce(Quotation, q)
            d["customer_id"] = cust_map.get(d.get("customer_id"))
            conv = d.pop("converted_invoice_id", None)
            row = Quotation(business_id=bid, **d)
            row.items = _items(q.get("items", []), QuotationItem)
            db.add(row)
            db.flush()
            quo_map[q["_id"]] = row.id
            if conv:
                pending_convert.append((row, conv))

        inv_map: dict[int, int] = {}
        for i in data.get("invoices", []):
            d = _coerce(Invoice, i)
            d["customer_id"] = cust_map.get(d.get("customer_id"))
            d["quotation_id"] = quo_map.get(d.get("quotation_id"))
            d["share_token"] = None  # old public links are not carried over
            row = Invoice(business_id=bid, **d)
            row.items = _items(i.get("items", []), InvoiceItem)
            db.add(row)
            db.flush()
            inv_map[i["_id"]] = row.id
            for p in i.get("payments", []):
                db.add(Payment(business_id=bid, invoice_id=row.id, **_coerce(Payment, p)))
        for q_row, old_inv in pending_convert:
            q_row.converted_invoice_id = inv_map.get(old_inv)
        db.flush()
    except HTTPException:
        db.rollback()
        raise
    except (KeyError, TypeError, ValueError, InvalidOperation, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"The backup file is damaged or incomplete ({type(exc).__name__})") from None
    except Exception:
        db.rollback()
        raise
    db.commit()
    return {
        "customers": len(cust_map), "invoices": len(inv_map), "quotations": len(quo_map),
        "tax_rates": len(tax_map),
    }
