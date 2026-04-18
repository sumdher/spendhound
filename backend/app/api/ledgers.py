"""Ledgers API — CRUD, membership management, move/copy expenses."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.ledger import Ledger, LedgerAuditLog, LedgerMembership
from app.models.partner import PARTNER_STATUS_ACCEPTED, PartnerRequest
from app.models.user import User
from app.services.spendhound import serialize_expense

router = APIRouter()
logger = structlog.get_logger(__name__)


async def _get_accessible_ledger(db: AsyncSession, *, ledger_id: uuid.UUID, user_id: uuid.UUID) -> Ledger:
    """Return ledger if user is a member; raise 404/403 otherwise."""
    result = await db.execute(select(Ledger).where(Ledger.id == ledger_id))
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise HTTPException(status_code=404, detail="Ledger not found")
    membership = await db.execute(
        select(LedgerMembership).where(LedgerMembership.ledger_id == ledger_id, LedgerMembership.user_id == user_id)
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="You are not a member of this ledger")
    return ledger


async def _log_audit(db: AsyncSession, *, ledger_id: uuid.UUID, user_id: uuid.UUID, expense_id: uuid.UUID | None, action: str, changes: dict | None = None) -> None:
    log = LedgerAuditLog(
        ledger_id=ledger_id,
        expense_id=expense_id,
        user_id=user_id,
        action=action,
        changes=json.dumps(changes) if changes else None,
    )
    db.add(log)


def _serialize_ledger(ledger: Ledger, memberships: list[LedgerMembership] | None = None) -> dict:
    return {
        "id": str(ledger.id),
        "name": ledger.name,
        "type": ledger.type,
        "created_by": str(ledger.created_by),
        "created_at": ledger.created_at.isoformat(),
        "updated_at": ledger.updated_at.isoformat(),
        "members": [
            {
                "user_id": str(m.user_id),
                "role": m.role,
                "name": m.user.name if m.user else None,
                "email": m.user.email if m.user else None,
                "avatar_url": m.user.avatar_url if m.user else None,
            }
            for m in (memberships or ledger.memberships)
        ],
    }


class CreateLedgerBody(BaseModel):
    name: str
    type: str = "personal"
    member_user_ids: list[uuid.UUID] | None = None


class UpdateLedgerBody(BaseModel):
    name: str | None = None


class MoveExpenseBody(BaseModel):
    expense_ids: list[uuid.UUID]
    target_ledger_id: uuid.UUID | None = None


class CopyExpenseBody(BaseModel):
    expense_ids: list[uuid.UUID]
    target_ledger_ids: list[uuid.UUID | None]


@router.get("")
async def list_ledgers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return all ledgers the current user is a member of."""
    membership_result = await db.execute(
        select(LedgerMembership).where(LedgerMembership.user_id == current_user.id)
    )
    memberships = membership_result.scalars().all()
    ledger_ids = [m.ledger_id for m in memberships]

    if not ledger_ids:
        return {"ledgers": []}

    ledger_result = await db.execute(
        select(Ledger).where(Ledger.id.in_(ledger_ids)).order_by(Ledger.created_at.asc())
    )
    ledgers = ledger_result.scalars().all()

    all_membership_result = await db.execute(
        select(LedgerMembership).where(LedgerMembership.ledger_id.in_(ledger_ids))
    )
    all_memberships = all_membership_result.scalars().all()

    user_ids = list({m.user_id for m in all_memberships})
    user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in user_result.scalars().all()}
    for m in all_memberships:
        m.user = user_map.get(m.user_id)

    memberships_by_ledger: dict[uuid.UUID, list[LedgerMembership]] = {}
    for m in all_memberships:
        memberships_by_ledger.setdefault(m.ledger_id, []).append(m)

    return {
        "ledgers": [_serialize_ledger(l, memberships_by_ledger.get(l.id, [])) for l in ledgers]
    }


