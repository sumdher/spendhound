"""Authentication API router for SpendHound."""

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import create_action_token, is_admin_email
from app.config import settings
from app.database import get_db
from app.middleware.auth import create_access_token, get_any_user, get_current_user
from app.models.user import User
from app.schemas.user import UserReceiptPromptUpdateRequest, UserResponse, UserUpdateRequest
from app.services.email import send_approval_request_email
from app.services.spendhound import ensure_default_categories

router = APIRouter()
logger = structlog.get_logger(__name__)


class GoogleTokenRequest(BaseModel):
    id_token: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


def serialize_user_profile(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        avatar_url=user.avatar_url,
        status=user.status,
        automatic_monthly_reports=user.automatic_monthly_reports,
        receipt_prompt_override=user.receipt_prompt_override,
        created_at=user.created_at,
    )


@router.post("/google", response_model=AuthResponse)
async def google_auth(body: GoogleTokenRequest, db: AsyncSession = Depends(get_db)) -> AuthResponse:
    try:
        id_info = id_token.verify_oauth2_token(body.id_token, google_requests.Request(), settings.google_client_id)
    except ValueError as error:
        logger.warning("Invalid Google ID token", error=str(error))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Google token: {error}") from error

    email = id_info.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google token missing email claim")

    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(func.lower(User.email) == normalized_email))
    user = result.scalar_one_or_none()
    is_new_user = user is None

    if is_new_user:
        initial_status = "approved" if (is_admin_email(normalized_email) or not (settings.admin_email or "").strip()) else "pending"
        user = User(email=normalized_email, name=id_info.get("name"), avatar_url=id_info.get("picture"), status=initial_status)
        db.add(user)
        await db.flush()
        logger.info("New user created", email=email, status=initial_status)
    else:
        user.email = normalized_email
        user.name = id_info.get("name", user.name)
        user.avatar_url = id_info.get("picture", user.avatar_url)
        if is_admin_email(normalized_email):
            user.status = "approved"

    await ensure_default_categories(db, user.id)
    await db.commit()
    await db.refresh(user)

    if is_new_user and user.status == "pending":
        approve_token = create_action_token(user.id, "approve")
        reject_token = create_action_token(user.id, "reject")
        approve_url = f"{settings.app_url}/backend/api/admin/approve?token={approve_token}"
        reject_url = f"{settings.app_url}/backend/api/admin/reject?token={reject_token}"
        await send_approval_request_email(user_email=user.email, user_name=user.name, approve_url=approve_url, reject_url=reject_url)

    token = create_access_token(user.id, user.email)
    is_admin = is_admin_email(normalized_email)
    return AuthResponse(
        access_token=token,
        user={
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "status": user.status,
            "automatic_monthly_reports": user.automatic_monthly_reports,
            "is_admin": is_admin,
        },
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return serialize_user_profile(current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    current_user.automatic_monthly_reports = body.automatic_monthly_reports
    await db.commit()
    await db.refresh(current_user)
    return serialize_user_profile(current_user)


@router.patch("/me/receipt-prompt", response_model=UserResponse)
async def update_receipt_prompt(
    body: UserReceiptPromptUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    current_user.receipt_prompt_override = (body.receipt_prompt_override or "").strip() or None
    await db.commit()
    await db.refresh(current_user)
    return serialize_user_profile(current_user)


@router.get("/status")
async def get_status(current_user: User = Depends(get_any_user)) -> dict:
    return {"status": current_user.status, "is_admin": is_admin_email(current_user.email)}
