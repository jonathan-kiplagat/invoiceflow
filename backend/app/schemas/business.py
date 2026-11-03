import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.money import CURRENCIES
from app.core.phone import normalize_phone
from app.schemas.common import DecimalStr, ORMModel, RateIn

_NUMBER_FORMAT = re.compile(r"^[A-Za-z0-9\-/_. #{}:]+$")


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class TaxRateIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    rate: RateIn
    is_active: bool = True


class TaxRateOut(ORMModel):
    id: int
    name: str
    rate: DecimalStr
    is_active: bool


class TemplateOut(ORMModel):
    key: str
    name: str
    description: str


class BusinessProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = Field(default=None, max_length=1000)
    website: str | None = Field(default=None, max_length=255)
    registration_number: str | None = Field(default=None, max_length=64)
    kra_pin: str | None = Field(default=None, max_length=20)
    vat_registered: bool = False
    vat_number: str | None = Field(default=None, max_length=64)

    _blank = field_validator(
        "email", "phone", "address", "website", "registration_number", "kra_pin", "vat_number", mode="before"
    )(_blank_to_none)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v)

    @field_validator("kra_pin")
    @classmethod
    def _kra(cls, v):
        if v is None:
            return v
        v = v.upper().replace(" ", "")
        # KRA PINs look like A123456789Z. Validated loosely; it is the user's responsibility to enter the right one.
        if not re.fullmatch(r"[A-Z]\d{9}[A-Z]", v):
            raise ValueError("KRA PIN format is a letter, 9 digits and a letter (e.g. P051234567X)")
        return v


class BusinessSettingsIn(BaseModel):
    default_currency: str = "KES"
    default_tax_rate_id: int | None = None
    pricing_mode: Literal["exclusive", "inclusive"] = "exclusive"
    payment_terms_days: int = Field(default=14, ge=0, le=365)
    quote_validity_days: int = Field(default=30, ge=1, le=365)
    invoice_number_format: str = Field(default="INV-{YYYY}-{SEQ:4}", min_length=5, max_length=40)
    next_invoice_seq: int = Field(default=1, ge=1, le=10_000_000)
    quote_number_format: str = Field(default="QUO-{YYYY}-{SEQ:4}", min_length=5, max_length=40)
    next_quote_seq: int = Field(default=1, ge=1, le=10_000_000)
    default_template: Literal["modern", "corporate", "elegant", "classic"] = "modern"
    date_format: Literal["DD MMM YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] = "DD MMM YYYY"
    show_signature: bool = True
    accent_color: str = Field(default="#0F766E", pattern=r"^#[0-9A-Fa-f]{6}$")
    default_notes: str | None = Field(default=None, max_length=2000)
    default_terms: str | None = Field(default=None, max_length=4000)
    bank_name: str | None = Field(default=None, max_length=120)
    bank_account_name: str | None = Field(default=None, max_length=160)
    bank_account_number: str | None = Field(default=None, max_length=64)
    bank_branch: str | None = Field(default=None, max_length=120)
    bank_swift: str | None = Field(default=None, max_length=20)
    mpesa_type: Literal["none", "paybill", "till", "phone"] = "none"
    mpesa_paybill: str | None = Field(default=None, max_length=10)
    mpesa_account: str | None = Field(default=None, max_length=40)
    mpesa_till: str | None = Field(default=None, max_length=10)
    mpesa_phone: str | None = None
    mpesa_name: str | None = Field(default=None, max_length=120)
    other_payment_instructions: str | None = Field(default=None, max_length=2000)

    _blank = field_validator(
        "default_notes", "default_terms", "bank_name", "bank_account_name", "bank_account_number",
        "bank_branch", "bank_swift", "mpesa_paybill", "mpesa_account", "mpesa_till", "mpesa_phone",
        "mpesa_name", "other_payment_instructions", mode="before",
    )(_blank_to_none)

    @field_validator("default_currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        v = v.upper()
        if v not in CURRENCIES:
            raise ValueError("Unsupported currency")
        return v

    @field_validator("invoice_number_format", "quote_number_format")
    @classmethod
    def _fmt(cls, v: str) -> str:
        if "{SEQ" not in v:
            raise ValueError("Number format must include {SEQ} or {SEQ:n}")
        if not _NUMBER_FORMAT.match(v):
            raise ValueError("Number format contains unsupported characters")
        return v

    @field_validator("mpesa_paybill", "mpesa_till")
    @classmethod
    def _digits(cls, v):
        if v is not None and not v.isdigit():
            raise ValueError("Must contain digits only")
        return v

    @field_validator("mpesa_phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v)


class BusinessIn(BaseModel):
    profile: BusinessProfileIn
    settings: BusinessSettingsIn


class BusinessProfileOut(ORMModel):
    id: int
    name: str
    email: str | None
    phone: str | None
    address: str | None
    website: str | None
    registration_number: str | None
    kra_pin: str | None
    vat_registered: bool
    vat_number: str | None


class BusinessSettingsOut(ORMModel):
    default_currency: str
    default_tax_rate_id: int | None
    pricing_mode: str
    payment_terms_days: int
    quote_validity_days: int
    invoice_number_format: str
    next_invoice_seq: int
    quote_number_format: str
    next_quote_seq: int
    default_template: str
    date_format: str
    show_signature: bool
    accent_color: str
    default_notes: str | None
    default_terms: str | None
    bank_name: str | None
    bank_account_name: str | None
    bank_account_number: str | None
    bank_branch: str | None
    bank_swift: str | None
    mpesa_type: str
    mpesa_paybill: str | None
    mpesa_account: str | None
    mpesa_till: str | None
    mpesa_phone: str | None
    mpesa_name: str | None
    other_payment_instructions: str | None


class BusinessOut(BaseModel):
    profile: BusinessProfileOut
    settings: BusinessSettingsOut
    tax_rates: list[TaxRateOut]
    logo_data_url: str | None
    payment_instructions_preview: str
    invoice_number_preview: str
    quote_number_preview: str
