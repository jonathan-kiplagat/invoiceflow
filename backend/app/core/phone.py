"""Kenyan-first phone number normalisation.

Accepts 0712345678, 712345678, 254712345678, +254 712 345 678, 0110 123 456, and
international numbers that start with '+'. Stores E.164 (+254712345678).
"""

import re

_DIGITS = re.compile(r"\D")


def normalize_phone(raw: str | None) -> str | None:
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    has_plus = raw.startswith("+")
    digits = _DIGITS.sub("", raw)
    if not digits:
        raise ValueError("Phone number must contain digits")
    if has_plus:
        e164 = "+" + digits
    elif digits.startswith("254") and len(digits) == 12:
        e164 = "+" + digits
    elif digits.startswith("0") and len(digits) == 10 and digits[1] in "17":
        e164 = "+254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "17":
        e164 = "+254" + digits
    else:
        raise ValueError(
            "Enter a Kenyan number such as 0712 345 678, or an international number starting with +"
        )
    if e164.startswith("+254") and len(e164) != 13:
        raise ValueError("Kenyan numbers have 9 digits after +254")
    if not 8 <= len(e164) <= 16:
        raise ValueError("Phone number length is not valid")
    return e164


def format_phone(e164: str | None) -> str:
    if not e164:
        return ""
    if e164.startswith("+254") and len(e164) == 13:
        n = e164[4:]
        return f"+254 {n[:3]} {n[3:6]} {n[6:]}"
    return e164


def whatsapp_digits(e164: str | None) -> str | None:
    if not e164:
        return None
    return e164.lstrip("+")
