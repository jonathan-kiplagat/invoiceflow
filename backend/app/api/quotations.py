from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentBusiness, owned_customer, owned_quotation
from app.api.responses import pdf_response
from app.core.timeutil import today_local, utcnow
from app.models import Customer, Quotation
from app.schemas.common import Page
from app.schemas.documents import InvoiceOut, QuotationIn, QuotationOut, QuotationSummaryOut, QuotationUpdateIn
from app.services import documents as docs
from app.services.pdf import render_document, view_from_model, view_from_payload
from app.services.status import refresh_overdue

router = APIRouter(prefix="/quotations", tags=["quotations"])

SORTS = {
    "issue_date": Quotation.issue_date, "valid_until": Quotation.valid_until, "number": Quotation.number,
    "total": cast(Quotation.total, Float), "status": Quotation.status,
}


def _summary(q: Quotation) -> dict:
    out = QuotationSummaryOut.model_validate(q).model_dump()
    out["customer_name"] = (q.customer_snapshot or {}).get("name")
    return out


@router.get("", response_model=Page[QuotationSummaryOut])
def list_quotations(
    business: CurrentBusiness, db: DB,
    q: str | None = Query(default=None, max_length=100), status: str | None = None,
    date_from: date | None = None, date_to: date | None = None,
    sort: Literal["issue_date", "valid_until", "number", "total", "status"] = "issue_date",
    order: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=200),
) -> Page[QuotationSummaryOut]:
    refresh_overdue(db, business.id)
    stmt = select(Quotation).where(Quotation.business_id == business.id)
    if status:
        stmt = stmt.where(Quotation.status.in_(status.split(",")))
    if date_from:
        stmt = stmt.where(Quotation.issue_date >= date_from)
    if date_to:
        stmt = stmt.where(Quotation.issue_date <= date_to)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.outerjoin(Customer, Customer.id == Quotation.customer_id).where(
            or_(func.lower(Quotation.number).like(like), func.lower(Customer.name).like(like), func.lower(Customer.company).like(like))
        )
    total = db.execute(select(func.count()).select_from(stmt.with_only_columns(Quotation.id).subquery())).scalar_one()
    col = SORTS[sort]
    rows = db.execute(
        stmt.order_by(col.desc() if order == "desc" else col.asc(), Quotation.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).scalars().unique().all()
    return Page(items=[_summary(r) for r in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=QuotationOut, status_code=201)
def create_quotation(data: QuotationIn, business: CurrentBusiness, db: DB, response: Response) -> Quotation:
    existing = docs.find_by_client_uuid(db, Quotation, business.id, data.client_uuid)
    if existing is not None:
        response.status_code = 200
        return existing
    try:
        q = docs.create_quotation(db, business, data)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = docs.find_by_client_uuid(db, Quotation, business.id, data.client_uuid)
        if existing is not None:
            response.status_code = 200
            return existing
        raise HTTPException(status.HTTP_409_CONFLICT, "Could not save the quotation, please retry") from None
    db.refresh(q)
    return q


@router.post("/preview.pdf")
def preview_quotation_pdf(data: QuotationIn, business: CurrentBusiness, db: DB) -> Response:
    if data.new_customer is not None:
        customer = docs.customer_snapshot(Customer(**data.new_customer.model_dump()))
    elif data.customer_id:
        customer = docs.customer_snapshot(owned_customer(db, business, data.customer_id))
    else:
        customer = None
    view = view_from_payload(data, business, "quotation", "PREVIEW", customer)
    return pdf_response(render_document(view, data.template, business.logo), "quotation-preview", download=False)


@router.get("/{quotation_id}", response_model=QuotationOut)
def get_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Quotation:
    return owned_quotation(db, business, quotation_id)


def _ensure_editable(q: Quotation) -> None:
    if q.status == "converted":
        raise HTTPException(status.HTTP_409_CONFLICT, "Converted quotations cannot be edited")


@router.put("/{quotation_id}", response_model=QuotationOut)
def update_quotation(quotation_id: int, data: QuotationUpdateIn, business: CurrentBusiness, db: DB) -> Quotation:
    q = owned_quotation(db, business, quotation_id)
    if not docs.check_version(q, data.version, data.client_revision, data.force_overwrite):
        return q
    _ensure_editable(q)
    docs.apply_payload(db, business, q, data)
    q.valid_until = data.valid_until
    if data.status == "sent" and q.sent_at is None:
        q.sent_at = utcnow()
        q.status = "sent"
    elif q.status == "expired" and data.valid_until >= today_local():
        q.status = "sent" if q.sent_at else "draft"
    q.version += 1
    db.commit()
    db.refresh(q)
    return q


@router.delete("/{quotation_id}", status_code=204)
def delete_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Response:
    q = owned_quotation(db, business, quotation_id)
    db.delete(q)
    db.commit()
    return Response(status_code=204)


@router.post("/{quotation_id}/duplicate", response_model=QuotationOut, status_code=201)
def duplicate_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Quotation:
    q = docs.duplicate_quotation(db, business, owned_quotation(db, business, quotation_id))
    db.commit()
    db.refresh(q)
    return q


def _set_status(db, business, quotation_id: int, new: str) -> Quotation:
    q = owned_quotation(db, business, quotation_id)
    _ensure_editable(q)
    if new == "sent" and q.sent_at is None:
        q.sent_at = utcnow()
    q.status = new
    q.version += 1
    db.commit()
    return q


@router.post("/{quotation_id}/send", response_model=QuotationOut)
def send_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Quotation:
    return _set_status(db, business, quotation_id, "sent")


@router.post("/{quotation_id}/accept", response_model=QuotationOut)
def accept_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Quotation:
    return _set_status(db, business, quotation_id, "accepted")


@router.post("/{quotation_id}/decline", response_model=QuotationOut)
def decline_quotation(quotation_id: int, business: CurrentBusiness, db: DB) -> Quotation:
    return _set_status(db, business, quotation_id, "declined")


@router.post("/{quotation_id}/convert", response_model=InvoiceOut, status_code=201)
def convert(quotation_id: int, business: CurrentBusiness, db: DB):
    q = owned_quotation(db, business, quotation_id)
    inv = docs.convert_quotation(db, business, q)  # invoice + quotation update in one transaction
    db.commit()
    db.refresh(inv)
    return inv


@router.get("/{quotation_id}/pdf")
def quotation_pdf(
    quotation_id: int, business: CurrentBusiness, db: DB,
    template: Literal["modern", "corporate", "elegant", "classic"] | None = None, download: bool = False,
) -> Response:
    q = owned_quotation(db, business, quotation_id)
    pdf = render_document(view_from_model(q, business), template or q.template, business.logo)
    return pdf_response(pdf, f"quotation-{q.number}", download)
