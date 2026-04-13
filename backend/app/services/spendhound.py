"""Core domain helpers for SpendHound."""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.config import settings
from app.models.budget import Budget
from app.models.category import Category, MerchantRule
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.receipt import Receipt

logger = structlog.get_logger(__name__)

TRANSACTION_TYPE_DEBIT = "debit"
TRANSACTION_TYPE_CREDIT = "credit"

DEFAULT_CATEGORIES: list[tuple[str, str, str, str]] = [
    ("Groceries", "#34d399", "shopping-cart", TRANSACTION_TYPE_DEBIT),
    ("Dining", "#f59e0b", "utensils-crossed", TRANSACTION_TYPE_DEBIT),
    ("Transport", "#60a5fa", "car", TRANSACTION_TYPE_DEBIT),
    ("Bills", "#f87171", "receipt-text", TRANSACTION_TYPE_DEBIT),
    ("Housing", "#a78bfa", "home", TRANSACTION_TYPE_DEBIT),
    ("Health", "#fb7185", "heart-pulse", TRANSACTION_TYPE_DEBIT),
    ("Entertainment", "#f472b6", "film", TRANSACTION_TYPE_DEBIT),
    ("Shopping", "#22c55e", "store", TRANSACTION_TYPE_DEBIT),
    ("Travel", "#38bdf8", "plane", TRANSACTION_TYPE_DEBIT),
    ("Other", "#94a3b8", "circle-help", TRANSACTION_TYPE_DEBIT),
    ("Salary", "#10b981", "badge-euro", TRANSACTION_TYPE_CREDIT),
    ("Gift", "#ec4899", "gift", TRANSACTION_TYPE_CREDIT),
    ("Refund", "#22c55e", "rotate-ccw", TRANSACTION_TYPE_CREDIT),
    ("Reimbursement", "#14b8a6", "wallet", TRANSACTION_TYPE_CREDIT),
    ("Transfer", "#6366f1", "arrow-right-left", TRANSACTION_TYPE_CREDIT),
    ("Interest", "#06b6d4", "landmark", TRANSACTION_TYPE_CREDIT),
    ("Other Income", "#84cc16", "circle-dollar-sign", TRANSACTION_TYPE_CREDIT),
]

GROCERY_SUBCATEGORY_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(lettuce|tomato|spinach|potato|onion|broccoli|carrot|pepper|cucumber|zucchini|mushroom|salad|vegetable|veg)\b", re.IGNORECASE), "Vegetables"),
    (re.compile(r"\b(apple|banana|orange|lemon|lime|berry|berries|grape|melon|pear|peach|kiwi|mango|avocado|fruit)\b", re.IGNORECASE), "Fruit"),
    (re.compile(r"\b(chicken|beef|pork|turkey|sausage|bacon|mince|steak|ham|meat)\b", re.IGNORECASE), "Meat"),
    (re.compile(r"\b(salmon|tuna|cod|shrimp|prawn|mussel|fish|seafood)\b", re.IGNORECASE), "Fish & Seafood"),
    (re.compile(r"\b(milk|yogurt|cheese|butter|cream|mozzarella|parmesan|egg|eggs)\b", re.IGNORECASE), "Dairy & Eggs"),
    (re.compile(r"\b(bread|bagel|croissant|bun|roll|baguette|cake|muffin|bakery|pastry|tortilla)\b", re.IGNORECASE), "Bakery"),
    (re.compile(r"\b(frozen|ice cream|gelato|pizza|fries|fish fingers)\b", re.IGNORECASE), "Frozen"),
    (re.compile(r"\b(chips|crisps|cracker|chocolate|cookie|biscuit|snack|candy|popcorn|nuts|trail mix)\b", re.IGNORECASE), "Snacks"),
    (re.compile(r"\b(water|juice|cola|soda|sparkling|coffee|tea|beer|wine|drink|beverage)\b", re.IGNORECASE), "Beverages"),
    (re.compile(r"\b(detergent|dish soap|dishwasher|bleach|cleaner|disinfectant|toilet cleaner|laundry|softener|descaler|cleaning)\b", re.IGNORECASE), "Cleaning Products"),
    (re.compile(r"\b(shampoo|conditioner|soap|body wash|deodorant|toothpaste|toothbrush|razor|lotion|personal care)\b", re.IGNORECASE), "Personal Care"),
    (re.compile(r"\b(diaper|diapers|wipes|formula|baby food|baby)\b", re.IGNORECASE), "Baby"),
    (re.compile(r"\b(cat food|dog food|pet food|kibble|litter|treats|pet)\b", re.IGNORECASE), "Pet Care"),
    (re.compile(r"\b(paper towel|paper towels|napkin|napkins|foil|cling film|garbage bag|trash bag|bin bag|batteries|light bulb|household)\b", re.IGNORECASE), "Household"),
    (re.compile(r"\b(cereal|granola|oats|muesli|breakfast)\b", re.IGNORECASE), "Breakfast & Cereal"),
    (re.compile(r"\b(ketchup|mustard|mayo|mayonnaise|vinegar|hot sauce|soy sauce|peppercorn|spice|spices|herb|seasoning|salt)\b", re.IGNORECASE), "Condiments & Spices"),
    (re.compile(r"\b(pasta|rice|flour|oil|sauce|beans|lentils|canned|soup|pantry|sugar|breadcrumbs|noodles)\b", re.IGNORECASE), "Pantry"),
    (re.compile(r"\b(ready meal|prepared|meal deal|sandwich|wrap|sushi|rotisserie|deli|take away)\b", re.IGNORECASE), "Prepared Meals"),
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


