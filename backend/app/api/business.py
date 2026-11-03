from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentBusiness
from app.core.config import get_settings
from app.core.money import CURRENCIES
from app.models import Business, InvoiceTemplate, TaxRate
from app.schemas.business import BusinessIn, BusinessOut, TaxRateIn, TaxRateOut, TemplateOut
from app.services.business import logo_data_url, number_previews, payment_instructions_text, set_logo

router = APIRouter(tags=["business"])


def business_out(b: Business) -> BusinessOut:
    inv_prev, quo_prev = number_previews(b.settings)
    return BusinessOut(
        profile=b,  # type: ignore[arg-type]
        settings=b.settings,  # type: ignore[arg-type]
        tax_rates=b.tax_rates,  # type: ignore[arg-type]
        logo_data_url=logo_data_url(b),
        payment_instructions_preview=payment_instructions_text(b.settings),
        invoice_number_preview=inv_prev,
        quote_number_preview=quo_prev,
    )


@router.get("/business", response_model=BusinessOut)
def get_business(business: CurrentBusiness) -> BusinessOut:
    return business_out(business)


@router.put("/business", response_model=BusinessOut)
def update_business(data: BusinessIn, business: CurrentBusiness, db: DB) -> BusinessOut:
    if data.settings.default_tax_rate_id is not None and data.settings.default_tax_rate_id not in {
        t.id for t in business.tax_rates
    }:
        raise HTTPException(422, "Default tax rate not found")
    for k, v in data.profile.model_dump().items():
        setattr(business, k, v)
    for k, v in data.settings.model_dump().items():
        setattr(business.settings, k, v)
    db.commit()
    db.refresh(business)
    return business_out(business)


@router.post("/business/logo", response_model=BusinessOut)
async def upload_logo(business: CurrentBusiness, db: DB, file: UploadFile = File(...)) -> BusinessOut:
    limit = get_settings().max_logo_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "Logo must be 2 MB or smaller")
    set_logo(business, data)
    db.commit()
    return business_out(business)


@router.delete("/business/logo", response_model=BusinessOut)
def delete_logo(business: CurrentBusiness, db: DB) -> BusinessOut:
    business.logo = None
    business.logo_mime = None
    db.commit()
    return business_out(business)


@router.get("/tax-rates", response_model=list[TaxRateOut])
def list_tax_rates(business: CurrentBusiness) -> list[TaxRate]:
    return business.tax_rates


@router.post("/tax-rates", response_model=TaxRateOut, status_code=201)
def create_tax_rate(data: TaxRateIn, business: CurrentBusiness, db: DB) -> TaxRate:
    rate = TaxRate(business_id=business.id, name=data.name.strip(), rate=data.rate, is_active=data.is_active)
    db.add(rate)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A tax rate with this name already exists") from None
    db.refresh(rate)
    return rate


def _owned_rate(db, business, rate_id: int) -> TaxRate:
    rate = db.get(TaxRate, rate_id)
    if rate is None or rate.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tax rate not found")
    return rate


@router.put("/tax-rates/{rate_id}", response_model=TaxRateOut)
def update_tax_rate(rate_id: int, data: TaxRateIn, business: CurrentBusiness, db: DB) -> TaxRate:
    rate = _owned_rate(db, business, rate_id)
    rate.name, rate.rate, rate.is_active = data.name.strip(), data.rate, data.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "A tax rate with this name already exists") from None
    db.refresh(rate)
    return rate


@router.delete("/tax-rates/{rate_id}", status_code=204)
def delete_tax_rate(rate_id: int, business: CurrentBusiness, db: DB) -> None:
    rate = _owned_rate(db, business, rate_id)
    if business.settings.default_tax_rate_id == rate.id:
        business.settings.default_tax_rate_id = None
    # Existing documents keep a copy of the rate's name and percentage, so history is unaffected.
    db.delete(rate)
    db.commit()


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(db: DB) -> list[InvoiceTemplate]:
    return list(db.execute(select(InvoiceTemplate).order_by(InvoiceTemplate.sort_order)).scalars())


@router.get("/meta")
def meta() -> dict:
    s = get_settings()
    return {
        "app_name": s.app_name,
        "timezone": s.timezone,
        "email_integration_enabled": s.email_enabled,
        "currencies": [{"code": k, **v} for k, v in CURRENCIES.items()],
        "payment_methods": [
            {"key": "mpesa", "label": "M-Pesa"},
            {"key": "bank_transfer", "label": "Bank transfer"},
            {"key": "cash", "label": "Cash"},
            {"key": "card", "label": "Card"},
            {"key": "cheque", "label": "Cheque"},
            {"key": "other", "label": "Other"},
        ],
    }
