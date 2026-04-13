"""Helpers for generating reusable expense export payloads."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.services.spendhound import apply_expense_filters, serialize_expense


async def build_expense_export_payload(db: AsyncSession, *, user_id: uuid.UUID, month: str | None) -> dict:
    statement = apply_expense_filters(
        select(Expense, Category.name, Receipt.original_filename)
        .outerjoin(Category, Category.id == Expense.category_id)
        .outerjoin(Receipt, Receipt.id == Expense.receipt_id),
        user_id=user_id,
        month=month,
    ).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    result = await db.execute(statement)
    items = [
        serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename)
        for expense, category_name, receipt_filename in result.all()
    ]
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "month": month,
        "total": len(items),
        "items": items,
    }


async def build_expense_export_json_bytes(db: AsyncSession, *, user_id: uuid.UUID, month: str | None) -> bytes:
    payload = await build_expense_export_payload(db, user_id=user_id, month=month)
    return json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
