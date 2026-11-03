from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.types import Rate
from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class InvoiceTemplate(Base):
    """Catalogue of available PDF templates (the layouts themselves live in code)."""

    __tablename__ = "invoice_templates"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Business(TimestampMixin, Base):
    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(String(254))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(255))
    registration_number: Mapped[str | None] = mapped_column(String(64))
    kra_pin: Mapped[str | None] = mapped_column(String(20))
    vat_registered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    vat_number: Mapped[str | None] = mapped_column(String(64))

    logo: Mapped[bytes | None] = mapped_column(LargeBinary)
    logo_mime: Mapped[str | None] = mapped_column(String(32))
    logo_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    owner: Mapped[User] = relationship(back_populates="business")
    settings: Mapped[BusinessSettings] = relationship(
        back_populates="business", uselist=False, cascade="all, delete-orphan"
    )
    tax_rates: Mapped[list[TaxRate]] = relationship(
        back_populates="business", cascade="all, delete-orphan", order_by="TaxRate.id"
    )


class BusinessSettings(TimestampMixin, Base):
    __tablename__ = "business_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    default_currency: Mapped[str] = mapped_column(String(3), default="KES", nullable=False)
    default_tax_rate_id: Mapped[int | None] = mapped_column(
        ForeignKey("tax_rates.id", ondelete="SET NULL", use_alter=True)
    )
    pricing_mode: Mapped[str] = mapped_column(String(10), default="exclusive", nullable=False)
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    quote_validity_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    invoice_number_format: Mapped[str] = mapped_column(String(40), default="INV-{YYYY}-{SEQ:4}", nullable=False)
    next_invoice_seq: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    quote_number_format: Mapped[str] = mapped_column(String(40), default="QUO-{YYYY}-{SEQ:4}", nullable=False)
    next_quote_seq: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    default_template: Mapped[str] = mapped_column(
        ForeignKey("invoice_templates.key", ondelete="RESTRICT"), default="modern", nullable=False
    )
    date_format: Mapped[str] = mapped_column(String(16), default="DD MMM YYYY", nullable=False)
    show_signature: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    accent_color: Mapped[str] = mapped_column(String(7), default="#0F766E", nullable=False)

    default_notes: Mapped[str | None] = mapped_column(Text)
    default_terms: Mapped[str | None] = mapped_column(Text)

    bank_name: Mapped[str | None] = mapped_column(String(120))
    bank_account_name: Mapped[str | None] = mapped_column(String(160))
    bank_account_number: Mapped[str | None] = mapped_column(String(64))
    bank_branch: Mapped[str | None] = mapped_column(String(120))
    bank_swift: Mapped[str | None] = mapped_column(String(20))

    mpesa_type: Mapped[str] = mapped_column(String(10), default="none", nullable=False)  # none|paybill|till|phone
    mpesa_paybill: Mapped[str | None] = mapped_column(String(10))
    mpesa_account: Mapped[str | None] = mapped_column(String(40))
    mpesa_till: Mapped[str | None] = mapped_column(String(10))
    mpesa_phone: Mapped[str | None] = mapped_column(String(20))
    mpesa_name: Mapped[str | None] = mapped_column(String(120))

    other_payment_instructions: Mapped[str | None] = mapped_column(Text)

    business: Mapped[Business] = relationship(back_populates="settings")


class TaxRate(TimestampMixin, Base):
    """User-configurable tax rates. Nothing here is hardcoded; defaults are editable suggestions."""

    __tablename__ = "tax_rates"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_tax_rates_business_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_id: Mapped[int] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Rate, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    business: Mapped[Business] = relationship(back_populates="tax_rates")
