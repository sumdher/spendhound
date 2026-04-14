"""Category and merchant-rule API for SpendHound."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.category import Category, ItemKeywordRule, MerchantRule
from app.models.user import User
from app.services.spendhound import TRANSACTION_TYPE_DEBIT, ensure_default_categories, normalize_transaction_type, serialize_category, serialize_item_rule, serialize_rule

router = APIRouter()


class CategoryCreate(BaseModel):
    name: str
    color: str = "#60a5fa"
    icon: str | None = None
    description: str | None = None
    transaction_type: str = TRANSACTION_TYPE_DEBIT


class CategoryUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    icon: str | None = None
    description: str | None = None
    transaction_type: str | None = None


class MerchantRuleCreate(BaseModel):
    merchant_pattern: str
    category_id: uuid.UUID | None = None
    pattern_type: str = "fuzzy"
    priority: int = 100
    is_active: bool = True
    notes: str | None = None


class MerchantRuleUpdate(BaseModel):
    merchant_pattern: str | None = None
    category_id: uuid.UUID | None = None
    pattern_type: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    notes: str | None = None


class ItemKeywordRuleCreate(BaseModel):
    keyword: str
    subcategory_label: str
    pattern_type: str = "fuzzy"
    priority: int = 100
    is_active: bool = True
    notes: str | None = None


class ItemKeywordRuleUpdate(BaseModel):
    keyword: str | None = None
    subcategory_label: str | None = None
    pattern_type: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    notes: str | None = None


@router.get("")
async def list_categories(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    await ensure_default_categories(db, current_user.id)
    result = await db.execute(select(Category).where(Category.user_id == current_user.id).order_by(Category.name.asc()))
    return [serialize_category(category) for category in result.scalars().all()]


@router.post("")
async def create_category(body: CategoryCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    await ensure_default_categories(db, current_user.id)
    existing = await db.execute(select(Category).where(Category.user_id == current_user.id, Category.name.ilike(body.name.strip())))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Category already exists")
    category = Category(
        user_id=current_user.id,
        name=body.name.strip(),
        color=body.color,
        icon=body.icon,
        description=body.description,
        transaction_type=normalize_transaction_type(body.transaction_type),
        is_system=False,
    )
    db.add(category)
    await db.flush()
    await db.refresh(category)
    return serialize_category(category)


@router.patch("/{category_id}")
async def update_category(category_id: uuid.UUID, body: CategoryUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Category).where(Category.id == category_id, Category.user_id == current_user.id))
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "transaction_type" and value is not None:
            value = normalize_transaction_type(value)
        setattr(category, field, value)
    await db.flush()
    return serialize_category(category)


@router.delete("/{category_id}", status_code=204)
async def delete_category(category_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Category).where(Category.id == category_id, Category.user_id == current_user.id))
    category = result.scalar_one_or_none()
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(category)


@router.get("/rules")
async def list_rules(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(
        select(MerchantRule, Category.name)
        .outerjoin(Category, Category.id == MerchantRule.category_id)
        .where(MerchantRule.user_id == current_user.id)
        .order_by(MerchantRule.priority.asc(), MerchantRule.created_at.asc())
    )
    return [serialize_rule(rule, category_name) for rule, category_name in result.all()]


@router.post("/rules")
async def create_rule(body: MerchantRuleCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rule = MerchantRule(
        user_id=current_user.id,
        merchant_pattern=body.merchant_pattern.strip(),
        category_id=body.category_id,
        pattern_type=body.pattern_type,
        priority=body.priority,
        is_active=body.is_active,
        notes=body.notes,
    )
    db.add(rule)
    await db.flush()
    category_name = None
    if rule.category_id:
        category_result = await db.execute(select(Category.name).where(Category.id == rule.category_id, Category.user_id == current_user.id))
        category_name = category_result.scalar_one_or_none()
    return serialize_rule(rule, category_name)


@router.patch("/rules/{rule_id}")
async def update_rule(rule_id: uuid.UUID, body: MerchantRuleUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(MerchantRule).where(MerchantRule.id == rule_id, MerchantRule.user_id == current_user.id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.flush()
    category_name = None
    if rule.category_id:
        category_result = await db.execute(select(Category.name).where(Category.id == rule.category_id, Category.user_id == current_user.id))
        category_name = category_result.scalar_one_or_none()
    return serialize_rule(rule, category_name)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(MerchantRule).where(MerchantRule.id == rule_id, MerchantRule.user_id == current_user.id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)


@router.get("/item-rules")
async def list_item_rules(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(
        select(ItemKeywordRule)
        .where(ItemKeywordRule.user_id == current_user.id)
        .order_by(ItemKeywordRule.priority.asc(), ItemKeywordRule.created_at.asc())
    )
    return [serialize_item_rule(rule) for rule in result.scalars().all()]


@router.post("/item-rules")
async def create_item_rule(body: ItemKeywordRuleCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rule = ItemKeywordRule(
        user_id=current_user.id,
        keyword=body.keyword.strip(),
        subcategory_label=body.subcategory_label.strip(),
        pattern_type=body.pattern_type,
        priority=body.priority,
        is_active=body.is_active,
        notes=body.notes,
    )
    db.add(rule)
    await db.flush()
    return serialize_item_rule(rule)


@router.patch("/item-rules/{rule_id}")
async def update_item_rule(rule_id: uuid.UUID, body: ItemKeywordRuleUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(ItemKeywordRule).where(ItemKeywordRule.id == rule_id, ItemKeywordRule.user_id == current_user.id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Item rule not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    await db.flush()
    return serialize_item_rule(rule)


@router.delete("/item-rules/{rule_id}", status_code=204)
async def delete_item_rule(rule_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(ItemKeywordRule).where(ItemKeywordRule.id == rule_id, ItemKeywordRule.user_id == current_user.id))
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Item rule not found")
    await db.delete(rule)