def normalize_grocery_description(description: str | None) -> str:
    cleaned = re.sub(r"[^a-z0-9&]+", " ", (description or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()[:180]


def is_grocery_category_name(category_name: str | None) -> bool:
    return bool(category_name and "groc" in category_name.lower())


def normalize_transaction_type(value: str | None, default: str = TRANSACTION_TYPE_DEBIT) -> str:
    normalized = (value or default).strip().lower().replace("-", "_").replace(" ", "_")
    mapping = {
        "debit": TRANSACTION_TYPE_DEBIT,
        "expense": TRANSACTION_TYPE_DEBIT,
        "money_out": TRANSACTION_TYPE_DEBIT,
        "outflow": TRANSACTION_TYPE_DEBIT,
        "credit": TRANSACTION_TYPE_CREDIT,
        "income": TRANSACTION_TYPE_CREDIT,
        "money_in": TRANSACTION_TYPE_CREDIT,
        "inflow": TRANSACTION_TYPE_CREDIT,
    }
    return mapping.get(normalized, default)


def signed_amount(value: Decimal | float, transaction_type: str) -> float:
    amount = float(value)
    return round(amount if normalize_transaction_type(transaction_type) == TRANSACTION_TYPE_CREDIT else -amount, 2)


def derive_grocery_subcategory(description: str | None) -> tuple[str, float]:
    normalized = normalize_grocery_description(description)
    if not normalized:
        return "Other Grocery", 0.55
    for pattern, label in GROCERY_SUBCATEGORY_RULES:
        if pattern.search(normalized):
            return label, 0.92
    return "Other Grocery", 0.55


async def expense_category_name(db: AsyncSession, expense: Expense, category_name: str | None = None) -> str | None:
    if category_name is not None:
        return category_name
    if expense.category is not None:
        return expense.category.name
    if expense.category_id is None:
        return None
    result = await db.execute(select(Category.name).where(Category.id == expense.category_id))
    return result.scalar_one_or_none()


async def ensure_default_categories(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Category.name).where(Category.user_id == user_id))
    existing = {name.lower() for name in result.scalars().all()}
    for name, color, icon, transaction_type in DEFAULT_CATEGORIES:
        if name.lower() not in existing:
            db.add(Category(user_id=user_id, name=name, color=color, icon=icon, transaction_type=transaction_type, is_system=True))
    await db.flush()


async def get_category_by_name(db: AsyncSession, user_id: uuid.UUID, name: str | None, *, transaction_type: str | None = None) -> Category | None:
    if not name:
        return None
    statement = select(Category).where(Category.user_id == user_id, Category.name.ilike(name.strip()))
    if transaction_type:
        statement = statement.where(Category.transaction_type == normalize_transaction_type(transaction_type))
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def get_or_create_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str | None,
    *,
    transaction_type: str = TRANSACTION_TYPE_DEBIT,
    color: str = "#94a3b8",
) -> Category | None:
    if not name or not name.strip():
        return None
    category = await get_category_by_name(db, user_id, name, transaction_type=transaction_type)
    if category:
        return category
    existing_category = await get_category_by_name(db, user_id, name)
    if existing_category is not None:
        return None
    category = Category(user_id=user_id, name=name.strip(), color=color, transaction_type=normalize_transaction_type(transaction_type))
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


