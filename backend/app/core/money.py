"""Money helpers. All amounts are Decimal and rounded half-up to 2 decimal places."""

from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0.00")

# Only currencies with 2 minor units are supported, so stored precision is uniform.
CURRENCIES: dict[str, dict[str, str]] = {
    "KES": {"symbol": "KSh", "name": "Kenyan Shilling"},
    "USD": {"symbol": "$", "name": "US Dollar"},
    "EUR": {"symbol": "€", "name": "Euro"},
    "GBP": {"symbol": "£", "name": "British Pound"},
    "TZS": {"symbol": "TSh", "name": "Tanzanian Shilling"},
    "ZAR": {"symbol": "R", "name": "South African Rand"},
    "NGN": {"symbol": "NGN", "name": "Nigerian Naira"},
    "AED": {"symbol": "AED", "name": "UAE Dirham"},
    "INR": {"symbol": "INR", "name": "Indian Rupee"},
    "CNY": {"symbol": "CNY", "name": "Chinese Yuan"},
    "CAD": {"symbol": "CA$", "name": "Canadian Dollar"},
    "AUD": {"symbol": "A$", "name": "Australian Dollar"},
    "CHF": {"symbol": "CHF", "name": "Swiss Franc"},
}


def q2(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def format_money(amount: Decimal, currency: str) -> str:
    symbol = CURRENCIES.get(currency, {}).get("symbol", currency)
    amount = q2(amount)
    sign = "-" if amount < 0 else ""
    return f"{sign}{symbol} {abs(amount):,.2f}"
