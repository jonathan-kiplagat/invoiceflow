from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.database.session import get_db
from app.models import Business, Customer, Invoice, Payment, Quotation, User

bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
) -> User:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"}
    )
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    user_id = decode_access_token(creds.credentials)
    if user_id is None:
        raise unauthorized
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_business(db: DB, user: CurrentUser) -> Business:
    business = db.execute(select(Business).where(Business.user_id == user.id)).scalar_one_or_none()
    if business is None:  # pragma: no cover - created at registration
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business profile missing")
    return business


CurrentBusiness = Annotated[Business, Depends(get_business)]


def _owned(db: Session, model, obj_id: int, business_id: int, label: str):
    obj = db.get(model, obj_id)
    # Identical 404 for "does not exist" and "belongs to another account".
    if obj is None or obj.business_id != business_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label} not found")
    return obj


def owned_invoice(db: Session, business: Business, invoice_id: int) -> Invoice:
    return _owned(db, Invoice, invoice_id, business.id, "Invoice")


def owned_quotation(db: Session, business: Business, quotation_id: int) -> Quotation:
    return _owned(db, Quotation, quotation_id, business.id, "Quotation")


def owned_customer(db: Session, business: Business, customer_id: int) -> Customer:
    return _owned(db, Customer, customer_id, business.id, "Customer")


def owned_payment(db: Session, business: Business, payment_id: int) -> Payment:
    return _owned(db, Payment, payment_id, business.id, "Payment")