async def find_matching_category(db: AsyncSession, user_id: uuid.UUID, merchant: str | None, *, transaction_type: str | None = None) -> Category | None:
    if not merchant:
        return None
    normalized_type = normalize_transaction_type(transaction_type) if transaction_type else None
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
            if category is not None and (normalized_type is None or category.transaction_type == normalized_type):
                return category
    return None


async def resolve_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    category_id: uuid.UUID | None = None,
    category_name: str | None = None,
    merchant: str | None = None,
    transaction_type: str = TRANSACTION_TYPE_DEBIT,
) -> Category | None:
    normalized_type = normalize_transaction_type(transaction_type)
    if category_id:
        result = await db.execute(select(Category).where(Category.id == category_id, Category.user_id == user_id))
        category = result.scalar_one_or_none()
        if category is not None and category.transaction_type == normalized_type:
            return category
    if category_name:
        category = await get_or_create_category(db, user_id, category_name, transaction_type=normalized_type)
        if category is not None:
            return category
    return await find_matching_category(db, user_id, merchant, transaction_type=normalized_type)


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
        "transaction_type": category.transaction_type,
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
        "document_kind": receipt.document_kind,
        "extraction_status": receipt.extraction_status,
        "needs_review": receipt.needs_review,
        "review_notes": receipt.review_notes,
        "created_at": receipt.created_at.isoformat(),
        "updated_at": receipt.updated_at.isoformat(),
        "finalized_at": receipt.finalized_at.isoformat() if receipt.finalized_at else None,
    }


def serialize_expense_item(item: ExpenseItem) -> dict:
    return {
        "id": str(item.id),
        "description": item.description,
        "quantity": item.quantity,
        "unit_price": float(item.unit_price) if item.unit_price is not None else None,
        "total": float(item.total_price) if item.total_price is not None else None,
        "subcategory": item.subcategory,
        "subcategory_confidence": item.subcategory_confidence,
    }


