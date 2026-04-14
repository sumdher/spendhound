"""Expense API for SpendHound."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.category import Category
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.user import User
from app.services.report_exports import build_expense_export_payload
from app.services.spendhound import CADENCE_ONE_TIME, TRANSACTION_TYPE_DEBIT, apply_expense_filters, ensure_default_categories, expense_requires_review, normalize_cadence, normalize_money, normalize_recurring_settings, normalize_transaction_type, recompute_recurring_expenses, replace_expense_items, resolve_category, serialize_expense, serialize_receipt

router = APIRouter()


def _parse_cadence_override(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip().lower().replace("-", "_").replace(" ", "_")
    if cleaned in {"", "auto", "automatic", "detect", "detected"}:
        return None
    return normalize_cadence(value)


def _normalize_major_purchase(value: bool | None, *, transaction_type: str) -> bool:
    return bool(value) and normalize_transaction_type(transaction_type) == TRANSACTION_TYPE_DEBIT


async def _get_existing_receipt_expense(db: AsyncSession, *, user_id: uuid.UUID, receipt_id: uuid.UUID, source: str = "receipt") -> tuple[Expense, str | None] | None:
    result = await db.execute(
        select(Expense, Category.name)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(Expense.user_id == user_id, Expense.receipt_id == receipt_id, Expense.source == source)
        .order_by(Expense.created_at.asc())
        .limit(1)
    )
    return result.first()


async def _get_expense_with_category_name(db: AsyncSession, *, user_id: uuid.UUID, expense_id: uuid.UUID) -> tuple[Expense, str | None] | None:
    result = await db.execute(
        select(Expense, Category.name)
        .outerjoin(Category, Category.id == Expense.category_id)
        .where(Expense.user_id == user_id, Expense.id == expense_id)
        .limit(1)
    )
    return result.first()


class ExpenseCreate(BaseModel):
    merchant: str
    description: str | None = None
    amount: float
    transaction_type: str = TRANSACTION_TYPE_DEBIT
    currency: str = "EUR"
    expense_date: str
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    notes: str | None = None
    items: list[dict] | None = None
    cadence: str | None = None
    recurring_variable: bool = False
    recurring_auto_add: bool = False
    is_major_purchase: bool = False


class ExpenseUpdate(BaseModel):
    merchant: str | None = None
    description: str | None = None
    amount: float | None = None
    transaction_type: str | None = None
    currency: str | None = None
    expense_date: str | None = None
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    notes: str | None = None
    needs_review: bool | None = None
    cadence: str | None = None
    recurring_variable: bool | None = None
    recurring_auto_add: bool | None = None
    is_major_purchase: bool | None = None


class ReceiptExpenseCreate(ExpenseCreate):
    receipt_id: uuid.UUID
    confidence: float | None = None


class StatementExpenseCreate(ExpenseCreate):
    receipt_id: uuid.UUID
    entry_index: int
    confidence: float | None = None


@router.get("")
async def list_expenses(month: str | None = Query(default=None), category_id: uuid.UUID | None = Query(default=None), transaction_type: str | None = Query(default=None), cadence: str | None = Query(default=None), review_only: bool = Query(default=False), search: str | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    statement = select(Expense, Category.name, Receipt.original_filename).outerjoin(Category, Category.id == Expense.category_id).outerjoin(Receipt, Receipt.id == Expense.receipt_id)
    statement = apply_expense_filters(statement, user_id=current_user.id, month=month, category_id=category_id, transaction_type=transaction_type, cadence=cadence, review_only=review_only, search=search).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    result = await db.execute(statement)
    items = [serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename) for expense, category_name, receipt_filename in result.all()]

    count_statement = apply_expense_filters(select(func.count(Expense.id)), user_id=current_user.id, month=month, category_id=category_id, transaction_type=transaction_type, cadence=cadence, review_only=review_only, search=search)
    total = (await db.execute(count_statement)).scalar_one()
    return {"items": items, "total": int(total)}


@router.get("/review-queue")
async def review_queue(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    receipt_result = await db.execute(select(Receipt).where(Receipt.user_id == current_user.id, (Receipt.needs_review.is_(True)) | (Receipt.extraction_status != "finalized")).order_by(Receipt.created_at.desc()))
    expense_result = await db.execute(
        select(Expense, Category.name, Receipt.original_filename)
        .outerjoin(Category, Category.id == Expense.category_id)
        .outerjoin(Receipt, Receipt.id == Expense.receipt_id)
        .where(Expense.user_id == current_user.id, (Expense.needs_review.is_(True)) | (Expense.category_id.is_(None)))
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    )
    return {
        "receipts": [
            {
                "id": str(receipt.id),
                "original_filename": receipt.original_filename,
                "preview": receipt.preview_data,
                "document_kind": receipt.document_kind,
                "needs_review": receipt.needs_review,
                "extraction_status": receipt.extraction_status,
                "created_at": receipt.created_at.isoformat(),
            }
            for receipt in receipt_result.scalars().all()
        ],
        "expenses": [serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename) for expense, category_name, receipt_filename in expense_result.all()],
    }


@router.get("/export")
async def export_expenses(format: str = Query(default="json"), month: str | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    export_payload = await build_expense_export_payload(db, user_id=current_user.id, month=month)
    items = export_payload["items"]

    if format == "csv":
        output = io.StringIO()
        fieldnames = ["id", "expense_date", "merchant", "description", "amount", "signed_amount", "transaction_type", "currency", "cadence", "cadence_override", "is_major_purchase", "category_name", "source", "needs_review", "is_recurring", "receipt_filename", "notes"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows({key: item.get(key) for key in fieldnames} for item in items)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=spendhound-expenses.csv"})

    return JSONResponse(export_payload)


@router.post("")
async def create_expense(body: ExpenseCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    await ensure_default_categories(db, current_user.id)
    transaction_type = normalize_transaction_type(body.transaction_type)
    cadence_override = _parse_cadence_override(body.cadence)
    recurring_variable, recurring_auto_add = normalize_recurring_settings(
        cadence_override or CADENCE_ONE_TIME,
        recurring_variable=body.recurring_variable,
        recurring_auto_add=body.recurring_auto_add,
    )
    category = await resolve_category(db, current_user.id, category_id=body.category_id, category_name=body.category_name, merchant=body.merchant, transaction_type=transaction_type)
    expense = Expense(
        user_id=current_user.id,
        merchant=body.merchant.strip(),
        description=body.description,
        amount=normalize_money(body.amount),
        transaction_type=transaction_type,
        currency=body.currency,
        expense_date=datetime.fromisoformat(body.expense_date).date(),
        category_id=category.id if category else None,
        notes=body.notes,
        source="manual",
        confidence=1.0,
        needs_review=expense_requires_review(category, 1.0, "manual"),
        cadence=cadence_override or CADENCE_ONE_TIME,
        cadence_override=cadence_override,
        recurring_variable=recurring_variable,
        recurring_auto_add=recurring_auto_add,
        is_major_purchase=_normalize_major_purchase(body.is_major_purchase, transaction_type=transaction_type),
    )
    db.add(expense)
    await db.flush()
    await replace_expense_items(db, expense, body.items, category_name=category.name if category else body.category_name)
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    return serialize_expense(expense, category_name=category.name if category else None)


@router.post("/from-receipt")
async def create_expense_from_receipt(body: ReceiptExpenseCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    receipt_result = await db.execute(select(Receipt).where(Receipt.id == body.receipt_id, Receipt.user_id == current_user.id).with_for_update())
    receipt = receipt_result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if receipt.document_kind != "receipt":
        raise HTTPException(status_code=400, detail="This document is not a receipt upload")

    existing_expense_row = await _get_existing_receipt_expense(db, user_id=current_user.id, receipt_id=receipt.id)
    if existing_expense_row is not None:
        existing_expense, existing_category_name = existing_expense_row
        if receipt.extraction_status != "finalized":
            receipt.extraction_status = "finalized"
            receipt.needs_review = existing_expense.needs_review
            receipt.finalized_at = receipt.finalized_at or datetime.now(timezone.utc)
            await db.flush()
        return serialize_expense(existing_expense, category_name=existing_category_name, receipt_filename=receipt.original_filename)

    if receipt.extraction_status == "finalized":
        raise HTTPException(status_code=409, detail="Receipt has already been finalized")

    transaction_type = normalize_transaction_type(body.transaction_type)
    cadence_override = _parse_cadence_override(body.cadence)
    recurring_variable, recurring_auto_add = normalize_recurring_settings(
        cadence_override or CADENCE_ONE_TIME,
        recurring_variable=body.recurring_variable,
        recurring_auto_add=body.recurring_auto_add,
    )
    category = await resolve_category(db, current_user.id, category_id=body.category_id, category_name=body.category_name, merchant=body.merchant, transaction_type=transaction_type)
    confidence = body.confidence if body.confidence is not None else receipt.extraction_confidence or 0.5
    expense = Expense(
        user_id=current_user.id,
        merchant=body.merchant.strip(),
        description=body.description,
        amount=normalize_money(body.amount),
        transaction_type=transaction_type,
        currency=body.currency,
        expense_date=datetime.fromisoformat(body.expense_date).date(),
        category_id=category.id if category else None,
        receipt_id=receipt.id,
        notes=body.notes,
        source="receipt",
        confidence=confidence,
        needs_review=expense_requires_review(category, confidence, "receipt"),
        cadence=cadence_override or CADENCE_ONE_TIME,
        cadence_override=cadence_override,
        recurring_variable=recurring_variable,
        recurring_auto_add=recurring_auto_add,
        is_major_purchase=_normalize_major_purchase(body.is_major_purchase, transaction_type=transaction_type),
    )
    db.add(expense)
    receipt.preview_data = {
        "merchant": body.merchant,
        "amount": body.amount,
        "transaction_type": transaction_type,
        "currency": body.currency,
        "expense_date": body.expense_date,
        "description": body.description,
        "category_name": category.name if category else body.category_name,
        "notes": body.notes,
        "cadence": cadence_override or CADENCE_ONE_TIME,
        "recurring_variable": recurring_variable,
        "recurring_auto_add": recurring_auto_add,
        "is_major_purchase": _normalize_major_purchase(body.is_major_purchase, transaction_type=transaction_type),
        "items": body.items if body.items is not None else (receipt.preview_data or {}).get("items", []),
        "confidence": confidence,
    }
    receipt.needs_review = expense.needs_review
    receipt.extraction_status = "finalized"
    receipt.finalized_at = datetime.now(timezone.utc)
    await db.flush()
    await replace_expense_items(db, expense, body.items if body.items is not None else (receipt.preview_data or {}).get("items", []), category_name=category.name if category else body.category_name)
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    return serialize_expense(expense, category_name=category.name if category else None, receipt_filename=receipt.original_filename)


@router.post("/from-statement-entry")
async def create_expense_from_statement_entry(body: StatementExpenseCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    receipt_result = await db.execute(select(Receipt).where(Receipt.id == body.receipt_id, Receipt.user_id == current_user.id).with_for_update())
    receipt = receipt_result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Statement import not found")
    if receipt.document_kind != "statement":
        raise HTTPException(status_code=400, detail="This document is not a statement import")

    preview_data = dict(receipt.preview_data or {})
    entries = list(preview_data.get("entries") or [])
    if body.entry_index < 0 or body.entry_index >= len(entries):
        raise HTTPException(status_code=400, detail="Statement entry index is out of range")
    entry = dict(entries[body.entry_index] or {})
    if entry.get("status") == "finalized":
        saved_expense_id = entry.get("saved_expense_id")
        if saved_expense_id:
            existing_expense_row = await _get_expense_with_category_name(db, user_id=current_user.id, expense_id=uuid.UUID(str(saved_expense_id)))
            if existing_expense_row is not None:
                existing_expense, existing_category_name = existing_expense_row
                return {
                    "expense": serialize_expense(existing_expense, category_name=existing_category_name, receipt_filename=receipt.original_filename),
                    "statement": serialize_receipt(receipt),
                }
        raise HTTPException(status_code=409, detail="Statement entry has already been finalized")

    transaction_type = normalize_transaction_type(body.transaction_type)
    cadence_override = _parse_cadence_override(body.cadence)
    recurring_variable, recurring_auto_add = normalize_recurring_settings(
        cadence_override or CADENCE_ONE_TIME,
        recurring_variable=body.recurring_variable,
        recurring_auto_add=body.recurring_auto_add,
    )
    category = await resolve_category(db, current_user.id, category_id=body.category_id, category_name=body.category_name, merchant=body.merchant, transaction_type=transaction_type)
    confidence = body.confidence if body.confidence is not None else float(entry.get("confidence") or receipt.extraction_confidence or 0.5)
    expense = Expense(
        user_id=current_user.id,
        merchant=body.merchant.strip(),
        description=body.description,
        amount=normalize_money(body.amount),
        transaction_type=transaction_type,
        currency=body.currency,
        expense_date=datetime.fromisoformat(body.expense_date).date(),
        category_id=category.id if category else None,
        receipt_id=receipt.id,
        notes=body.notes,
        source="statement",
        confidence=confidence,
        needs_review=expense_requires_review(category, confidence, "statement"),
        cadence=cadence_override or CADENCE_ONE_TIME,
        cadence_override=cadence_override,
        recurring_variable=recurring_variable,
        recurring_auto_add=recurring_auto_add,
        is_major_purchase=_normalize_major_purchase(body.is_major_purchase, transaction_type=transaction_type),
    )
    db.add(expense)
    await db.flush()

    entry.update(
        {
            "merchant": body.merchant,
            "amount": body.amount,
            "transaction_type": transaction_type,
            "currency": body.currency,
            "expense_date": body.expense_date,
            "description": body.description,
            "category_name": category.name if category else body.category_name,
            "notes": body.notes,
            "cadence": cadence_override or CADENCE_ONE_TIME,
            "recurring_variable": recurring_variable,
            "recurring_auto_add": recurring_auto_add,
            "is_major_purchase": _normalize_major_purchase(body.is_major_purchase, transaction_type=transaction_type),
            "confidence": confidence,
            "status": "finalized",
            "saved_expense_id": str(expense.id),
        }
    )
    entries[body.entry_index] = entry
    preview_data["entries"] = entries
    receipt.preview_data = preview_data
    has_pending = any((candidate or {}).get("status") != "finalized" for candidate in entries)
    receipt.extraction_status = "review" if has_pending else "finalized"
    receipt.needs_review = has_pending or expense.needs_review
    receipt.finalized_at = None if has_pending else datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(receipt)
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    return {
        "expense": serialize_expense(expense, category_name=category.name if category else None, receipt_filename=receipt.original_filename),
        "statement": serialize_receipt(receipt),
    }


@router.get("/{expense_id}")
async def get_expense(expense_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(Expense)
        .options(selectinload(Expense.items), selectinload(Expense.receipt))
        .where(Expense.id == expense_id, Expense.user_id == current_user.id)
    )
    expense = result.scalar_one_or_none()
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    category_name = None
    if expense.category_id:
        category_result = await db.execute(select(Category.name).where(Category.id == expense.category_id, Category.user_id == current_user.id))
        category_name = category_result.scalar_one_or_none()
    receipt = expense.receipt
    return serialize_expense(
        expense,
        category_name=category_name,
        receipt_filename=receipt.original_filename if receipt else None,
        include_items=True,
        receipt_preview=receipt.preview_data if receipt else None,
        receipt_document_kind=receipt.document_kind if receipt else None,
        receipt_ocr_text=receipt.ocr_text if receipt else None,
    )


@router.patch("/{expense_id}")
async def update_expense(expense_id: uuid.UUID, body: ExpenseUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Expense).where(Expense.id == expense_id, Expense.user_id == current_user.id))
    expense = result.scalar_one_or_none()
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")

    data = body.model_dump(exclude_unset=True)
    next_transaction_type = normalize_transaction_type(data.get("transaction_type"), default=expense.transaction_type)
    next_cadence = _parse_cadence_override(data.get("cadence")) if "cadence" in data else (expense.cadence_override or expense.cadence)
    recurring_variable, recurring_auto_add = normalize_recurring_settings(
        next_cadence,
        recurring_variable=data.get("recurring_variable", expense.recurring_variable),
        recurring_auto_add=data.get("recurring_auto_add", expense.recurring_auto_add),
    )
    if "cadence" in data:
        expense.cadence_override = _parse_cadence_override(data.get("cadence"))
    expense.recurring_variable = recurring_variable
    expense.recurring_auto_add = recurring_auto_add
    if {"category_id", "category_name", "merchant", "transaction_type"} & set(data):
        category_id = data.get("category_id") if "category_id" in data else None
        category_name = data.get("category_name") if "category_name" in data else None
        merchant = data.get("merchant", expense.merchant)
        if "category_id" in data or "category_name" in data:
            category = await resolve_category(db, current_user.id, category_id=category_id, category_name=category_name, merchant=merchant, transaction_type=next_transaction_type)
        else:
            category = await resolve_category(db, current_user.id, category_id=expense.category_id, merchant=merchant, transaction_type=next_transaction_type)
        expense.category_id = category.id if category else None
    for field, value in data.items():
        if field == "amount" and value is not None:
            expense.amount = normalize_money(value)
        elif field == "transaction_type" and value is not None:
            expense.transaction_type = normalize_transaction_type(value)
        elif field == "expense_date" and value is not None:
            expense.expense_date = datetime.fromisoformat(value).date()
        elif field == "is_major_purchase":
            expense.is_major_purchase = _normalize_major_purchase(value, transaction_type=next_transaction_type)
        elif field == "cadence":
            continue
        elif field in {"recurring_variable", "recurring_auto_add"}:
            continue
        elif field not in {"category_id", "category_name"}:
            setattr(expense, field, value)

    current_category = None
    if expense.category_id:
        category_result = await db.execute(select(Category).where(Category.id == expense.category_id, Category.user_id == current_user.id))
        current_category = category_result.scalar_one_or_none()
    expense.needs_review = body.needs_review if body.needs_review is not None else expense_requires_review(current_category, expense.confidence, expense.source)
    await db.flush()
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    receipt_filename = None
    if expense.receipt_id:
        receipt_result = await db.execute(select(Receipt.original_filename).where(Receipt.id == expense.receipt_id))
        receipt_filename = receipt_result.scalar_one_or_none()
    return serialize_expense(expense, category_name=current_category.name if current_category else None, receipt_filename=receipt_filename)


@router.delete("/{expense_id}", status_code=204)
async def delete_expense(expense_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Expense).where(Expense.id == expense_id, Expense.user_id == current_user.id))
    expense = result.scalar_one_or_none()
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    await db.delete(expense)
    await db.flush()
    await recompute_recurring_expenses(db, current_user.id)
