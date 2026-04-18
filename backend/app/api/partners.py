"""Expense partners API — send/accept/reject partner requests."""

from __future__ import annotations

import secrets
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.partner import PARTNER_STATUS_ACCEPTED, PARTNER_STATUS_PENDING, PARTNER_STATUS_REJECTED, PartnerRequest
from app.models.user import User
from app.services.email import send_partner_request_email

router = APIRouter()
logger = structlog.get_logger(__name__)


def _serialize_request(req: PartnerRequest, *, viewer_id: uuid.UUID) -> dict:
    is_sender = req.requester_id == viewer_id
    return {
        "id": str(req.id),
        "direction": "sent" if is_sender else "received",
        "status": req.status,
        "email": req.recipient_email if is_sender else (req.requester.email if req.requester else ""),
        "name": None if is_sender else (req.requester.name if req.requester else None),
        "avatar_url": None if is_sender else (req.requester.avatar_url if req.requester else None),
        "created_at": req.created_at.isoformat(),
    }


def _serialize_partner(partner: User) -> dict:
    return {
        "id": str(partner.id),
        "email": partner.email,
        "name": partner.name,
        "avatar_url": partner.avatar_url,
    }


class SendPartnerRequestBody(BaseModel):
    email: str


@router.get("")
async def list_partners(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return accepted partners + pending requests (sent and received)."""
    result = await db.execute(
        select(PartnerRequest)
        .where(
            or_(PartnerRequest.requester_id == current_user.id, PartnerRequest.recipient_id == current_user.id)
        )
        .order_by(PartnerRequest.created_at.desc())
    )
    requests = result.scalars().all()

    accepted_partner_ids: set[uuid.UUID] = set()
    for req in requests:
        if req.status == PARTNER_STATUS_ACCEPTED:
            other_id = req.recipient_id if req.requester_id == current_user.id else req.requester_id
            if other_id:
                accepted_partner_ids.add(other_id)

    partners: list[dict] = []
    if accepted_partner_ids:
        partner_result = await db.execute(select(User).where(User.id.in_(accepted_partner_ids)))
        partners = [_serialize_partner(u) for u in partner_result.scalars().all()]

    pending = [_serialize_request(r, viewer_id=current_user.id) for r in requests if r.status == PARTNER_STATUS_PENDING]
    return {"partners": partners, "pending_requests": pending}


@router.post("/request")
async def send_partner_request(
    body: SendPartnerRequestBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a partner request to another user by email."""
    target_email = body.email.strip().lower()
    if target_email == current_user.email.lower():
        raise HTTPException(status_code=400, detail="You cannot add yourself as a partner")

    existing = await db.execute(
        select(PartnerRequest).where(
            PartnerRequest.requester_id == current_user.id,
            func.lower(PartnerRequest.recipient_email) == target_email,
            PartnerRequest.status == PARTNER_STATUS_PENDING,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A pending request to this email already exists")

    recipient_result = await db.execute(select(User).where(func.lower(User.email) == target_email))
    recipient = recipient_result.scalar_one_or_none()

    if not recipient:
        raise HTTPException(status_code=404, detail="No SpendHound account found with that email. Only existing users can be added as partners.")

    if recipient:
        already_partners = await db.execute(
            select(PartnerRequest).where(
                or_(
                    (PartnerRequest.requester_id == current_user.id) & (PartnerRequest.recipient_id == recipient.id),
                    (PartnerRequest.requester_id == recipient.id) & (PartnerRequest.recipient_id == current_user.id),
                ),
                PartnerRequest.status == PARTNER_STATUS_ACCEPTED,
            )
        )
        if already_partners.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="You are already partners with this user")

    token = secrets.token_urlsafe(32)
    req = PartnerRequest(
        requester_id=current_user.id,
        recipient_email=target_email,
        recipient_id=recipient.id if recipient else None,
        status=PARTNER_STATUS_PENDING,
        token=token,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    accept_url = f"{settings.app_url}/account?partner_action=accept&token={token}"
    reject_url = f"{settings.app_url}/account?partner_action=reject&token={token}"
    await send_partner_request_email(
        requester_name=current_user.name,
        requester_email=current_user.email,
        recipient_email=target_email,
        accept_url=accept_url,
        reject_url=reject_url,
    )

    return {
        "id": str(req.id),
        "status": req.status,
        "recipient_email": target_email,
        "recipient_exists": recipient is not None,
    }


@router.post("/requests/{request_id}/accept")
async def accept_partner_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(PartnerRequest).where(PartnerRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.recipient_id != current_user.id and func.lower(req.recipient_email) != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Not your request to accept")
    if req.status != PARTNER_STATUS_PENDING:
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")

    req.status = PARTNER_STATUS_ACCEPTED
    req.recipient_id = current_user.id
    await db.commit()
    return {"status": PARTNER_STATUS_ACCEPTED}


@router.post("/requests/{request_id}/reject")
async def reject_partner_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(PartnerRequest).where(PartnerRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.recipient_id != current_user.id and req.recipient_email.lower() != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Not your request to reject")
    if req.status != PARTNER_STATUS_PENDING:
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")

    req.status = PARTNER_STATUS_REJECTED
    await db.commit()
    return {"status": PARTNER_STATUS_REJECTED}


@router.delete("/requests/{request_id}")
async def cancel_partner_request(
    request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cancel a sent partner request (only the requester can cancel)."""
    result = await db.execute(select(PartnerRequest).where(PartnerRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the sender can cancel this request")
    await db.delete(req)
    await db.commit()
    return {"deleted": True}


@router.get("/token/{token}")
async def handle_partner_token(
    token: str,
    action: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Accept or reject a partner request via email token link."""
    result = await db.execute(select(PartnerRequest).where(PartnerRequest.token == token))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Invalid or expired token")
    if req.status != PARTNER_STATUS_PENDING:
        raise HTTPException(status_code=409, detail=f"Request is already {req.status}")

    if action == "accept":
        req.status = PARTNER_STATUS_ACCEPTED
        req.recipient_id = current_user.id
    elif action == "reject":
        req.status = PARTNER_STATUS_REJECTED
    else:
        raise HTTPException(status_code=400, detail="action must be 'accept' or 'reject'")

    await db.commit()
    return {"status": req.status}