@router.post("")
async def create_ledger(
    body: CreateLedgerBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new personal or shared ledger."""
    if body.type not in ("personal", "shared"):
        raise HTTPException(status_code=422, detail="type must be 'personal' or 'shared'")

    if body.type == "shared" and body.member_user_ids:
        # Verify all member IDs are accepted partners
        partner_ids = set()
        for uid in body.member_user_ids:
            partner_check = await db.execute(
                select(PartnerRequest).where(
                    or_(
                        (PartnerRequest.requester_id == current_user.id) & (PartnerRequest.recipient_id == uid),
                        (PartnerRequest.requester_id == uid) & (PartnerRequest.recipient_id == current_user.id),
                    ),
                    PartnerRequest.status == PARTNER_STATUS_ACCEPTED,
                )
            )
            if not partner_check.scalar_one_or_none():
                raise HTTPException(status_code=400, detail=f"User {uid} is not your expense partner")
            partner_ids.add(uid)

    ledger = Ledger(name=body.name.strip(), type=body.type, created_by=current_user.id)
    db.add(ledger)
    await db.flush()

    owner_membership = LedgerMembership(ledger_id=ledger.id, user_id=current_user.id, role="owner")
    db.add(owner_membership)

    if body.type == "shared" and body.member_user_ids:
        for uid in body.member_user_ids:
            db.add(LedgerMembership(ledger_id=ledger.id, user_id=uid, role="member"))

    await db.commit()
    await db.refresh(ledger)

    membership_result = await db.execute(select(LedgerMembership).where(LedgerMembership.ledger_id == ledger.id))
    memberships = membership_result.scalars().all()
    user_ids = [m.user_id for m in memberships]
    user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in user_result.scalars().all()}
    for m in memberships:
        m.user = user_map.get(m.user_id)

    return _serialize_ledger(ledger, memberships)


@router.patch("/{ledger_id}")
async def update_ledger(
    ledger_id: uuid.UUID,
    body: UpdateLedgerBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ledger = await _get_accessible_ledger(db, ledger_id=ledger_id, user_id=current_user.id)
    if ledger.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the ledger owner can rename it")
    if body.name:
        ledger.name = body.name.strip()
        ledger.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_ledger(ledger)


@router.delete("/{ledger_id}")
async def delete_ledger(
    ledger_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    ledger = await _get_accessible_ledger(db, ledger_id=ledger_id, user_id=current_user.id)
    if ledger.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the ledger owner can delete it")
    await db.delete(ledger)
    await db.commit()
    return {"deleted": True}


class AddMembersBody(BaseModel):
    member_user_ids: list[uuid.UUID]


@router.post("/{ledger_id}/members")
async def add_ledger_members(
    ledger_id: uuid.UUID,
    body: AddMembersBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Add members to an existing shared ledger. Only members can add other partners."""
    ledger = await _get_accessible_ledger(db, ledger_id=ledger_id, user_id=current_user.id)
    if ledger.type != "shared":
        raise HTTPException(status_code=400, detail="Only shared ledgers support members")

    for uid in body.member_user_ids:
        partner_check = await db.execute(
            select(PartnerRequest).where(
                or_(
                    (PartnerRequest.requester_id == current_user.id) & (PartnerRequest.recipient_id == uid),
                    (PartnerRequest.requester_id == uid) & (PartnerRequest.recipient_id == current_user.id),
                ),
                PartnerRequest.status == PARTNER_STATUS_ACCEPTED,
            )
        )
        if not partner_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"User {uid} is not your expense partner")
        existing = await db.execute(
            select(LedgerMembership).where(LedgerMembership.ledger_id == ledger_id, LedgerMembership.user_id == uid)
        )
        if not existing.scalar_one_or_none():
            db.add(LedgerMembership(ledger_id=ledger_id, user_id=uid, role="member"))

    await db.commit()

    membership_result = await db.execute(select(LedgerMembership).where(LedgerMembership.ledger_id == ledger_id))
    memberships = membership_result.scalars().all()
    user_ids = [m.user_id for m in memberships]
    user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in user_result.scalars().all()}
    for m in memberships:
        m.user = user_map.get(m.user_id)
    return _serialize_ledger(ledger, memberships)


