import csv
import io
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select

from app.api.responses import csv_response, csv_safe, pdf_response
from app.api.deps import DB, CurrentBusiness, owned_customer
from app.core.timeutil import today_local
from app.models import Customer, Invoice, Payment, Quotation
from app.schemas.common import Page
from app.schemas.customer import CustomerIn, CustomerOut, CustomerWithStats
from app.schemas.documents import InvoiceSummaryOut
from app.services.business import business_snapshot
from app.services.documents import customer_snapshot
from app.services.pdf import render_statement
from app.services.pdf.statement import StatementLine
from app.services.status import refresh_overdue

router = APIRouter(prefix="/customers", tags=["customers"])


def _stats(db, business_id: int, customer_ids: list[int], currency: str) -> dict[int, dict]:
    if not customer_ids:
        return {}
    rows = db.execute(
        select(Invoice.customer_id, Invoice.total, Invoice.amount_paid, Invoice.balance_due, Invoice.status)
        .where(Invoice.business_id == business_id, Invoice.customer_id.in_(customer_ids), Invoice.currency == currency)
    ).all()
    out = {cid: {"invoice_count": 0, "total_invoiced": Decimal("0"), "total_paid": Decimal("0"), "outstanding": Decimal("0")} for cid in customer_ids}
    for cid, total, paid, balance, st in rows:
        s = out[cid]
        if st == "cancelled":
            continue
        s["invoice_count"] += 1
        if st != "draft":
            s["total_invoiced"] += total
            s["outstanding"] += balance
        s["total_paid"] += paid
    return out


def _with_stats(c: Customer, stats: dict, currency: str) -> CustomerWithStats:
    return CustomerWithStats.model_validate({**CustomerOut.model_validate(c).model_dump(), **stats, "currency": currency})


@router.get("", response_model=Page[CustomerWithStats])
def list_customers(
    business: CurrentBusiness, db: DB,
    q: str | None = Query(default=None, max_length=100),
    include_archived: bool = False,
    sort: Literal["name", "created_at"] = "name",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=500),
) -> Page[CustomerWithStats]:
    refresh_overdue(db, business.id)
    stmt = select(Customer).where(Customer.business_id == business.id)
    if not include_archived:
        stmt = stmt.where(Customer.is_archived.is_(False))
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(
            func.lower(Customer.name).like(like), func.lower(Customer.company).like(like),
            func.lower(Customer.email).like(like), Customer.phone.like(f"%{q.strip().replace(' ', '')}%"),
        ))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    order = func.lower(Customer.name).asc() if sort == "name" else Customer.created_at.desc()
    rows = list(db.execute(stmt.order_by(order, Customer.id).offset((page - 1) * page_size).limit(page_size)).scalars())
    cur = business.settings.default_currency
    stats = _stats(db, business.id, [c.id for c in rows], cur)
    return Page(items=[_with_stats(c, stats[c.id], cur) for c in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(data: CustomerIn, business: CurrentBusiness, db: DB) -> Customer:
    c = Customer(business_id=business.id, **data.model_dump())
    db.add(c)
    db.commit()
    return c


@router.get("/export.csv")
def export_customers(business: CurrentBusiness, db: DB) -> StreamingResponse:
    rows = db.execute(select(Customer).where(Customer.business_id == business.id).order_by(Customer.name)).scalars()
    cur = business.settings.default_currency
    customers = list(rows)
    stats = _stats(db, business.id, [c.id for c in customers], cur)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Company", "Email", "Phone", "Billing address", "Tax ID", "Archived", f"Invoiced ({cur})", f"Paid ({cur})", f"Outstanding ({cur})"])
    for c in customers:
        s = stats[c.id]
        w.writerow([csv_safe(c.name), csv_safe(c.company), csv_safe(c.email), c.phone or "", csv_safe((c.billing_address or "").replace("\n", ", ")), csv_safe(c.tax_id), "yes" if c.is_archived else "no", s["total_invoiced"], s["total_paid"], s["outstanding"]])
    return csv_response(buf.getvalue(), "customers")


@router.get("/{customer_id}")
def get_customer(customer_id: int, business: CurrentBusiness, db: DB) -> dict:
    c = owned_customer(db, business, customer_id)
    currencies = sorted(set(db.execute(
        select(Invoice.currency).where(Invoice.business_id == business.id, Invoice.customer_id == c.id)
    ).scalars())) or [business.settings.default_currency]
    by_currency = []
    for cur in currencies:
        s = _stats(db, business.id, [c.id], cur)[c.id]
        by_currency.append({"currency": cur, **{k: (format(v, "f") if isinstance(v, Decimal) else v) for k, v in s.items()}})
    return {"customer": CustomerOut.model_validate(c).model_dump(mode="json"), "totals": by_currency}


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, data: CustomerIn, business: CurrentBusiness, db: DB) -> Customer:
    c = owned_customer(db, business, customer_id)
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return c


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, business: CurrentBusiness, db: DB) -> Response:
    c = owned_customer(db, business, customer_id)
    has_docs = db.execute(select(Invoice.id).where(Invoice.customer_id == c.id).limit(1)).first() or db.execute(
        select(Quotation.id).where(Quotation.customer_id == c.id).limit(1)
    ).first()
    if has_docs:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This customer has invoices or quotations, so it can't be deleted. Archive it instead.",
        )
    db.delete(c)
    db.commit()
    return Response(status_code=204)


