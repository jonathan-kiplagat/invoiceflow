"""Dashboard and reports, calculated from recorded invoices and payments only.

Three different numbers are kept apart deliberately:
* invoiced   - value of issued (non-draft, non-cancelled) invoices, by issue date
* collected  - money actually recorded as received, by payment date
* receivable - balances still outstanding on open invoices
"""

import csv
import io
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import func, select

from app.api.deps import DB, CurrentBusiness
from app.api.responses import csv_response, csv_safe
from app.core.timeutil import today_local
from app.models import Customer, Invoice, Payment, Quotation
from app.services.status import refresh_overdue

router = APIRouter(prefix="/reports", tags=["reports"])
ZERO = Decimal("0")
ISSUED = ("sent", "partially_paid", "paid", "overdue")
OPEN = ("sent", "partially_paid", "overdue")


def s(d: Decimal) -> str:
    return format(d, "f")


def _months_back(today: date, n: int) -> list[tuple[int, int]]:
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _load(db, business_id: int, currency: str):
    invoices = db.execute(
        select(Invoice).where(Invoice.business_id == business_id, Invoice.currency == currency)
    ).scalars().unique().all()
    payments = db.execute(
        select(Payment, Invoice.customer_id, Invoice.due_date, Invoice.number)
        .join(Invoice).where(Payment.business_id == business_id, Invoice.currency == currency)
    ).all()
    return invoices, payments


@router.get("/dashboard")
def dashboard(business: CurrentBusiness, db: DB, currency: str | None = None) -> dict:
    refresh_overdue(db, business.id)
    cur = (currency or business.settings.default_currency).upper()
    today = today_local()
    invoices, payments = _load(db, business.id, cur)
    issued = [i for i in invoices if i.status in ISSUED]
    open_ = [i for i in invoices if i.status in OPEN]
    overdue = [i for i in invoices if i.status == "overdue"]
    status_counts: dict[str, int] = defaultdict(int)
    for i in invoices:
        status_counts[i.status] += 1

    months = _months_back(today, 12)
    inv_m = {k: ZERO for k in months}
    col_m = {k: ZERO for k in months}
    for i in issued:
        k = (i.issue_date.year, i.issue_date.month)
        if k in inv_m:
            inv_m[k] += i.total
    for p, *_ in payments:
        k = (p.payment_date.year, p.payment_date.month)
        if k in col_m:
            col_m[k] += p.amount

    recent = sorted(invoices, key=lambda i: (i.updated_at, i.id), reverse=True)[:6]
    recent_pay = sorted(payments, key=lambda r: (r[0].payment_date, r[0].id), reverse=True)[:6]
    currencies = sorted(set(db.execute(select(Invoice.currency).where(Invoice.business_id == business.id)).scalars()) | {business.settings.default_currency})
    customer_count = db.execute(
        select(func.count(Customer.id)).where(Customer.business_id == business.id, Customer.is_archived.is_(False))
    ).scalar_one()

    paid_count = sum(1 for i in issued if i.status == "paid")
    return {
        "currency": cur,
        "currencies": currencies,
        "totals": {
            "invoice_count": sum(1 for i in invoices if i.status != "cancelled"),
            "invoiced": s(sum((i.total for i in issued), ZERO)),
            "collected": s(sum((p.amount for p, *_ in payments), ZERO)),
            "outstanding": s(sum((i.balance_due for i in open_), ZERO)),
            "overdue_amount": s(sum((i.balance_due for i in overdue), ZERO)),
            "overdue_count": len(overdue),
            "customer_count": customer_count,
            "draft_count": status_counts.get("draft", 0),
        },
        "monthly": [
            {"month": f"{y:04d}-{m:02d}", "invoiced": s(inv_m[(y, m)]), "collected": s(col_m[(y, m)])} for y, m in months
        ],
        "paid_vs_unpaid": {
            "paid_count": paid_count,
            "unpaid_count": len(open_),
            "collected": s(sum((i.amount_paid for i in issued), ZERO)),
            "outstanding": s(sum((i.balance_due for i in open_), ZERO)),
        },
        "status_counts": {k: status_counts.get(k, 0) for k in ("draft", "sent", "partially_paid", "paid", "overdue", "cancelled")},
        "recent_invoices": [
            {"id": i.id, "number": i.number, "customer_name": (i.customer_snapshot or {}).get("name"), "status": i.status,
             "total": s(i.total), "balance_due": s(i.balance_due), "due_date": i.due_date.isoformat(), "currency": i.currency}
            for i in recent
        ],
        "recent_payments": [
            {"id": p.id, "invoice_id": p.invoice_id, "invoice_number": number, "amount": s(p.amount), "method": p.method,
             "payment_date": p.payment_date.isoformat(), "reference": p.reference, "currency": cur}
            for p, _cid, _due, number in recent_pay
        ],
    }


