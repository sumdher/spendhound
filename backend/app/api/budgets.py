"""Budget API for SpendHound."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.budget import Budget
from app.models.category import Category
from app.models.expense import Expense
from app.models.user import User
from app.services.spendhound import month_start_from_string, next_month, serialize_budget

router = APIRouter()


class BudgetCreate(BaseModel):
    name: str
    amount: float
    currency: str = "EUR"
    category_id: uuid.UUID | None = None
    month_start: date
    notes: str | None = None


class BudgetUpdate(BaseModel):
    name: str | None = None
    amount: float | None = None
    currency: str | None = None
    category_id: uuid.UUID | None = None
    month_start: date | None = None
    notes: str | None = None


@router.get("")
async def list_budgets(month: str | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    month_value = month_start_from_string(month)
    month_end = next_month(month_value)
    result = await db.execute(
        select(Budget, Category.name)
        .outerjoin(Category, Category.id == Budget.category_id)
        .where(Budget.user_id == current_user.id, Budget.month_start == month_value)
        .order_by(Budget.created_at.asc())
    )
    budget_rows = result.all()

    expenses = await db.execute(
        select(Expense, Category.name)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(Expense.user_id == current_user.id, Expense.expense_date >= month_value, Expense.expense_date < month_end)
    )
    actuals: dict[str | None, float] = {}
    overall = 0.0
    for expense, category_name in expenses.all():
        amount = float(expense.amount)
        overall += amount
        actuals[category_name] = actuals.get(category_name, 0.0) + amount

    return [serialize_budget(budget, category_name=category_name, actual=overall if category_name is None else actuals.get(category_name, 0.0)) for budget, category_name in budget_rows]


@router.post("")
async def create_budget(body: BudgetCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    budget = Budget(
        user_id=current_user.id,
        name=body.name.strip(),
        amount=Decimal(str(body.amount)),
        currency=body.currency,
        category_id=body.category_id,
        month_start=body.month_start,
        notes=body.notes,
    )
    db.add(budget)
    await db.flush()
    category_name = None
    if budget.category_id:
        result = await db.execute(select(Category.name).where(Category.id == budget.category_id, Category.user_id == current_user.id))
        category_name = result.scalar_one_or_none()
    return serialize_budget(budget, category_name=category_name)


@router.patch("/{budget_id}")
async def update_budget(budget_id: uuid.UUID, body: BudgetUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Budget).where(Budget.id == budget_id, Budget.user_id == current_user.id))
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(status_code=404, detail="Budget not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "amount" and value is not None:
            budget.amount = Decimal(str(value))
        else:
            setattr(budget, field, value)
    await db.flush()
    category_name = None
    if budget.category_id:
        category_result = await db.execute(select(Category.name).where(Category.id == budget.category_id, Category.user_id == current_user.id))
        category_name = category_result.scalar_one_or_none()
    return serialize_budget(budget, category_name=category_name)


@router.delete("/{budget_id}", status_code=204)
async def delete_budget(budget_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Budget).where(Budget.id == budget_id, Budget.user_id == current_user.id))
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(status_code=404, detail="Budget not found")
    await db.delete(budget)
