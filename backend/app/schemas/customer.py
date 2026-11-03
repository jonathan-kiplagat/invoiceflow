from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.phone import normalize_phone
from app.schemas.common import DecimalStr, ORMModel


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    company: str | None = Field(default=None, max_length=160)
    email: EmailStr | None = None
    phone: str | None = None
    billing_address: str | None = Field(default=None, max_length=1000)
    tax_id: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    is_archived: bool = False

    _blank = field_validator("company", "email", "phone", "billing_address", "tax_id", "notes", mode="before")(
        _blank_to_none
    )

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Customer name is required")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        return normalize_phone(v)


class CustomerOut(ORMModel):
    id: int
    name: str
    company: str | None
    email: str | None
    phone: str | None
    billing_address: str | None
    tax_id: str | None
    notes: str | None
    is_archived: bool
    created_at: datetime


class CustomerWithStats(CustomerOut):
    invoice_count: int = 0
    total_invoiced: DecimalStr
    total_paid: DecimalStr
    outstanding: DecimalStr
    currency: str
