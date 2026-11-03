from app.models.base import Base
from app.models.business import Business, BusinessSettings, InvoiceTemplate, TaxRate
from app.models.customer import Customer
from app.models.documents import (
    EmailLog,
    Invoice,
    InvoiceItem,
    Payment,
    Quotation,
    QuotationItem,
)
from app.models.user import RefreshToken, User

__all__ = [
    "Base",
    "Business",
    "BusinessSettings",
    "Customer",
    "EmailLog",
    "Invoice",
    "InvoiceItem",
    "InvoiceTemplate",
    "Payment",
    "Quotation",
    "QuotationItem",
    "RefreshToken",
    "TaxRate",
    "User",
]

TEMPLATE_SEED = [
    {"key": "modern", "name": "Modern Minimal", "description": "Airy, light layout with a single accent rule.", "sort_order": 1},
    {"key": "corporate", "name": "Corporate Professional", "description": "Bold branded header band and structured tables.", "sort_order": 2},
    {"key": "elegant", "name": "Elegant Business", "description": "Serif typography, centred masthead and refined rules.", "sort_order": 3},
    {"key": "classic", "name": "Classic Standard", "description": "Traditional bordered layout that prints cleanly anywhere.", "sort_order": 4},
]