def serialize_expense(
    expense: Expense,
    *,
    category_name: str | None = None,
    receipt_filename: str | None = None,
    include_items: bool = False,
    receipt_preview: dict | None = None,
    receipt_document_kind: str | None = None,
    receipt_ocr_text: str | None = None,
) -> dict:
    payload = {
        "id": str(expense.id),
        "merchant": expense.merchant,
        "description": expense.description,
        "amount": float(expense.amount),
        "signed_amount": signed_amount(expense.amount, expense.transaction_type),
        "transaction_type": expense.transaction_type,
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
    if include_items:
        payload["items"] = [serialize_expense_item(item) for item in expense.items]
        payload["receipt_preview"] = receipt_preview
        payload["receipt_document_kind"] = receipt_document_kind
        payload["receipt_ocr_text"] = receipt_ocr_text
    return payload


def _coerce_optional_money(value: Decimal | float | str | None) -> Decimal | None:
    if value in (None, ""):
        return None
    return normalize_money(value)


def _coerce_optional_float(value: float | str | None) -> float | None:
    if value in (None, ""):
        return None
    return round(float(value), 2)


def _item_value(item: object, field_name: str):
    if isinstance(item, dict):
        return item.get(field_name)
    return getattr(item, field_name, None)


async def replace_expense_items(db: AsyncSession, expense: Expense, items: list[object] | None, *, category_name: str | None = None) -> None:
    resolved_category_name = await expense_category_name(db, expense, category_name)
    is_grocery_expense = is_grocery_category_name(resolved_category_name)
    normalized_items: list[ExpenseItem] = []
    derived_subcategory_count = 0
    for item in items or []:
        description = str(_item_value(item, "description") or "").strip()[:300]
        total_price = _coerce_optional_money(_item_value(item, "total"))
        if not description and total_price is None:
            continue
        subcategory = str(_item_value(item, "subcategory") or "").strip()[:120] or None
        subcategory_confidence = _coerce_optional_float(_item_value(item, "subcategory_confidence"))
        if is_grocery_expense and not subcategory:
            subcategory, subcategory_confidence = derive_grocery_subcategory(description)
            derived_subcategory_count += 1
        normalized_items.append(
            ExpenseItem(
                expense_id=expense.id,
                description=description or "Item",
                quantity=_coerce_optional_float(_item_value(item, "quantity")),
                unit_price=_coerce_optional_money(_item_value(item, "unit_price")),
                total_price=total_price,
                subcategory=subcategory,
                subcategory_confidence=subcategory_confidence,
            )
        )

    await db.execute(
        delete(ExpenseItem)
        .where(ExpenseItem.expense_id == expense.id)
        .execution_options(synchronize_session=False)
    )
    if normalized_items:
        db.add_all(normalized_items)
    await db.flush()
    set_committed_value(expense, "items", list(normalized_items))
    if is_grocery_expense and normalized_items:
        logger.info(
            "spendhound.expense_items.subcategories_assigned",
            expense_id=str(expense.id),
            item_count=len(normalized_items),
            derived_subcategory_count=derived_subcategory_count,
        )


async def recompute_recurring_expenses(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Expense).where(Expense.user_id == user_id).order_by(Expense.expense_date.asc()))
    expenses = result.scalars().all()
    for expense in expenses:
        expense.is_recurring = False
        expense.recurring_group = None

    grouped: dict[tuple[str, str, str], list[Expense]] = defaultdict(list)
    for expense in expenses:
        merchant_key = re.sub(r"[^a-z0-9]+", " ", expense.merchant.lower()).strip()
        grouped[(merchant_key, expense.currency, expense.transaction_type)].append(expense)

    for (merchant_key, currency, transaction_type), group in grouped.items():
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
        recurring_group = f"{merchant_key}:{currency}:{transaction_type}:{avg_amount:.2f}"
        for expense in group:
            expense.is_recurring = True
            expense.recurring_group = recurring_group
    await db.flush()


def apply_expense_filters(
    statement,
    *,
    user_id: uuid.UUID,
    month: str | None = None,
    category_id: uuid.UUID | None = None,
    transaction_type: str | None = None,
    review_only: bool = False,
    search: str | None = None,
):
    statement = statement.where(Expense.user_id == user_id)
    if month:
        start = month_start_from_string(month)
        statement = statement.where(Expense.expense_date >= start, Expense.expense_date < next_month(start))
    if category_id:
        statement = statement.where(Expense.category_id == category_id)
    if transaction_type:
        statement = statement.where(Expense.transaction_type == normalize_transaction_type(transaction_type))
    if review_only:
        statement = statement.where((Expense.needs_review.is_(True)) | (Expense.category_id.is_(None)))
    if search:
        like_value = f"%{search.strip()}%"
        statement = statement.where(Expense.merchant.ilike(like_value) | Expense.description.ilike(like_value))
    return statement


async def delete_orphaned_category_rules(db: AsyncSession, category_id: uuid.UUID) -> None:
    await db.execute(delete(MerchantRule).where(MerchantRule.category_id == category_id, MerchantRule.is_active.is_(False)))
