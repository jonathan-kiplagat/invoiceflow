from __future__ import annotations

import base64
import io
from decimal import Decimal

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings
from app.core.phone import format_phone
from app.core.timeutil import today_local, utcnow
from app.models import Business, BusinessSettings, TaxRate
from app.services.numbering import format_number

# Suggested starting rates for a Kenyan business. They are ordinary editable records:
# the user can change or delete them, and must confirm they match current KRA rules.
SUGGESTED_TAX_RATES = [
    ("VAT (standard)", Decimal("16")),
    ("Zero-rated", Decimal("0")),
    ("Exempt", Decimal("0")),
]


def create_business(name: str, email: str) -> Business:
    business = Business(name=name, email=email)
    business.settings = BusinessSettings(
        default_terms="Payment is due by the date shown on this invoice. Thank you for your business.",
    )
    business.tax_rates = [TaxRate(name=n, rate=r) for n, r in SUGGESTED_TAX_RATES]
    return business


def payment_instructions_text(s: BusinessSettings) -> str:
    lines: list[str] = []
    if s.mpesa_type == "paybill" and s.mpesa_paybill:
        lines.append(f"M-Pesa Paybill: {s.mpesa_paybill}")
        lines.append(f"Account number: {s.mpesa_account or 'Invoice number'}")
    elif s.mpesa_type == "till" and s.mpesa_till:
        lines.append(f"M-Pesa Buy Goods Till: {s.mpesa_till}")
    elif s.mpesa_type == "phone" and s.mpesa_phone:
        lines.append(f"M-Pesa Send Money: {format_phone(s.mpesa_phone)}")
    if s.mpesa_type != "none" and s.mpesa_name:
        lines.append(f"M-Pesa name: {s.mpesa_name}")
    if s.bank_name and s.bank_account_number:
        lines.append(f"Bank: {s.bank_name}" + (f", {s.bank_branch}" if s.bank_branch else ""))
        if s.bank_account_name:
            lines.append(f"Account name: {s.bank_account_name}")
        lines.append(f"Account number: {s.bank_account_number}")
        if s.bank_swift:
            lines.append(f"SWIFT: {s.bank_swift}")
    if s.other_payment_instructions:
        lines.append(s.other_payment_instructions)
    return "\n".join(lines)


def logo_data_url(business: Business) -> str | None:
    if not business.logo:
        return None
    return f"data:{business.logo_mime or 'image/png'};base64,{base64.b64encode(business.logo).decode('ascii')}"


def business_snapshot(business: Business) -> dict:
    return {
        "name": business.name,
        "email": business.email,
        "phone": format_phone(business.phone),
        "address": business.address,
        "website": business.website,
        "registration_number": business.registration_number,
        "kra_pin": business.kra_pin,
        "vat_registered": business.vat_registered,
        "vat_number": business.vat_number,
    }


def number_previews(s: BusinessSettings) -> tuple[str, str]:
    today = today_local()
    return (
        format_number(s.invoice_number_format, s.next_invoice_seq, today),
        format_number(s.quote_number_format, s.next_quote_seq, today),
    )


def process_logo(data: bytes) -> tuple[bytes, str]:
    """Validate an uploaded image and re-encode it.

    Re-encoding with Pillow drops any embedded scripts/metadata and guarantees the file is a
    real raster image. SVG is intentionally not accepted.
    """
    settings = get_settings()
    if len(data) > settings.max_logo_bytes:
        raise HTTPException(413, "Logo must be 2 MB or smaller")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        if img.format not in {"PNG", "JPEG", "WEBP", "GIF"}:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a PNG, JPEG or WEBP image")
        if img.width * img.height > 40_000_000:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image dimensions are too large")
        img.load()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is not a valid image") from None
    img = img.convert("RGBA")
    img.thumbnail((settings.max_logo_dimension, settings.max_logo_dimension))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue(), "image/png"


def set_logo(business: Business, data: bytes) -> None:
    business.logo, business.logo_mime = process_logo(data)
    business.logo_updated_at = utcnow()
