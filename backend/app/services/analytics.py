"""Dashboard analytics for SpendHound."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import Budget
from app.models.category import Category
from app.models.expense import Expense
from app.services.spendhound import month_start_from_string, next_month, serialize_budget


async def build_dashboard_analytics(db: AsyncSession, user_id: uuid.UUID, *, month: str | None) -> dict:
    selected_month = month_start_from_string(month)
    month_end = next_month(selected_month)

    expenses_result = await db.execute(
        select(Expense, Category.name)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(Expense.user_id == user_id, Expense.expense_date >= selected_month, Expense.expense_date < month_end)
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    )
    expense_rows = expenses_result.all()

    monthly_total = round(sum(float(expense.amount) for expense, _ in expense_rows), 2)
    transaction_count = len(expense_rows)
    average_transaction = round(monthly_total / transaction_count, 2) if transaction_count else 0.0

    by_category_map: dict[str, float] = defaultdict(float)
    by_merchant_map: dict[str, float] = defaultdict(float)
    recurring_items: list[dict] = []

    for expense, category_name in expense_rows:
        bucket = category_name or "Uncategorized"
        by_category_map[bucket] += float(expense.amount)
        by_merchant_map[expense.merchant] += float(expense.amount)
        if expense.is_recurring:
            recurring_items.append(
                {
                    "id": str(expense.id),
                    "merchant": expense.merchant,
                    "amount": float(expense.amount),
                    "currency": expense.currency,
                    "expense_date": expense.expense_date.isoformat(),
                    "category_name": bucket,
                }
            )

    trend_start = date(selected_month.year - 1, selected_month.month, 1)
    trend_result = await db.execute(
        select(Expense)
        .where(Expense.user_id == user_id, Expense.expense_date >= trend_start, Expense.expense_date < month_end)
        .order_by(Expense.expense_date.asc())
    )
    trend_expenses = trend_result.scalars().all()
    monthly_trend_map: dict[str, float] = defaultdict(float)
    for expense in trend_expenses:
        monthly_trend_map[expense.expense_date.strftime("%Y-%m")] += float(expense.amount)

    budget_result = await db.execute(
        select(Budget, Category.name)
        .outerjoin(Category, Category.id == Budget.category_id)
        .where(Budget.user_id == user_id, Budget.month_start == selected_month)
        .order_by(Budget.created_at.asc())
    )
    budget_rows = budget_result.all()
    category_actuals: dict[str | None, float] = defaultdict(float)
    for expense, category_name in expense_rows:
        category_actuals[category_name] += float(expense.amount)
    budgets = []
    for budget, category_name in budget_rows:
        actual = monthly_total if category_name is None else category_actuals.get(category_name, 0.0)
        budgets.append(serialize_budget(budget, category_name=category_name, actual=actual))

    return {
        "month": selected_month.strftime("%Y-%m"),
        "summary": {
            "total_spend": monthly_total,
            "transaction_count": transaction_count,
            "average_transaction": average_transaction,
            "review_count": sum(1 for expense, _ in expense_rows if expense.needs_review),
        },
        "spend_by_category": [
            {"name": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_category_map.items(), key=lambda item: item[1], reverse=True)
        ],
        "top_merchants": [
            {"merchant": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_merchant_map.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
        "monthly_trend": [
            {"month": month_key, "amount": round(amount, 2)}
            for month_key, amount in sorted(monthly_trend_map.items())
        ],
        "recurring_expenses": recurring_items,
        "budgets": budgets,
    }