@router.delete("/{ledger_id}/leave")
async def leave_ledger(
    ledger_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Leave a shared ledger. The owner must delete instead."""
    ledger = await _get_accessible_ledger(db, ledger_id=ledger_id, user_id=current_user.id)
    if ledger.created_by == current_user.id:
        raise HTTPException(status_code=400, detail="You are the owner — delete the ledger instead of leaving")
    membership = await db.execute(
        select(LedgerMembership).where(LedgerMembership.ledger_id == ledger_id, LedgerMembership.user_id == current_user.id)
    )
    m = membership.scalar_one_or_none()
    if m:
        await db.delete(m)
    await db.commit()
    return {"left": True}


@router.get("/{ledger_id}/audit-log")
async def get_audit_log(
    ledger_id: uuid.UUID,
    limit: int = Query(default=50, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _get_accessible_ledger(db, ledger_id=ledger_id, user_id=current_user.id)
    result = await db.execute(
        select(LedgerAuditLog)
        .where(LedgerAuditLog.ledger_id == ledger_id)
        .order_by(LedgerAuditLog.created_at.desc())
        .limit(limit)
    )
    logs = result.scalars().all()

    user_ids = list({log.user_id for log in logs if log.user_id})
    user_map: dict[uuid.UUID, User] = {}
    if user_ids:
        ur = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u for u in ur.scalars().all()}

    return {
        "logs": [
            {
                "id": str(log.id),
                "action": log.action,
                "expense_id": str(log.expense_id) if log.expense_id else None,
                "user": {
                    "id": str(log.user_id),
                    "name": user_map[log.user_id].name if log.user_id in user_map else None,
                    "email": user_map[log.user_id].email if log.user_id in user_map else None,
                    "avatar_url": user_map[log.user_id].avatar_url if log.user_id in user_map else None,
                } if log.user_id else None,
                "changes": json.loads(log.changes) if log.changes else None,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]
    }


@router.post("/expenses/move")
async def move_expenses(
    body: MoveExpenseBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Move expenses to a different ledger (or back to General if target_ledger_id is null)."""
    if body.target_ledger_id:
        await _get_accessible_ledger(db, ledger_id=body.target_ledger_id, user_id=current_user.id)

    moved = 0
    for eid in body.expense_ids:
        result = await db.execute(
            select(Expense).where(Expense.id == eid)
        )
        expense = result.scalar_one_or_none()
        if not expense:
            continue

        # Access check: own expense OR member of current ledger
        has_access = expense.user_id == current_user.id
        if not has_access and expense.ledger_id:
            m = await db.execute(
                select(LedgerMembership).where(LedgerMembership.ledger_id == expense.ledger_id, LedgerMembership.user_id == current_user.id)
            )
            has_access = m.scalar_one_or_none() is not None

        if not has_access:
            continue

        old_ledger_id = expense.ledger_id
        expense.ledger_id = body.target_ledger_id
        if body.target_ledger_id:
            await _log_audit(db, ledger_id=body.target_ledger_id, user_id=current_user.id, expense_id=eid, action="moved_in", changes={"from_ledger_id": str(old_ledger_id) if old_ledger_id else None})
        if old_ledger_id:
            await _log_audit(db, ledger_id=old_ledger_id, user_id=current_user.id, expense_id=eid, action="moved_out", changes={"to_ledger_id": str(body.target_ledger_id) if body.target_ledger_id else None})
        moved += 1

    await db.commit()
    return {"moved": moved}


@router.post("/expenses/copy")
async def copy_expenses(
    body: CopyExpenseBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Copy expenses into one or more additional ledgers."""
    for target_id in body.target_ledger_ids:
        if target_id:
            await _get_accessible_ledger(db, ledger_id=target_id, user_id=current_user.id)

    copied = 0
    for eid in body.expense_ids:
        result = await db.execute(
            select(Expense).where(Expense.id == eid)
        )
        src = result.scalar_one_or_none()
        if not src:
            continue

        # Fetch items
        items_result = await db.execute(select(ExpenseItem).where(ExpenseItem.expense_id == src.id))
        src_items = items_result.scalars().all()

        for target_id in body.target_ledger_ids:
            new_expense = Expense(
                user_id=current_user.id,
                merchant=src.merchant,
                description=src.description,
                amount=src.amount,
                transaction_type=src.transaction_type,
                currency=src.currency,
                expense_date=src.expense_date,
                category_id=src.category_id,
                notes=src.notes,
                source=src.source,
                confidence=src.confidence,
                cadence=src.cadence,
                cadence_interval=src.cadence_interval,
                prepaid_months=src.prepaid_months,
                prepaid_start_date=src.prepaid_start_date,
                recurring_variable=src.recurring_variable,
                recurring_auto_add=src.recurring_auto_add,
                is_major_purchase=src.is_major_purchase,
                ledger_id=target_id,
            )
            db.add(new_expense)
            await db.flush()

            for item in src_items:
                db.add(ExpenseItem(
                    expense_id=new_expense.id,
                    description=item.description,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    total=item.total,
                    subcategory=item.subcategory,
                ))

            if target_id:
                await _log_audit(db, ledger_id=target_id, user_id=current_user.id, expense_id=new_expense.id, action="copied_in", changes={"source_expense_id": str(eid)})
            copied += 1

    await db.commit()
    return {"copied": copied}
