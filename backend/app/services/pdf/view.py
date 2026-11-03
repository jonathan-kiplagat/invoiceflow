"""A plain view-model of an invoice or quotation, independent of the database.

Lets the same renderer produce PDFs for saved documents and for unsaved previews.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.core.money import ZERO
from app.models import Business, Invoice, Quotation
from app.services.business import business_snapshot, payment_instructions_text
from app.services.calculations import compute_line, compute_totals


@dataclass
class LineView:
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_type: str
    discount_value: Decimal
    discount_amount: Decimal
    tax_name: str | None
    tax_rate: Decimal
    tax_amount: Decimal
    total: Decimal


@dataclass
class DocView:
    kind: str  # invoice | quotation
    number: str
    status: str
    issue_date: date
    end_date: date  # due date (invoice) or valid-until (quotation)
    currency: str
    pricing_mode: str
    business: dict
    customer: dict | None
    items: list[LineView]
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    shipping: Decimal
    total: Decimal
    amount_paid: Decimal = ZERO
    balance_due: Decimal = ZERO
    notes: str | None = None
    terms: str | None = None
    payment_instructions: str | None = None
    show_signature: bool = True
    accent: str = "#0F766E"
    date_format: str = "DD MMM YYYY"
    tax_summary: list[tuple[str, Decimal, Decimal]] = field(default_factory=list)

    @property
    def title(self) -> str:
        return "Invoice" if self.kind == "invoice" else "Quotation"

    @property
    def end_label(self) -> str:
        return "Due date" if self.kind == "invoice" else "Valid until"


def _tax_summary(items: list[LineView]) -> list[tuple[str, Decimal, Decimal]]:
    groups: dict[tuple[str, Decimal], Decimal] = {}
    for it in items:
        if it.tax_rate > 0 or it.tax_amount > 0:
            key = (it.tax_name or "Tax", it.tax_rate)
            groups[key] = groups.get(key, ZERO) + it.tax_amount
    return [(name, rate, amount) for (name, rate), amount in groups.items()]


def view_from_model(doc: Invoice | Quotation, business: Business) -> DocView:
    s = business.settings
    items = [
        LineView(
            description=i.description, quantity=i.quantity, unit_price=i.unit_price,
            discount_type=i.discount_type, discount_value=i.discount_value, discount_amount=i.line_discount,
            tax_name=i.tax_name, tax_rate=i.tax_rate, tax_amount=i.line_tax, total=i.line_total,
        )
        for i in doc.items
    ]
    is_invoice = isinstance(doc, Invoice)
    return DocView(
        kind="invoice" if is_invoice else "quotation",
        number=doc.number,
        status=doc.status,
        issue_date=doc.issue_date,
        end_date=doc.due_date if is_invoice else doc.valid_until,
        currency=doc.currency,
        pricing_mode=doc.pricing_mode,
        business=doc.business_snapshot or business_snapshot(business),
        customer=doc.customer_snapshot,
        items=items,
        subtotal=doc.subtotal,
        discount_total=doc.discount_total,
        tax_total=doc.tax_total,
        shipping=doc.shipping,
        total=doc.total,
        amount_paid=doc.amount_paid if is_invoice else ZERO,
        balance_due=doc.balance_due if is_invoice else doc.total,
        notes=doc.notes,
        terms=doc.terms,
        payment_instructions=doc.payment_instructions,
        show_signature=s.show_signature,
        accent=s.accent_color,
        date_format=s.date_format,
        tax_summary=_tax_summary(items),
    )


def view_from_payload(payload, business: Business, kind: str, number: str, customer: dict | None) -> DocView:
    s = business.settings
    items: list[LineView] = []
    lines = []
    for it in payload.items:
        line = compute_line(
            it.quantity, it.unit_price, it.discount_type, it.discount_value, it.tax_rate, payload.pricing_mode
        )
        lines.append(line)
        items.append(
            LineView(
                description=it.description, quantity=it.quantity, unit_price=it.unit_price,
                discount_type=it.discount_type, discount_value=it.discount_value, discount_amount=line.discount,
                tax_name=it.tax_name, tax_rate=it.tax_rate, tax_amount=line.tax, total=line.total,
            )
        )
    totals = compute_totals(lines, payload.shipping, payload.pricing_mode)
    end = payload.due_date if kind == "invoice" else payload.valid_until
    return DocView(
        kind=kind, number=number, status="draft", issue_date=payload.issue_date, end_date=end,
        currency=payload.currency, pricing_mode=payload.pricing_mode, business=business_snapshot(business),
        customer=customer, items=items, subtotal=totals.subtotal, discount_total=totals.discount_total,
        tax_total=totals.tax_total, shipping=totals.shipping, total=totals.total, amount_paid=ZERO,
        balance_due=totals.total, notes=payload.notes, terms=payload.terms,
        payment_instructions=(
            payload.payment_instructions
            if payload.payment_instructions is not None
            else payment_instructions_text(s)
        ),
        show_signature=s.show_signature, accent=s.accent_color, date_format=s.date_format,
        tax_summary=_tax_summary(items),
    )
