from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.money import CURRENCIES
from app.schemas.common import DecimalStr, MoneyIn, ORMModel, QuantityIn, RateIn
from app.schemas.customer import CustomerIn

PaymentMethod = Literal["cash", "bank_transfer", "mpesa", "card", "cheque", "other"]
TemplateKey = Literal["modern", "corporate", "elegant", "classic"]


class ItemIn(BaseModel):
    description: str = Field(min_length=1, max_length=4000)
    quantity: QuantityIn
    unit_price: MoneyIn
    discount_type: Literal["percent", "amount"] = "percent"
    discount_value: MoneyIn = Decimal("0")
    tax_rate_id: int | None = None
    tax_name: str | None = Field(default=None, max_length=60)
    tax_rate: RateIn = Decimal("0")

    @field_validator("description")
    @classmethod
    def _desc(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Item description is required")
        return v

    @model_validator(mode="after")
    def _discount(self):
        if self.discount_type == "percent" and self.discount_value > 100:
            raise ValueError("Percentage discount cannot exceed 100")
        return self


class DocumentBaseIn(BaseModel):
    client_uuid: str | None = Field(default=None, min_length=8, max_length=36)
    client_revision: str | None = Field(default=None, max_length=36)
    customer_id: int | None = None
    # Lets an offline-created draft carry a brand-new customer; created in the same transaction.
    new_customer: CustomerIn | None = None
    issue_date: date
    currency: str = "KES"
    pricing_mode: Literal["exclusive", "inclusive"] = "exclusive"
    template: TemplateKey = "modern"
    notes: str | None = Field(default=None, max_length=2000)
    terms: str | None = Field(default=None, max_length=4000)
    payment_instructions: str | None = Field(default=None, max_length=2000)
    shipping: MoneyIn = Decimal("0")
    items: list[ItemIn] = Field(default_factory=list, max_length=500)

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        v = v.upper()
        if v not in CURRENCIES:
            raise ValueError("Unsupported currency")
        return v


class InvoiceIn(DocumentBaseIn):
    due_date: date
    status: Literal["draft", "sent"] = "draft"

    @model_validator(mode="after")
    def _dates(self):
        if self.due_date < self.issue_date:
            raise ValueError("Due date cannot be before the issue date")
        return self


class InvoiceUpdateIn(InvoiceIn):
    version: int = Field(ge=1)
    # Set only when the user explicitly chose to overwrite a newer server version.
    force_overwrite: bool = False


class QuotationIn(DocumentBaseIn):
    valid_until: date
    status: Literal["draft", "sent"] = "draft"

    @model_validator(mode="after")
    def _dates(self):
        if self.valid_until < self.issue_date:
            raise ValueError("Valid-until date cannot be before the issue date")
        return self


class QuotationUpdateIn(QuotationIn):
    version: int = Field(ge=1)
    force_overwrite: bool = False


class ItemOut(ORMModel):
    id: int
    position: int
    description: str
    quantity: DecimalStr
    unit_price: DecimalStr
    discount_type: str
    discount_value: DecimalStr
    tax_rate_id: int | None
    tax_name: str | None
    tax_rate: DecimalStr
    line_subtotal: DecimalStr
    line_discount: DecimalStr
    line_tax: DecimalStr
    line_total: DecimalStr


class PaymentIn(BaseModel):
    client_uuid: str | None = Field(default=None, min_length=8, max_length=36)
    payment_date: date
    amount: MoneyIn
    method: PaymentMethod
    reference: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Amount must be greater than zero")
        return v


class PaymentOut(ORMModel):
    id: int
    invoice_id: int
    payment_date: date
    amount: DecimalStr
    method: str
    reference: str | None
    notes: str | None
    created_at: datetime


class PaymentListOut(PaymentOut):
    invoice_number: str
    customer_name: str | None
    currency: str


class DocumentSummaryOut(ORMModel):
    id: int
    number: str
    client_uuid: str
    version: int
    status: str
    customer_id: int | None
    customer_name: str | None = None
    issue_date: date
    currency: str
    total: DecimalStr
    updated_at: datetime


class InvoiceSummaryOut(DocumentSummaryOut):
    due_date: date
    amount_paid: DecimalStr
    balance_due: DecimalStr


class QuotationSummaryOut(DocumentSummaryOut):
    valid_until: date
    converted_invoice_id: int | None


class DocumentOut(ORMModel):
    id: int
    number: str
    client_uuid: str
    version: int
    status: str
    customer_id: int | None
    customer_snapshot: dict | None
    business_snapshot: dict | None
    issue_date: date
    currency: str
    pricing_mode: str
    template: str
    notes: str | None
    terms: str | None
    payment_instructions: str | None
    shipping: DecimalStr
    subtotal: DecimalStr
    discount_total: DecimalStr
    tax_total: DecimalStr
    total: DecimalStr
    sent_at: datetime | None
    created_at: datetime
    updated_at: datetime
    items: list[ItemOut]


class InvoiceOut(DocumentOut):
    due_date: date
    amount_paid: DecimalStr
    balance_due: DecimalStr
    cancelled_at: datetime | None
    share_token: str | None
    quotation_id: int | None
    payments: list[PaymentOut]


class QuotationOut(DocumentOut):
    valid_until: date
    converted_invoice_id: int | None
    converted_at: datetime | None


class ShareInfoOut(BaseModel):
    share_url: str | None
    pdf_url: str | None
    whatsapp_phone: str | None
    whatsapp_message: str
    whatsapp_url: str
    email_to: str | None
    email_subject: str
    email_body: str
    mailto_url: str
    email_integration_enabled: bool


class EmailSendIn(BaseModel):
    to: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=10000)
    attach_pdf: bool = True


class EmailSendOut(BaseModel):
    status: Literal["accepted", "failed"]
    detail: str
