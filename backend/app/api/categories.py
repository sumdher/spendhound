"""Category and merchant-rule API for SpendHound."""

from __future__ import annotations

import csv
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import is_admin_email
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.category import Category, ItemKeywordRule, MerchantRule
from app.models.item_embedding import ItemEmbedding
from app.models.user import User
from app.services.item_rag import bulk_upsert_embeddings
from app.services.spendhound import TRANSACTION_TYPE_DEBIT, ensure_default_categories, normalize_transaction_type, serialize_category, serialize_item_rule, serialize_rule

router = APIRouter()

_VALID_PATTERN_TYPES = {"fuzzy", "contains", "starts_with", "abbrev", "regex"}


class CategoryCreate(BaseModel):
    name: str
    color: str = "#60a5fa"
    icon: str | None = None
    description: str | None = None
    transaction_type: str = TRANSACTION_TYPE_DEBIT
    is_system: bool = False  # admin-only: marks as a system/global default category


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
    is_global: bool = False
    notes: str | None = None


class MerchantRuleUpdate(BaseModel):
    merchant_pattern: str | None = None
    category_id: uuid.UUID | None = None
    pattern_type: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    is_global: bool | None = None
    notes: str | None = None


class ItemKeywordRuleCreate(BaseModel):
    keyword: str
    subcategory_label: str
    pattern_type: str = "fuzzy"
    priority: int = 100
    is_active: bool = True
    is_global: bool = False
    notes: str | None = None


class ItemKeywordRuleUpdate(BaseModel):
    keyword: str | None = None
    subcategory_label: str | None = None
    pattern_type: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    is_global: bool | None = None
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
    is_admin = is_admin_email(current_user.email)
    category = Category(
        user_id=current_user.id,
        name=body.name.strip(),
        color=body.color,
        icon=body.icon,
        description=body.description,
        transaction_type=normalize_transaction_type(body.transaction_type),
        is_system=body.is_system and is_admin,
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
        .where(
            or_(
                (MerchantRule.user_id == current_user.id) & MerchantRule.is_global.is_(False),
                MerchantRule.is_global.is_(True),
            )
        )
        .order_by(MerchantRule.is_global.asc(), MerchantRule.priority.asc(), MerchantRule.created_at.asc())
    )
    return [serialize_rule(rule, category_name) for rule, category_name in result.all()]


