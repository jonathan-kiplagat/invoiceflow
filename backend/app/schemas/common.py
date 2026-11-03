from decimal import Decimal
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, StringConstraints

# Decimals are serialised as strings so no precision is lost in JSON.
DecimalStr = Annotated[Decimal, PlainSerializer(lambda v: format(v, "f"), return_type=str, when_used="json")]

MoneyIn = Annotated[Decimal, Field(ge=0, le=Decimal("999999999999.99"), max_digits=14, decimal_places=2)]
QuantityIn = Annotated[Decimal, Field(gt=0, le=Decimal("99999999.999"), max_digits=11, decimal_places=3)]
RateIn = Annotated[Decimal, Field(ge=0, le=100, max_digits=6, decimal_places=3)]

Str120 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Str160 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]
Text5k = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