@router.get("/{customer_id}/invoices", response_model=list[InvoiceSummaryOut])
def customer_invoices(customer_id: int, business: CurrentBusiness, db: DB) -> list[dict]:
    c = owned_customer(db, business, customer_id)
    rows = db.execute(
        select(Invoice).where(Invoice.business_id == business.id, Invoice.customer_id == c.id).order_by(Invoice.issue_date.desc(), Invoice.id.desc())
    ).scalars().unique()
    return [{**InvoiceSummaryOut.model_validate(i).model_dump(), "customer_name": c.name} for i in rows]


@router.get("/{customer_id}/statement.pdf")
def customer_statement(
    customer_id: int, business: CurrentBusiness, db: DB,
    currency: str | None = None, date_from: date | None = None, date_to: date | None = None,
) -> Response:
    c = owned_customer(db, business, customer_id)
    cur = (currency or business.settings.default_currency).upper()
    date_to = date_to or today_local()
    invoices = list(db.execute(
        select(Invoice).where(
            Invoice.business_id == business.id, Invoice.customer_id == c.id, Invoice.currency == cur,
            Invoice.status.notin_(("draft", "cancelled")),
        )
    ).scalars().unique())
    payments = list(db.execute(
        select(Payment).join(Invoice).where(
            Payment.business_id == business.id, Invoice.customer_id == c.id, Invoice.currency == cur,
        )
    ).scalars())
    opening = Decimal("0")
    lines: list[StatementLine] = []
    for inv in invoices:
        if date_from and inv.issue_date < date_from:
            opening += inv.total
        elif inv.issue_date <= date_to:
            lines.append(StatementLine(inv.issue_date, "invoice", inv.number, f"Invoice (due {inv.due_date.strftime('%d %b %Y')})", inv.total, Decimal("0")))
    for p in payments:
        if date_from and p.payment_date < date_from:
            opening -= p.amount
        elif p.payment_date <= date_to:
            method = p.method.replace("_", " ").title().replace("Mpesa", "M-Pesa")
            ref = f" · {p.reference}" if p.reference else ""
            lines.append(StatementLine(p.payment_date, "payment", p.invoice.number, f"Payment — {method}{ref}", Decimal("0"), p.amount))
    lines.sort(key=lambda ln: (ln.on, 0 if ln.kind == "invoice" else 1))
    pdf = render_statement(
        business=business_snapshot(business), customer=customer_snapshot(c), currency=cur, lines=lines,
        date_from=date_from, date_to=date_to, opening_balance=opening, accent=business.settings.accent_color,
        date_format=business.settings.date_format, logo=business.logo,
    )
    filename = f"statement-{c.name.lower()}"
    return pdf_response(pdf, filename, download=True)
