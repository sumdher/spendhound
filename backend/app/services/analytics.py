"""Dashboard analytics for SpendHound."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import Budget
from app.models.category import Category
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.services.spendhound import CADENCE_ONE_TIME, CADENCE_PREPAID, TRANSACTION_TYPE_CREDIT, TRANSACTION_TYPE_DEBIT, _compute_prepaid_end_date, derive_grocery_subcategory, month_start_from_string, next_month, serialize_budget, signed_amount

logger = structlog.get_logger(__name__)


async def _build_grocery_insights(db: AsyncSession, user_id: uuid.UUID, selected_month: date, month_end: date) -> dict:
    result = await db.execute(
        select(ExpenseItem, Expense.amount)
        .join(Expense, Expense.id == ExpenseItem.expense_id)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(
            Expense.user_id == user_id,
            Expense.transaction_type == TRANSACTION_TYPE_DEBIT,
            Expense.expense_date >= selected_month,
            Expense.expense_date < month_end,
            func.lower(Category.name).like("%groc%"),
        )
    )
    grocery_item_rows = result.all()
    if not grocery_item_rows:
        return {
            "item_count": 0,
            "total_itemized_spend": 0.0,
            "summary": "No itemized grocery receipts yet for this month.",
            "top_subcategories": [],
            "least_subcategories": [],
            "uncategorized_count": 0,
        }

    totals: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    total_itemized_spend = 0.0
    derived_subcategory_count = 0
    approved_totals_by_expense: dict[uuid.UUID, float] = {}
    items_by_expense: dict[uuid.UUID, list[tuple[ExpenseItem, float]]] = defaultdict(list)

    for item, expense_amount in grocery_item_rows:
        raw_amount = float(item.total_price) if item.total_price is not None else float(item.unit_price or 0) * float(item.quantity or 0)
        approved_totals_by_expense[item.expense_id] = float(expense_amount)
        items_by_expense[item.expense_id].append((item, raw_amount))

    for expense_id, expense_items in items_by_expense.items():
        approved_total = approved_totals_by_expense[expense_id]
        raw_total = sum(amount for _, amount in expense_items)
        scale = min(1.0, approved_total / raw_total) if raw_total > 0 else 1.0

        for item, amount in expense_items:
            adjusted_amount = amount * scale
            total_itemized_spend += adjusted_amount
            label = item.subcategory
            if not label:
                label, _ = derive_grocery_subcategory(item.description)
                derived_subcategory_count += 1
            totals[label] += adjusted_amount
            counts[label] += 1

    if derived_subcategory_count:
        logger.info(
            "analytics.grocery_subcategories.derived_for_dashboard",
            user_id=str(user_id),
            derived_subcategory_count=derived_subcategory_count,
            grocery_item_count=len(grocery_item_rows),
        )

    ordered = sorted(totals.items(), key=lambda candidate: candidate[1], reverse=True)
    top_subcategories = [
        {"name": name, "amount": round(amount, 2), "item_count": counts[name]}
        for name, amount in ordered[:5]
    ]
    least_subcategories = [
        {"name": name, "amount": round(amount, 2), "item_count": counts[name]}
        for name, amount in sorted(totals.items(), key=lambda candidate: candidate[1])[:3]
    ]
    summary = (
        f"Most grocery spend went to {top_subcategories[0]['name']}"
        + (f", followed by {top_subcategories[1]['name']}" if len(top_subcategories) > 1 else "")
        + (
            f". Your lightest categories were {', '.join(item['name'] for item in least_subcategories)}."
            if least_subcategories
            else "."
        )
    )
    return {
        "item_count": len(grocery_item_rows),
        "total_itemized_spend": round(total_itemized_spend, 2),
        "summary": summary,
        "top_subcategories": top_subcategories,
        "least_subcategories": least_subcategories,
        "uncategorized_count": 0,
    }


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

    money_out = round(sum(float(expense.amount) for expense, _ in expense_rows if expense.transaction_type == TRANSACTION_TYPE_DEBIT), 2)
    money_in = round(sum(float(expense.amount) for expense, _ in expense_rows if expense.transaction_type == TRANSACTION_TYPE_CREDIT), 2)
    monthly_total = money_out
    net_total = round(money_in - money_out, 2)

    money_out_by_currency: dict[str, float] = defaultdict(float)
    money_in_by_currency: dict[str, float] = defaultdict(float)
    for expense, _ in expense_rows:
        cur = expense.currency or "EUR"
        if expense.transaction_type == TRANSACTION_TYPE_DEBIT:
            money_out_by_currency[cur] += float(expense.amount)
        else:
            money_in_by_currency[cur] += float(expense.amount)
    all_currencies = set(list(money_out_by_currency.keys()) + list(money_in_by_currency.keys()))
    net_by_currency = {cur: round(money_in_by_currency.get(cur, 0.0) - money_out_by_currency.get(cur, 0.0), 2) for cur in all_currencies}
    transaction_count = len(expense_rows)
    debit_count = sum(1 for expense, _ in expense_rows if expense.transaction_type == TRANSACTION_TYPE_DEBIT)
    credit_count = sum(1 for expense, _ in expense_rows if expense.transaction_type == TRANSACTION_TYPE_CREDIT)
    average_transaction = round(monthly_total / debit_count, 2) if debit_count else 0.0
    average_income = round(money_in / credit_count, 2) if credit_count else 0.0

    by_category_map: dict[str, float] = defaultdict(float)
    income_by_category_map: dict[str, float] = defaultdict(float)
    by_merchant_map: dict[str, float] = defaultdict(float)
    income_by_merchant_map: dict[str, float] = defaultdict(float)
    recurring_items: list[dict] = []
    major_one_time_purchases: list[dict] = []

    for expense, category_name in expense_rows:
        bucket = category_name or "Uncategorized"
        if expense.transaction_type == TRANSACTION_TYPE_CREDIT:
            income_by_category_map[bucket] += float(expense.amount)
            income_by_merchant_map[expense.merchant] += float(expense.amount)
        else:
            by_category_map[bucket] += float(expense.amount)
            by_merchant_map[expense.merchant] += float(expense.amount)
        if expense.is_recurring:
            recurring_items.append(
                {
                    "id": str(expense.id),
                    "merchant": expense.merchant,
                    "amount": float(expense.amount),
                    "signed_amount": signed_amount(expense.amount, expense.transaction_type),
                    "transaction_type": expense.transaction_type,
                    "currency": expense.currency,
                    "expense_date": expense.expense_date.isoformat(),
                    "category_name": bucket,
                    "cadence": expense.cadence,
                    "is_major_purchase": expense.is_major_purchase,
                }
            )
        if expense.transaction_type == TRANSACTION_TYPE_DEBIT and expense.cadence == CADENCE_ONE_TIME and expense.is_major_purchase:
            major_one_time_purchases.append(
                {
                    "id": str(expense.id),
                    "merchant": expense.merchant,
                    "amount": float(expense.amount),
                    "signed_amount": signed_amount(expense.amount, expense.transaction_type),
                    "transaction_type": expense.transaction_type,
                    "currency": expense.currency,
                    "expense_date": expense.expense_date.isoformat(),
                    "category_name": bucket,
                    "cadence": expense.cadence,
                    "is_major_purchase": True,
                }
            )

    trend_start = date(selected_month.year - 1, selected_month.month, 1)
    trend_result = await db.execute(
        select(Expense)
        .where(Expense.user_id == user_id, Expense.expense_date >= trend_start, Expense.expense_date < month_end)
        .order_by(Expense.expense_date.asc())
    )
    trend_expenses = trend_result.scalars().all()
    monthly_trend_map: dict[str, dict[str, float]] = defaultdict(lambda: {"money_in": 0.0, "money_out": 0.0, "net": 0.0})
    for expense in trend_expenses:
        month_key = expense.expense_date.strftime("%Y-%m")
        if expense.transaction_type == TRANSACTION_TYPE_CREDIT:
            monthly_trend_map[month_key]["money_in"] += float(expense.amount)
            monthly_trend_map[month_key]["net"] += float(expense.amount)
        else:
            monthly_trend_map[month_key]["money_out"] += float(expense.amount)
            monthly_trend_map[month_key]["net"] -= float(expense.amount)

    budget_result = await db.execute(
        select(Budget, Category.name)
        .outerjoin(Category, Category.id == Budget.category_id)
        .where(Budget.user_id == user_id, Budget.month_start == selected_month)
        .order_by(Budget.created_at.asc())
    )
    budget_rows = budget_result.all()
    category_actuals: dict[str | None, float] = defaultdict(float)
    for expense, category_name in expense_rows:
        if expense.transaction_type == TRANSACTION_TYPE_DEBIT:
            category_actuals[category_name] += float(expense.amount)
    budgets = []
    for budget, category_name in budget_rows:
        actual = monthly_total if category_name is None else category_actuals.get(category_name, 0.0)
        budgets.append(serialize_budget(budget, category_name=category_name, actual=actual))

    grocery_insights = await _build_grocery_insights(db, user_id, selected_month, month_end)

    # Prepaid subscriptions — query all time (not month-scoped), coverage window computed from today
    prepaid_result = await db.execute(
        select(Expense, Category.name)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(
            Expense.user_id == user_id,
            Expense.cadence == CADENCE_PREPAID,
            Expense.transaction_type == TRANSACTION_TYPE_DEBIT,
        )
        .order_by(Expense.expense_date.desc())
    )
    today = datetime.now().date()
    prepaid_subscriptions = []
    for prepaid_expense, prepaid_cat_name in prepaid_result.all():
        end_date_str = _compute_prepaid_end_date(prepaid_expense)
        if not end_date_str:
            continue
        end_date = date.fromisoformat(end_date_str)
        days_remaining = (end_date - today).days
        if days_remaining < -30:
            continue  # expired more than 30 days ago — suppress
        if days_remaining < 0:
            status = "expired"
        elif days_remaining <= 30:
            status = "expiring_soon"
        else:
            status = "active"
        start = prepaid_expense.prepaid_start_date or prepaid_expense.expense_date
        prepaid_subscriptions.append(
            {
                "id": str(prepaid_expense.id),
                "merchant": prepaid_expense.merchant,
                "amount": float(prepaid_expense.amount),
                "currency": prepaid_expense.currency,
                "expense_date": prepaid_expense.expense_date.isoformat(),
                "category_name": prepaid_cat_name or "Uncategorized",
                "prepaid_months": prepaid_expense.prepaid_months or 0,
                "prepaid_start_date": start.isoformat(),
                "prepaid_end_date": end_date_str,
                "days_remaining": days_remaining,
                "status": status,
            }
        )

    return {
        "month": selected_month.strftime("%Y-%m"),
        "summary": {
            "total_spend": monthly_total,
            "total_income": money_in,
            "money_in": money_in,
            "money_out": money_out,
            "net": net_total,
            "money_out_by_currency": {k: round(v, 2) for k, v in sorted(money_out_by_currency.items(), key=lambda item: (item[0] != "EUR", -item[1]))},
            "money_in_by_currency": {k: round(v, 2) for k, v in sorted(money_in_by_currency.items(), key=lambda item: (item[0] != "EUR", -item[1]))},
            "net_by_currency": {k: v for k, v in sorted(net_by_currency.items(), key=lambda item: item[0] != "EUR")},
            "transaction_count": transaction_count,
            "average_transaction": average_transaction,
            "average_outflow": average_transaction,
            "average_inflow": average_income,
            "review_count": sum(1 for expense, _ in expense_rows if expense.needs_review),
        },
        "spend_by_category": [
            {"name": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_category_map.items(), key=lambda item: item[1], reverse=True)
        ],
        "income_by_category": [
            {"name": name, "amount": round(amount, 2)}
            for name, amount in sorted(income_by_category_map.items(), key=lambda item: item[1], reverse=True)
        ],
        "top_merchants": [
            {"merchant": name, "amount": round(amount, 2)}
            for name, amount in sorted(by_merchant_map.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
        "top_income_sources": [
            {"merchant": name, "amount": round(amount, 2)}
            for name, amount in sorted(income_by_merchant_map.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
        "monthly_trend": [
            {
                "month": month_key,
                "amount": round(values["money_out"], 2),
                "money_in": round(values["money_in"], 2),
                "money_out": round(values["money_out"], 2),
                "net": round(values["net"], 2),
            }
            for month_key, values in sorted(monthly_trend_map.items())
        ],
        "recurring_transactions": recurring_items,
        "recurring_expenses": recurring_items,
        "major_one_time_purchases": sorted(major_one_time_purchases, key=lambda item: item["amount"], reverse=True)[:6],
        "prepaid_subscriptions": prepaid_subscriptions,
        "budgets": budgets,
        "grocery_insights": grocery_insights,
    }
