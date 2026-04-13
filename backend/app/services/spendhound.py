"""Core domain helpers for SpendHound."""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.budget import Budget
from app.models.category import Category, MerchantRule
from app.models.expense import Expense
from app.models.receipt import Receipt

DEFAULT_CATEGORIES: list[tuple[str, str, str]] = [
    ("Groceries", "#34d399", "shopping-cart"),
    ("Dining", "#f59e0b", "utensils-crossed"),
    ("Transport", "#60a5fa", "car"),
    ("Bills", "#f87171", "receipt-text"),
    ("Housing", "#a78bfa", "home"),
    ("Health", "#fb7185", "heart-pulse"),
    ("Entertainment", "#f472b6", "film"),
    ("Shopping", "#22c55e", "store"),
    ("Travel", "#38bdf8", "plane"),
    ("Other", "#94a3b8", "circle-help"),
]


def month_start_from_string(month: str | None) -> date:
    if month:
        year_str, month_str = month.split("-", 1)
        return date(int(year_str), int(month_str), 1)
    today = date.today()
    return date(today.year, today.month, 1)


def next_month(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


async def ensure_default_categories(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Category.name).where(Category.user_id == user_id))
    existing = {name.lower() for name in result.scalars().all()}
    for name, color, icon in DEFAULT_CATEGORIES:
        if name.lower() not in existing:
            db.add(Category(user_id=user_id, name=name, color=color, icon=icon, is_system=True))
    await db.flush()


async def get_category_by_name(db: AsyncSession, user_id: uuid.UUID, name: str | None) -> Category | None:
    if not name:
        return None
    result = await db.execute(select(Category).where(Category.user_id == user_id, Category.name.ilike(name.strip())))
    return result.scalar_one_or_none()


async def get_or_create_category(db: AsyncSession, user_id: uuid.UUID, name: str | None, *, color: str = "#94a3b8") -> Category | None:
    if not name or not name.strip():
        return None
    category = await get_category_by_name(db, user_id, name)
    if category:
        return category
    category = Category(user_id=user_id, name=name.strip(), color=color)
    db.add(category)
    await db.flush()
    return category


def matches_rule(merchant: str, rule: MerchantRule) -> bool:
    merchant_value = merchant.lower().strip()
    pattern = rule.merchant_pattern.lower().strip()
    if not merchant_value or not pattern:
        return False
    if rule.pattern_type == "regex":
        try:
            return re.search(rule.merchant_pattern, merchant, flags=re.IGNORECASE) is not None
        except re.error:
            return False
    return pattern in merchant_value


async def find_matching_category(db: AsyncSession, user_id: uuid.UUID, merchant: str | None) -> Category | None:
    if not merchant:
        return None
    result = await db.execute(
        select(MerchantRule)
        .where(MerchantRule.user_id == user_id, MerchantRule.is_active.is_(True))
        .order_by(MerchantRule.priority.asc(), MerchantRule.created_at.asc())
    )
    for rule in result.scalars().all():
        if not rule.category_id:
            continue
        if matches_rule(merchant, rule):
            category_result = await db.execute(select(Category).where(Category.id == rule.category_id, Category.user_id == user_id))
            category = category_result.scalar_one_or_none()
            if category is not None:
                return category
    return None


async def resolve_category(db: AsyncSession, user_id: uuid.UUID, *, category_id: uuid.UUID | None = None, category_name: str | None = None, merchant: str | None = None) -> Category | None:
    if category_id:
        result = await db.execute(select(Category).where(Category.id == category_id, Category.user_id == user_id))
        category = result.scalar_one_or_none()
        if category is not None:
            return category
    if category_name:
        category = await get_or_create_category(db, user_id, category_name)
        if category is not None:
            return category
    return await find_matching_category(db, user_id, merchant)


def normalize_money(value: Decimal | float | str) -> Decimal:
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return amount.quantize(Decimal("0.01"))


def expense_requires_review(category: Category | None, confidence: float, source: str) -> bool:
    if category is None:
        return True
    if source == "receipt" and confidence < settings.receipt_review_confidence_threshold:
        return True
    return False


def serialize_category(category: Category) -> dict:
    return {
        "id": str(category.id),
        "name": category.name,
        "color": category.color,
        "icon": category.icon,
        "description": category.description,
        "is_system": category.is_system,
        "created_at": category.created_at.isoformat(),
        "updated_at": category.updated_at.isoformat(),
    }


