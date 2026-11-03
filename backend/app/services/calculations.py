"""Invoice arithmetic. The server is the source of truth for every stored amount.

The frontend mirrors these exact rules (frontend/src/utils/calc.ts) for live previews;
tests on both sides use the same fixtures.

Per line:
    gross     = round2(quantity x unit_price)
    discount  = round2(gross x pct / 100)       (percent)  |  min(value, gross)  (amount)
    net       = gross - discount
    exclusive: tax = round2(net x rate / 100);          line_total = net + tax
    inclusive: tax = round2(net x rate / (100 + rate)); line_total = net   (tax already inside)

Document:
    subtotal = sum(gross), discount = sum(discount), tax = sum(tax)
    exclusive: total = subtotal - discount + tax + shipping
    inclusive: total = subtotal - discount + shipping
    Shipping / additional charges are not taxed.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.core.money import ZERO, q2

HUNDRED = Decimal("100")


@dataclass(frozen=True)
class LineResult:
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal


@dataclass(frozen=True)
class Totals:
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    shipping: Decimal
    total: Decimal


def compute_line(
    quantity: Decimal,
    unit_price: Decimal,
    discount_type: str,
    discount_value: Decimal,
    tax_rate: Decimal,
    pricing_mode: str,
) -> LineResult:
    gross = q2(Decimal(quantity) * Decimal(unit_price))
    if discount_type == "percent":
        pct = min(max(Decimal(discount_value), ZERO), HUNDRED)
        discount = q2(gross * pct / HUNDRED)
    else:
        discount = min(q2(max(Decimal(discount_value), ZERO)), gross)
    net = gross - discount
    rate = Decimal(tax_rate)
    if pricing_mode == "inclusive":
        tax = q2(net * rate / (HUNDRED + rate)) if rate > 0 else ZERO
        total = net
    else:
        tax = q2(net * rate / HUNDRED)
        total = net + tax
    return LineResult(subtotal=gross, discount=discount, tax=tax, total=q2(total))


def compute_totals(lines: list[LineResult], shipping: Decimal, pricing_mode: str) -> Totals:
    subtotal = sum((line.subtotal for line in lines), ZERO)
    discount = sum((line.discount for line in lines), ZERO)
    tax = sum((line.tax for line in lines), ZERO)
    shipping = q2(shipping)
    if pricing_mode == "inclusive":
        total = subtotal - discount + shipping
    else:
        total = subtotal - discount + tax + shipping
    return Totals(
        subtotal=q2(subtotal), discount_total=q2(discount), tax_total=q2(tax),
        shipping=shipping, total=q2(total),
    )
