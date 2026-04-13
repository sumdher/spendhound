"""Admin API router for user approval and account management."""

import uuid
from datetime import datetime, timedelta, timezone
from html import escape

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.expense import Expense
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)
_ACTION_TOKEN_EXPIRY_HOURS = 72


def is_admin_email(email: str | None) -> bool:
    configured_admin = (settings.admin_email or "").strip().lower()
    current_email = (email or "").strip().lower()
    return bool(configured_admin and current_email == configured_admin)


async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if not is_admin_email(current_user.email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def create_action_token(user_id: uuid.UUID, action: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=_ACTION_TOKEN_EXPIRY_HOURS)
    return jwt.encode({"sub": str(user_id), "action": action, "exp": expire}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _decode_action_token(token: str, expected_action: str) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as error:
        raise ValueError(f"Invalid or expired token: {error}") from error
    if payload.get("action") != expected_action:
        raise ValueError("Token action mismatch")
    user_id = payload.get("sub")
    if not user_id:
        raise ValueError("Token missing user ID")
    return user_id


def _html_page(title: str, message: str, color: str = "#3b82f6") -> HTMLResponse:
    safe_title = escape(title)
    safe_message = escape(message)
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1.0'>
  <title>SpendHound — {safe_title}</title>
</head>
<body style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#0f172a; color:#f8fafc;'>
  <div style='text-align:center; max-width:480px; padding:48px 40px; background:#1e293b; border-radius:16px; border:1px solid #334155; box-shadow:0 25px 50px rgba(0,0,0,0.5);'>
    <div style='font-size:56px; margin-bottom:20px;'>💸</div>
    <h1 style='color:{color}; margin:0 0 12px; font-size:24px;'>{safe_title}</h1>
    <p style='color:#94a3b8; margin:0; line-height:1.6;'>{safe_message}</p>
  </div>
</body>
</html>""")


@router.get("/approve", response_class=HTMLResponse, include_in_schema=False)
async def approve_user(token: str = Query(...), db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    try:
        user_id = uuid.UUID(_decode_action_token(token, "approve"))
    except (ValueError, AttributeError) as error:
        logger.warning("Invalid approve token", error=str(error))
        return _html_page("Invalid Link", "This link is invalid or has expired.", "#ef4444")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return _html_page("User Not Found", "No matching user found.", "#ef4444")
    if user.status == "approved":
        return _html_page("Already Approved", f"{user.email} already has access to SpendHound.", "#22c55e")
    user.status = "approved"
    await db.commit()
    return _html_page("Access Granted", f"{user.email} has been approved and can now sign in to SpendHound.", "#22c55e")


@router.get("/reject", response_class=HTMLResponse, include_in_schema=False)
async def reject_user(token: str = Query(...), db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    try:
        user_id = uuid.UUID(_decode_action_token(token, "reject"))
    except (ValueError, AttributeError) as error:
        logger.warning("Invalid reject token", error=str(error))
        return _html_page("Invalid Link", "This link is invalid or has expired.", "#ef4444")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        return _html_page("User Not Found", "No matching user found.", "#ef4444")
    if user.status == "rejected":
        return _html_page("Already Rejected", f"{user.email} has already been rejected.", "#f59e0b")
    user.status = "rejected"
    await db.commit()
    return _html_page("Access Denied", f"{user.email} has been rejected.", "#ef4444")


class AdminUserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    avatar_url: str | None
    status: str
    is_admin: bool
    expense_count: int
    created_at: str


class UpdateStatusRequest(BaseModel):
    status: str


@router.get("/panel/users", response_model=list[AdminUserResponse])
async def list_users(_admin: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)) -> list[AdminUserResponse]:
    counts_q = select(Expense.user_id, func.count(Expense.id).label("expense_count")).group_by(Expense.user_id).subquery()
    result = await db.execute(select(User, func.coalesce(counts_q.c.expense_count, 0).label("expense_count")).outerjoin(counts_q, User.id == counts_q.c.user_id).order_by(User.created_at.desc()))
    return [AdminUserResponse(id=str(user.id), email=user.email, name=user.name, avatar_url=user.avatar_url, status=user.status, is_admin=is_admin_email(user.email), expense_count=int(count), created_at=user.created_at.isoformat()) for user, count in result.all()]


@router.patch("/panel/users/{user_id}/status")
async def update_user_status(user_id: uuid.UUID, body: UpdateStatusRequest, admin: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)) -> dict:
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid status value. Expected 'approved' or 'rejected'.")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if is_admin_email(user.email):
        raise HTTPException(status_code=400, detail="Cannot change admin's own status")
    user.status = body.status
    await db.commit()
    logger.info("User status updated by admin", target=user.email, status=body.status, admin=admin.email)
    return {"id": str(user.id), "status": user.status}


@router.delete("/panel/users/{user_id}", status_code=204)
async def delete_user(user_id: uuid.UUID, admin: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if is_admin_email(user.email):
        raise HTTPException(status_code=400, detail="Cannot delete the admin account")
    logger.info("Deleting user and all related SpendHound data", target=user.email, admin=admin.email)
    await db.delete(user)
    await db.commit()