def serialize_rule(rule: MerchantRule, category_name: str | None = None) -> dict:
    return {
        "id": str(rule.id),
        "category_id": str(rule.category_id) if rule.category_id else None,
        "category_name": category_name,
        "merchant_pattern": rule.merchant_pattern,
        "pattern_type": rule.pattern_type,
        "priority": rule.priority,
        "is_active": rule.is_active,
        "notes": rule.notes,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


def serialize_budget(budget: Budget, category_name: str | None = None, actual: float | None = None) -> dict:
    amount = float(budget.amount)
    actual_value = actual or 0.0
    return {
        "id": str(budget.id),
        "name": budget.name,
        "category_id": str(budget.category_id) if budget.category_id else None,
        "category_name": category_name,
        "amount": amount,
        "currency": budget.currency,
        "period": budget.period,
        "month_start": budget.month_start.isoformat(),
        "notes": budget.notes,
        "actual": round(actual_value, 2),
        "remaining": round(amount - actual_value, 2),
        "created_at": budget.created_at.isoformat(),
        "updated_at": budget.updated_at.isoformat(),
    }


def serialize_receipt(receipt: Receipt) -> dict:
    return {
        "id": str(receipt.id),
        "original_filename": receipt.original_filename,
        "stored_filename": receipt.stored_filename,
        "content_type": receipt.content_type,
        "file_size": receipt.file_size,
        "ocr_text": receipt.ocr_text,
        "preview": receipt.preview_data,
        "extraction_confidence": receipt.extraction_confidence,
        "extraction_status": receipt.extraction_status,
        "needs_review": receipt.needs_review,
        "review_notes": receipt.review_notes,
        "created_at": receipt.created_at.isoformat(),
        "updated_at": receipt.updated_at.isoformat(),
        "finalized_at": receipt.finalized_at.isoformat() if receipt.finalized_at else None,
    }


def serialize_expense(expense: Expense, *, category_name: str | None = None, receipt_filename: str | None = None) -> dict:
    return {
        "id": str(expense.id),
        "merchant": expense.merchant,
        "description": expense.description,
        "amount": float(expense.amount),
        "currency": expense.currency,
        "expense_date": expense.expense_date.isoformat(),
        "source": expense.source,
        "confidence": expense.confidence,
        "needs_review": expense.needs_review,
        "notes": expense.notes,
        "is_recurring": expense.is_recurring,
        "recurring_group": expense.recurring_group,
        "category_id": str(expense.category_id) if expense.category_id else None,
        "category_name": category_name,
        "receipt_id": str(expense.receipt_id) if expense.receipt_id else None,
        "receipt_filename": receipt_filename,
        "created_at": expense.created_at.isoformat(),
        "updated_at": expense.updated_at.isoformat(),
    }


async def recompute_recurring_expenses(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Expense).where(Expense.user_id == user_id).order_by(Expense.expense_date.asc()))
    expenses = result.scalars().all()
    for expense in expenses:
        expense.is_recurring = False
        expense.recurring_group = None

    grouped: dict[tuple[str, str], list[Expense]] = defaultdict(list)
    for expense in expenses:
        merchant_key = re.sub(r"[^a-z0-9]+", " ", expense.merchant.lower()).strip()
        grouped[(merchant_key, expense.currency)].append(expense)

    for (merchant_key, currency), group in grouped.items():
        if len(group) < 2 or not merchant_key:
            continue
        amounts = [float(item.amount) for item in group]
        avg_amount = sum(amounts) / len(amounts)
        if avg_amount <= 0:
            continue
        if any(abs(amount - avg_amount) / avg_amount > 0.05 for amount in amounts):
            continue
        gaps = [(group[index].expense_date - group[index - 1].expense_date).days for index in range(1, len(group))]
        if not gaps or not all(20 <= gap <= 40 for gap in gaps):
            continue
        recurring_group = f"{merchant_key}:{currency}:{avg_amount:.2f}"
        for expense in group:
            expense.is_recurring = True
            expense.recurring_group = recurring_group
    await db.flush()


def apply_expense_filters(statement, *, user_id: uuid.UUID, month: str | None = None, category_id: uuid.UUID | None = None, review_only: bool = False, search: str | None = None):
    statement = statement.where(Expense.user_id == user_id)
    if month:
        start = month_start_from_string(month)
        statement = statement.where(Expense.expense_date >= start, Expense.expense_date < next_month(start))
    if category_id:
        statement = statement.where(Expense.category_id == category_id)
    if review_only:
        statement = statement.where((Expense.needs_review.is_(True)) | (Expense.category_id.is_(None)))
    if search:
        like_value = f"%{search.strip()}%"
        statement = statement.where(Expense.merchant.ilike(like_value) | Expense.description.ilike(like_value))
    return statement


async def delete_orphaned_category_rules(db: AsyncSession, category_id: uuid.UUID) -> None:
    await db.execute(delete(MerchantRule).where(MerchantRule.category_id == category_id, MerchantRule.is_active.is_(False)))
