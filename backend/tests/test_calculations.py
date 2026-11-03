import json
from decimal import Decimal as D

import pytest

from app.core.money import format_money
from app.services.calculations import compute_line, compute_totals
from tests.conftest import FIXTURES

CASES = json.loads((FIXTURES / "calc_cases.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_fixtures(case):
    lines = [
        compute_line(D(i["quantity"]), D(i["unit_price"]), i["discount_type"], D(i["discount_value"]), D(i["tax_rate"]), case["pricing_mode"])
        for i in case["items"]
    ]
    for got, exp in zip(lines, case["lines"], strict=True):
        assert (str(got.subtotal), str(got.discount), str(got.tax), str(got.total)) == (exp["subtotal"], exp["discount"], exp["tax"], exp["total"])
    t = compute_totals(lines, D(case["shipping"]), case["pricing_mode"])
    exp = case["totals"]
    assert str(t.subtotal) == exp["subtotal"]
    assert str(t.discount_total) == exp["discount_total"]
    assert str(t.tax_total) == exp["tax_total"]
    assert str(t.shipping) == exp["shipping"]
    assert str(t.total) == exp["total"]


def test_no_float_drift():
    # 0.1 + 0.2 style errors must never appear.
    lines = [compute_line(D("1"), D("0.10"), "percent", D("0"), D("0"), "exclusive") for _ in range(3)]
    assert compute_totals(lines, D("0"), "exclusive").total == D("0.30")


def test_currency_formatting():
    assert format_money(D("1234.5"), "KES") == "KSh 1,234.50"
    assert format_money(D("-10"), "USD") == "-$ 10.00"
    assert format_money(D("1000000"), "EUR") == "€ 1,000,000.00"