@router.post("/rules")
async def create_rule(body: MerchantRuleCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    is_admin = is_admin_email(current_user.email)
    rule = MerchantRule(
        user_id=current_user.id,
        merchant_pattern=body.merchant_pattern.strip(),
        category_id=body.category_id,
        pattern_type=body.pattern_type,
        priority=body.priority,
        is_active=body.is_active,
        is_global=body.is_global and is_admin,
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
    is_admin = is_admin_email(current_user.email)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "is_global":
            if is_admin:
                rule.is_global = bool(value)
        else:
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


# ── Item keyword rules ───────────────────────────────────────────────────────

@router.get("/item-rules")
async def list_item_rules(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Return user's own rules plus all global rules."""
    result = await db.execute(
        select(ItemKeywordRule)
        .where(
            or_(
                (ItemKeywordRule.user_id == current_user.id) & ItemKeywordRule.is_global.is_(False),
                ItemKeywordRule.is_global.is_(True),
            )
        )
        .order_by(ItemKeywordRule.is_global.asc(), ItemKeywordRule.priority.asc(), ItemKeywordRule.created_at.asc())
    )
    return [serialize_item_rule(rule) for rule in result.scalars().all()]


@router.post("/item-rules")
async def create_item_rule(body: ItemKeywordRuleCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    if body.pattern_type not in _VALID_PATTERN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid pattern_type. Choose from: {', '.join(sorted(_VALID_PATTERN_TYPES))}")
    # Only admin can create global rules
    is_admin = is_admin_email(current_user.email)
    is_global = body.is_global and is_admin
    rule = ItemKeywordRule(
        user_id=current_user.id,
        is_global=is_global,
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
    is_admin = is_admin_email(current_user.email)
    data = body.model_dump(exclude_unset=True)
    if "pattern_type" in data and data["pattern_type"] not in _VALID_PATTERN_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid pattern_type. Choose from: {', '.join(sorted(_VALID_PATTERN_TYPES))}")
    for field, value in data.items():
        if field == "is_global":
            # Only admin can promote/demote global flag
            if is_admin:
                rule.is_global = bool(value)
        else:
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


# ── Knowledge base (RAG embeddings) ─────────────────────────────────────────

def _serialize_kb_entry(entry: ItemEmbedding) -> dict:
    return {
        "id": str(entry.id),
        "description_text": entry.description_text,
        "subcategory_label": entry.subcategory_label,
        "is_global": entry.is_global,
        "source": entry.source,
        "notes": entry.notes,
        "created_at": entry.created_at.isoformat(),
    }


@router.get("/knowledge-base")
async def list_knowledge_base(
    is_global: bool | None = Query(default=None),
    source: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """List the current user's RAG knowledge-base entries (and global ones if admin)."""
    stmt = select(ItemEmbedding).where(
        or_(
            ItemEmbedding.user_id == current_user.id,
            ItemEmbedding.is_global.is_(True),
        )
    )
    if is_global is not None:
        stmt = stmt.where(ItemEmbedding.is_global == is_global)
    if source is not None:
        stmt = stmt.where(ItemEmbedding.source == source)
    stmt = stmt.order_by(ItemEmbedding.is_global.desc(), ItemEmbedding.created_at.desc())
    result = await db.execute(stmt)
    return [_serialize_kb_entry(e) for e in result.scalars().all()]


@router.post("/knowledge-base/upload")
async def upload_knowledge_base(
    file: UploadFile = File(...),
    is_global: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload a CSV or TSV knowledge-base file and embed all entries.

    File format — one entry per line (no header required):
      item description,Subcategory
      DIGES. MCVITIE'S,Snacks
      LATTE INTERO,Dairy & Eggs

    Tab-separated is also accepted. Lines starting with # are ignored.
    Admin users can set is_global=true to make entries visible to everyone.
    """
    is_admin = is_admin_email(current_user.email)
    if is_global and not is_admin:
        raise HTTPException(status_code=403, detail="Only admin can upload global knowledge-base entries")

    content_bytes = await file.read()
    try:
        text = content_bytes.decode("utf-8-sig")  # handle BOM
    except UnicodeDecodeError:
        text = content_bytes.decode("latin-1")

    entries: list[tuple[str, str]] = []
    dialect: type[csv.Dialect] | str = "excel"
    if "\t" in text:
        dialect = "excel-tab"
    reader = csv.reader(io.StringIO(text), dialect=dialect)
    for row in reader:
        if not row or row[0].startswith("#"):
            continue
        if len(row) < 2:
            continue
        desc = row[0].strip()[:300]
        subcat = row[1].strip()[:120]
        if desc and subcat:
            entries.append((desc, subcat))

    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries found. Expected CSV with columns: description,subcategory")

    inserted = await bulk_upsert_embeddings(
        db,
        entries=entries,
        user_id=current_user.id,
        is_global=is_global,
        source="document",
        notes=f"Uploaded from {file.filename or 'unknown'}",
    )
    return {"total_parsed": len(entries), "inserted": inserted}


@router.delete("/knowledge-base/{entry_id}", status_code=204)
async def delete_knowledge_base_entry(
    entry_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    is_admin = is_admin_email(current_user.email)
    stmt = select(ItemEmbedding).where(ItemEmbedding.id == entry_id)
    if not is_admin:
        stmt = stmt.where(ItemEmbedding.user_id == current_user.id)
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Knowledge-base entry not found")
    await db.delete(entry)
