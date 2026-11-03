"""Exact decimal column types.

PostgreSQL stores money in NUMERIC columns. SQLite has no exact decimal type (it would
coerce NUMERIC to floating point), so on SQLite the same columns are stored as TEXT and
converted to/from Decimal at the boundary. Application code only ever sees Decimal.
"""

from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import DateTime, Numeric, String
from sqlalchemy.types import TypeDecorator


class _ExactDecimal(TypeDecorator):
    impl = Numeric
    cache_ok = True
    places = 2
    precision = 18

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":
            return dialect.type_descriptor(String(40))
        return dialect.type_descriptor(Numeric(self.precision, self.places, asdecimal=True))

    def _quant(self, value):
        return Decimal(value).quantize(Decimal(1).scaleb(-self.places), rounding=ROUND_HALF_UP)

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        value = self._quant(value)
        return str(value) if dialect.name == "sqlite" else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return self._quant(value)


class Money(_ExactDecimal):
    """Monetary amount with 2 decimal places."""

    cache_ok = True
    places = 2
    precision = 18


class Quantity(_ExactDecimal):
    """Item quantity with up to 3 decimal places (e.g. 2.5 hours, 1.125 kg)."""

    cache_ok = True
    places = 3
    precision = 18


class Rate(_ExactDecimal):
    """Percentage rate with up to 3 decimal places (e.g. 16.000)."""

    cache_ok = True
    places = 3
    precision = 9


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC timestamps on every database.

    SQLite does not store timezone offsets, so values come back naive; this re-attaches UTC
    so the API always emits unambiguous ISO-8601 times (e.g. ...+00:00) that browsers convert
    correctly to Nairobi time.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value
