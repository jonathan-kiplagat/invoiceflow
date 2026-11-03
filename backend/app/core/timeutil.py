from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().timezone)


def utcnow() -> datetime:
    return datetime.now(UTC)


def today_local() -> date:
    """Today's date in the business timezone (Africa/Nairobi by default)."""
    return datetime.now(tz()).date()
