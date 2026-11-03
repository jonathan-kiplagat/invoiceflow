from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser
from app.core.config import get_settings
from app.core.ratelimit import auth_rate_limit
from app.core.security import (
    create_access_token,
    dummy_verify,
    hash_password,
    hash_token,
    new_refresh_token,
    verify_password,
)
from app.core.timeutil import utcnow
from app.models import RefreshToken, User
from app.schemas.auth import (
    ChangePasswordIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    TokenOut,
    UpdateMeIn,
    UserOut,
)
from app.services.business import create_business

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(db, user: User) -> TokenOut:
    access, expires_in = create_access_token(user.id)
    refresh = new_refresh_token()
    now = utcnow()
    db.add(
        RefreshToken(
            user_id=user.id, token_hash=hash_token(refresh), created_at=now,
            expires_at=now + timedelta(days=get_settings().refresh_token_days),
        )
    )
    db.commit()
    return TokenOut(access_token=access, refresh_token=refresh, expires_in=expires_in)


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(auth_rate_limit)])
def register(data: RegisterIn, db: DB) -> TokenOut:
    email = data.email.lower()
    if db.execute(select(User.id).where(User.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=email, full_name=data.full_name, password_hash=hash_password(data.password))
    user.business = create_business(data.business_name, email)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from None
    return _issue_tokens(db, user)


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_rate_limit)])
def login(data: LoginIn, db: DB) -> TokenOut:
    user = db.execute(select(User).where(User.email == data.email.lower())).scalar_one_or_none()
    if user is None:
        dummy_verify(data.password)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not verify_password(data.password, user.password_hash) or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    return _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(auth_rate_limit)])
def refresh(data: RefreshIn, db: DB) -> TokenOut:
    """Rotate a refresh token. A reused (already revoked) token revokes the whole session family."""
    record = db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(data.refresh_token))
    ).scalar_one_or_none()
    now = utcnow()
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")
    if record is None:
        raise invalid
    if record.revoked_at is not None:
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == record.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        db.commit()
        raise invalid
    expires = record.expires_at if record.expires_at.tzinfo else record.expires_at.replace(tzinfo=now.tzinfo)
    if expires < now:
        raise invalid
    user = db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise invalid
    record.revoked_at = now
    return _issue_tokens(db, user)


@router.post("/logout", status_code=204)
def logout(data: RefreshIn, db: DB) -> None:
    record = db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(data.refresh_token))
    ).scalar_one_or_none()
    if record and record.revoked_at is None:
        record.revoked_at = utcnow()
        db.commit()


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(data: UpdateMeIn, user: CurrentUser, db: DB) -> User:
    user.full_name = data.full_name.strip()
    db.commit()
    return user


@router.post("/change-password", response_model=TokenOut, dependencies=[Depends(auth_rate_limit)])
def change_password(data: ChangePasswordIn, user: CurrentUser, db: DB) -> TokenOut:
    """Change the password, sign out every other session, and return fresh tokens for this one."""
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(data.new_password)
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    db.commit()
    return _issue_tokens(db, user)
