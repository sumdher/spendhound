"""Authentication API router for SpendHound."""

import asyncio
import calendar
import uuid
from datetime import date, datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import create_action_token, is_admin_email
from app.config import settings
from app.database import get_db
from app.middleware.auth import create_access_token, get_any_user, get_current_user
from app.models.expense import Expense
from app.models.user import User
from app.schemas.user import LLMTestRequest, LLMTestResponse, UserLLMSettingsUpdateRequest, UserReceiptPromptUpdateRequest, UserResponse, UserUpdateRequest
from app.services.email import send_approval_request_email
from app.services.llm.encryption import encrypt_api_key
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
        is_admin=is_admin_email(user.email),
        automatic_monthly_reports=user.automatic_monthly_reports,
        receipt_prompt_override=user.receipt_prompt_override,
        llm_provider=user.llm_provider,
        llm_model=user.llm_model,
        llm_base_url=user.llm_base_url,
        has_llm_api_key=bool(user.llm_api_key),
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


@router.patch("/me/llm-settings", response_model=UserResponse)
async def update_llm_settings(
    body: UserLLMSettingsUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Update the current user's LLM provider settings and API key."""
    if body.llm_provider is not None:
        current_user.llm_provider = body.llm_provider or None
    if body.llm_model is not None:
        current_user.llm_model = body.llm_model or None
    if body.llm_base_url is not None:
        current_user.llm_base_url = body.llm_base_url or None

    if body.clear_api_key:
        current_user.llm_api_key = None
    elif body.llm_api_key:
        current_user.llm_api_key = encrypt_api_key(body.llm_api_key)

    current_user.updated_at = datetime.now(timezone.utc)
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return serialize_user_profile(current_user)


@router.post("/me/test-llm", response_model=LLMTestResponse)
async def test_llm_settings(
    body: LLMTestRequest,
    current_user: User = Depends(get_current_user),
) -> LLMTestResponse:
    """Test LLM settings without saving them. Used by the settings page."""
    try:
        from app.services.llm.base import LLMConfig, Message
        from app.services.llm.factory import get_llm_provider, resolve_user_llm_config

        # Build request-level config from form inputs
        # This does NOT save anything to the DB
        request_config = None
        if any([body.provider, body.model, body.api_key, body.base_url]):
            request_config = LLMConfig(
                provider=body.provider,
                model=body.model,
                api_key=body.api_key,
                base_url=body.base_url,
            )

        # Resolve final config using the same priority chain as real calls
        # This means: form values > user's stored DB key > admin .env fallback
        llm_config = resolve_user_llm_config(current_user, request_config)
        provider = get_llm_provider(llm_config)

        # Send a short test message
        messages = [
            Message(role="user", content="Say hi and bark like a dog! Keep it short (1 sentence).")
        ]
        response_text = await provider.complete(messages, llm_config)
        return LLMTestResponse(success=True, response=response_text)

    except Exception as e:
        return LLMTestResponse(success=False, error=str(e))


@router.get("/status")
async def get_status(current_user: User = Depends(get_any_user)) -> dict:
    return {"status": current_user.status, "is_admin": is_admin_email(current_user.email)}


@router.get("/me/stats")
async def get_me_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return current user's join date, expense count, and needs-review count."""
    expense_count_result, needs_review_result = await asyncio.gather(
        db.execute(select(func.count(Expense.id)).where(Expense.user_id == current_user.id)),
        db.execute(select(func.count(Expense.id)).where(Expense.user_id == current_user.id, Expense.needs_review.is_(True))),
    )
    return {
        "created_at": current_user.created_at.isoformat(),
        "expense_count": expense_count_result.scalar() or 0,
        "needs_review_count": needs_review_result.scalar() or 0,
    }


@router.get("/users/search")
async def search_users(
    q: str = Query("", description="Name or email substring to search"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Search approved users by name or email for partner invite autocomplete."""
    q = q.strip().lower()
    if len(q) < 1:
        return []
    from sqlalchemy import or_
    result = await db.execute(
        select(User).where(
            User.status == "approved",
            User.id != current_user.id,
            or_(
                func.lower(User.email).contains(q),
                func.lower(User.name).contains(q),
            ),
        ).limit(10)
    )
    users = result.scalars().all()
    return [{"id": str(u.id), "name": u.name, "email": u.email, "avatar_url": u.avatar_url} for u in users]


@router.delete("/me/data")
async def clear_my_data(
    period: str = Query("all", description="all | this_month | month"),
    month: str | None = Query(None, description="YYYY-MM format, used when period=month"),
    merchant: str | None = Query(None),
    transaction_type: str | None = Query(None),
    category_id: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete the current user's expense data with optional filters."""
    stmt = delete(Expense).where(Expense.user_id == current_user.id)

    if period == "this_month":
        today = date.today()
        first = date(today.year, today.month, 1)
        last = date(today.year, today.month, calendar.monthrange(today.year, today.month)[1])
        stmt = stmt.where(Expense.expense_date >= first).where(Expense.expense_date <= last)
    elif period == "month" and month:
        try:
            year, m = int(month[:4]), int(month[5:7])
            first = date(year, m, 1)
            last = date(year, m, calendar.monthrange(year, m)[1])
            stmt = stmt.where(Expense.expense_date >= first).where(Expense.expense_date <= last)
        except (ValueError, IndexError) as e:
            raise HTTPException(status_code=400, detail="Invalid month format, use YYYY-MM") from e

    if merchant:
        stmt = stmt.where(func.lower(Expense.merchant).contains(merchant.strip().lower()))
    if transaction_type and transaction_type in ("debit", "credit"):
        stmt = stmt.where(Expense.transaction_type == transaction_type)
    if category_id:
        try:
            stmt = stmt.where(Expense.category_id == uuid.UUID(category_id))
        except ValueError:
            pass

    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount}


@router.delete("/me")
async def delete_my_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Permanently delete the current user's account and all associated data."""
    await db.delete(current_user)
    await db.commit()
    return {"deleted": True}
