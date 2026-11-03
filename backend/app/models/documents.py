"""Invoices and quotations.

Both share the same header and line-item structure (via mixins) but live in separate
tables, so each has its own numbering, statuses and referential rules.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, declared_attr, mapped_column, relationship

from app.database.types import Money, Quantity, Rate
from app.models.base import Base, TimestampMixin


class DocumentMixin(TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    # Client-generated UUID: makes creation idempotent so offline sync retries never duplicate.
    client_uuid: Mapped[str] = mapped_column(String(36), nullable=False)
    # Optimistic-concurrency version, incremented on every server-side change.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_client_revision: Mapped[str | None] = mapped_column(String(36))

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="KES")
    pricing_mode: Mapped[str] = mapped_column(String(10), nullable=False, default="exclusive")
    template: Mapped[str] = mapped_column(String(32), nullable=False, default="modern")

    customer_snapshot: Mapped[dict | None] = mapped_column(JSON)
    business_snapshot: Mapped[dict | None] = mapped_column(JSON)

    notes: Mapped[str | None] = mapped_column(Text)
    terms: Mapped[str | None] = mapped_column(Text)
    payment_instructions: Mapped[str | None] = mapped_column(Text)

    shipping: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    subtotal: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    discount_total: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    tax_total: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @declared_attr
    def business_id(cls) -> Mapped[int]:
        return mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False)

    @declared_attr
    def customer_id(cls) -> Mapped[int | None]:
        return mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"))


class ItemMixin:
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Quantity, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    discount_type: Mapped[str] = mapped_column(String(10), nullable=False, default="percent")
    discount_value: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    tax_name: Mapped[str | None] = mapped_column(String(60))
    tax_rate: Mapped[Decimal] = mapped_column(Rate, nullable=False, default=Decimal("0"))

    line_subtotal: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    line_discount: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    line_tax: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    line_total: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))

    @declared_attr
    def tax_rate_id(cls) -> Mapped[int | None]:
        return mapped_column(ForeignKey("tax_rates.id", ondelete="SET NULL"))


class Invoice(DocumentMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_invoices_business_number"),
        UniqueConstraint("business_id", "client_uuid", name="uq_invoices_business_client_uuid"),
        Index("ix_invoices_business_status", "business_id", "status"),
        Index("ix_invoices_business_issue_date", "business_id", "issue_date"),
        Index("ix_invoices_business_due_date", "business_id", "due_date"),
        Index("ix_invoices_business_customer", "business_id", "customer_id"),
    )

    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    balance_due: Mapped[Decimal] = mapped_column(Money, nullable=False, default=Decimal("0"))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    quotation_id: Mapped[int | None] = mapped_column(ForeignKey("quotations.id", ondelete="SET NULL"))

    items: Mapped[list[InvoiceItem]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", order_by="InvoiceItem.position"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="invoice", order_by="Payment.payment_date"
    )
    customer = relationship("Customer", lazy="joined")


class InvoiceItem(ItemMixin, Base):
    __tablename__ = "invoice_items"

    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), index=True, nullable=False
    )
    invoice: Mapped[Invoice] = relationship(back_populates="items")


class Quotation(DocumentMixin, Base):
    __tablename__ = "quotations"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_quotations_business_number"),
        UniqueConstraint("business_id", "client_uuid", name="uq_quotations_business_client_uuid"),
        Index("ix_quotations_business_status", "business_id", "status"),
        Index("ix_quotations_business_issue_date", "business_id", "issue_date"),
    )

    valid_until: Mapped[date] = mapped_column(Date, nullable=False)
    converted_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoices.id", ondelete="SET NULL", use_alter=True)
    )
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list[QuotationItem]] = relationship(
        back_populates="quotation", cascade="all, delete-orphan", order_by="QuotationItem.position"
    )
    customer = relationship("Customer", lazy="joined")


class QuotationItem(ItemMixin, Base):
    __tablename__ = "quotation_items"

    quotation_id: Mapped[int] = mapped_column(
        ForeignKey("quotations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    quotation: Mapped[Quotation] = relationship(back_populates="items")


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        Index("ix_payments_business_date", "business_id", "payment_date"),
        UniqueConstraint("business_id", "client_uuid", name="uq_payments_business_client_uuid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    client_uuid: Mapped[str | None] = mapped_column(String(36))
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    method: Mapped[str] = mapped_column(String(20), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

    invoice: Mapped[Invoice] = relationship(back_populates="payments")


class EmailLog(Base):
    """Record of invoice emails actually handed to the SMTP server (or that failed)."""

    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id", ondelete="SET NULL"), index=True)
    to_email: Mapped[str] = mapped_column(String(254), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)  # accepted | failed
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