def _summary(db, business, year: int, cur: str) -> dict:
    today = today_local()
    invoices, payments = _load(db, business.id, cur)
    issued = [i for i in invoices if i.status in ISSUED]
    open_ = [i for i in invoices if i.status in OPEN]

    monthly = []
    for m in range(1, 13):
        monthly.append({
            "month": f"{year:04d}-{m:02d}",
            "invoiced": s(sum((i.total for i in issued if i.issue_date.year == year and i.issue_date.month == m), ZERO)),
            "collected": s(sum((p.amount for p, *_ in payments if p.payment_date.year == year and p.payment_date.month == m), ZERO)),
        })

    ytd_invoiced = sum((i.total for i in issued if i.issue_date.year == year and i.issue_date <= today), ZERO)
    ytd_collected = sum((p.amount for p, *_ in payments if p.payment_date.year == year and p.payment_date <= today), ZERO)

    # Ageing of receivables as of today.
    buckets = {"current": ZERO, "1_30": ZERO, "31_60": ZERO, "61_90": ZERO, "90_plus": ZERO}
    for i in open_:
        days = (today - i.due_date).days
        key = "current" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60 else "61_90" if days <= 90 else "90_plus"
        buckets[key] += i.balance_due

    # Customer payment performance.
    last_payment: dict[int, date] = {}
    for p, *_ in payments:
        if p.invoice_id not in last_payment or p.payment_date > last_payment[p.invoice_id]:
            last_payment[p.invoice_id] = p.payment_date
    names = dict(db.execute(select(Customer.id, Customer.name).where(Customer.business_id == business.id)).all())
    per: dict[int, dict] = defaultdict(lambda: {"invoiced": ZERO, "paid": ZERO, "outstanding": ZERO, "count": 0, "days": [], "on_time": 0, "settled": 0})
    for i in issued:
        if i.customer_id is None:
            continue
        r = per[i.customer_id]
        r["invoiced"] += i.total
        r["paid"] += i.amount_paid
        r["outstanding"] += i.balance_due
        r["count"] += 1
        if i.status == "paid" and i.id in last_payment:
            r["settled"] += 1
            r["days"].append((last_payment[i.id] - i.issue_date).days)
            if last_payment[i.id] <= i.due_date:
                r["on_time"] += 1
    customers = []
    for cid, r in per.items():
        customers.append({
            "customer_id": cid, "name": names.get(cid, "—"), "invoice_count": r["count"],
            "invoiced": s(r["invoiced"]), "paid": s(r["paid"]), "outstanding": s(r["outstanding"]),
            "avg_days_to_pay": round(sum(r["days"]) / len(r["days"]), 1) if r["days"] else None,
            "on_time_rate": round(r["on_time"] / r["settled"] * 100, 1) if r["settled"] else None,
        })
    customers.sort(key=lambda c: Decimal(c["invoiced"]), reverse=True)

    methods: dict[str, dict] = defaultdict(lambda: {"amount": ZERO, "count": 0})
    for p, *_ in payments:
        if p.payment_date.year == year:
            methods[p.method]["amount"] += p.amount
            methods[p.method]["count"] += 1

    quotes = db.execute(select(Quotation).where(Quotation.business_id == business.id, Quotation.currency == cur)).scalars().unique().all()
    yq = [q for q in quotes if q.issue_date.year == year and q.status != "draft"]
    converted = [q for q in yq if q.status == "converted"]
    accepted = [q for q in yq if q.status in ("accepted", "converted")]

    return {
        "year": year, "currency": cur,
        "ytd_invoiced": s(ytd_invoiced), "ytd_collected": s(ytd_collected),
        "outstanding": s(sum((i.balance_due for i in open_), ZERO)),
        "overdue": s(sum((i.balance_due for i in open_ if i.status == "overdue"), ZERO)),
        "overdue_count": sum(1 for i in open_ if i.status == "overdue"),
        "monthly": monthly,
        "aging": {k: s(v) for k, v in buckets.items()},
        "customers": customers,
        "top_customers": customers[:5],
        "payment_methods": [{"method": k, "amount": s(v["amount"]), "count": v["count"]} for k, v in sorted(methods.items(), key=lambda kv: kv[1]["amount"], reverse=True)],
        "quotations": {
            "issued": len(yq), "accepted": len(accepted), "converted": len(converted),
            "conversion_rate": round(len(converted) / len(yq) * 100, 1) if yq else None,
            "converted_value": s(sum((q.total for q in converted), ZERO)),
        },
    }


@router.get("/summary")
def summary(business: CurrentBusiness, db: DB, year: int | None = Query(default=None, ge=2000, le=2100), currency: str | None = None) -> dict:
    refresh_overdue(db, business.id)
    return _summary(db, business, year or today_local().year, (currency or business.settings.default_currency).upper())


@router.get("/export/{name}.csv")
def export_report(
    name: Literal["monthly", "customers", "payment-methods", "aging"], business: CurrentBusiness, db: DB,
    year: int | None = Query(default=None, ge=2000, le=2100), currency: str | None = None,
) -> Response:
    refresh_overdue(db, business.id)
    data = _summary(db, business, year or today_local().year, (currency or business.settings.default_currency).upper())
    cur = data["currency"]
    buf = io.StringIO()
    w = csv.writer(buf)
    if name == "monthly":
        w.writerow(["Month", f"Invoiced ({cur})", f"Collected ({cur})"])
        for r in data["monthly"]:
            w.writerow([r["month"], r["invoiced"], r["collected"]])
    elif name == "customers":
        w.writerow(["Customer", "Invoices", f"Invoiced ({cur})", f"Paid ({cur})", f"Outstanding ({cur})", "Avg days to pay", "On-time %"])
        for r in data["customers"]:
            w.writerow([csv_safe(r["name"]), r["invoice_count"], r["invoiced"], r["paid"], r["outstanding"], r["avg_days_to_pay"] if r["avg_days_to_pay"] is not None else "", r["on_time_rate"] if r["on_time_rate"] is not None else ""])
    elif name == "payment-methods":
        w.writerow(["Method", "Payments", f"Amount ({cur})"])
        for r in data["payment_methods"]:
            w.writerow([r["method"], r["count"], r["amount"]])
    else:
        w.writerow(["Bucket", f"Outstanding ({cur})"])
        labels = {"current": "Not yet due", "1_30": "1-30 days overdue", "31_60": "31-60 days overdue", "61_90": "61-90 days overdue", "90_plus": "Over 90 days overdue"}
        for k, v in data["aging"].items():
            w.writerow([labels[k], v])
    return csv_response(buf.getvalue(), f"report-{name}-{data['year']}-{cur}")
