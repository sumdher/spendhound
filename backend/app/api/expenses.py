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

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.category import Category
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.user import User
from app.services.spendhound import apply_expense_filters, ensure_default_categories, expense_requires_review, normalize_money, recompute_recurring_expenses, resolve_category, serialize_expense

router = APIRouter()


class ExpenseCreate(BaseModel):
    merchant: str
    description: str | None = None
    amount: float
    currency: str = "EUR"
    expense_date: str
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    notes: str | None = None


class ExpenseUpdate(BaseModel):
    merchant: str | None = None
    description: str | None = None
    amount: float | None = None
    currency: str | None = None
    expense_date: str | None = None
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    notes: str | None = None
    needs_review: bool | None = None


class ReceiptExpenseCreate(ExpenseCreate):
    receipt_id: uuid.UUID
    confidence: float | None = None


@router.get("")
async def list_expenses(month: str | None = Query(default=None), category_id: uuid.UUID | None = Query(default=None), review_only: bool = Query(default=False), search: str | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    statement = select(Expense, Category.name, Receipt.original_filename).outerjoin(Category, Category.id == Expense.category_id).outerjoin(Receipt, Receipt.id == Expense.receipt_id)
    statement = apply_expense_filters(statement, user_id=current_user.id, month=month, category_id=category_id, review_only=review_only, search=search).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    result = await db.execute(statement)
    items = [serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename) for expense, category_name, receipt_filename in result.all()]

    count_statement = apply_expense_filters(select(func.count(Expense.id)), user_id=current_user.id, month=month, category_id=category_id, review_only=review_only, search=search)
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
    statement = apply_expense_filters(select(Expense, Category.name, Receipt.original_filename).outerjoin(Category, Category.id == Expense.category_id).outerjoin(Receipt, Receipt.id == Expense.receipt_id), user_id=current_user.id, month=month).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    result = await db.execute(statement)
    items = [serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename) for expense, category_name, receipt_filename in result.all()]
    exported_at = datetime.now(timezone.utc).isoformat()

    if format == "csv":
        output = io.StringIO()
        fieldnames = ["id", "expense_date", "merchant", "description", "amount", "currency", "category_name", "source", "needs_review", "is_recurring", "receipt_filename", "notes"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows({key: item.get(key) for key in fieldnames} for item in items)
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=spendhound-expenses.csv"})

    return JSONResponse({"exported_at": exported_at, "total": len(items), "items": items})


@router.post("")
async def create_expense(body: ExpenseCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    await ensure_default_categories(db, current_user.id)
    category = await resolve_category(db, current_user.id, category_id=body.category_id, category_name=body.category_name, merchant=body.merchant)
    expense = Expense(
        user_id=current_user.id,
        merchant=body.merchant.strip(),
        description=body.description,
        amount=normalize_money(body.amount),
        currency=body.currency,
        expense_date=datetime.fromisoformat(body.expense_date).date(),
        category_id=category.id if category else None,
        notes=body.notes,
        source="manual",
        confidence=1.0,
        needs_review=expense_requires_review(category, 1.0, "manual"),
    )
    db.add(expense)
    await db.flush()
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    return serialize_expense(expense, category_name=category.name if category else None)


@router.post("/from-receipt")
async def create_expense_from_receipt(body: ReceiptExpenseCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    receipt_result = await db.execute(select(Receipt).where(Receipt.id == body.receipt_id, Receipt.user_id == current_user.id))
    receipt = receipt_result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")

    category = await resolve_category(db, current_user.id, category_id=body.category_id, category_name=body.category_name, merchant=body.merchant)
    confidence = body.confidence if body.confidence is not None else receipt.extraction_confidence or 0.5
    expense = Expense(
        user_id=current_user.id,
        merchant=body.merchant.strip(),
        description=body.description,
        amount=normalize_money(body.amount),
        currency=body.currency,
        expense_date=datetime.fromisoformat(body.expense_date).date(),
        category_id=category.id if category else None,
        receipt_id=receipt.id,
        notes=body.notes,
        source="receipt",
        confidence=confidence,
        needs_review=expense_requires_review(category, confidence, "receipt"),
    )
    db.add(expense)
    receipt.preview_data = {
        "merchant": body.merchant,
        "amount": body.amount,
        "currency": body.currency,
        "expense_date": body.expense_date,
        "description": body.description,
        "category_name": category.name if category else body.category_name,
        "notes": body.notes,
        "confidence": confidence,
    }
    receipt.needs_review = expense.needs_review
    receipt.extraction_status = "finalized"
    receipt.finalized_at = datetime.now(timezone.utc)
    await db.flush()
    await recompute_recurring_expenses(db, current_user.id)
    await db.refresh(expense)
    return serialize_expense(expense, category_name=category.name if category else None, receipt_filename=receipt.original_filename)


@router.get("/{expense_id}")
async def get_expense(expense_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Expense, Category.name, Receipt.original_filename).outerjoin(Category, Category.id == Expense.category_id).outerjoin(Receipt, Receipt.id == Expense.receipt_id).where(Expense.id == expense_id, Expense.user_id == current_user.id))
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    expense, category_name, receipt_filename = row
    return serialize_expense(expense, category_name=category_name, receipt_filename=receipt_filename)


@router.patch("/{expense_id}")
async def update_expense(expense_id: uuid.UUID, body: ExpenseUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Expense).where(Expense.id == expense_id, Expense.user_id == current_user.id))
    expense = result.scalar_one_or_none()
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")

    data = body.model_dump(exclude_unset=True)
    if {"category_id", "category_name", "merchant"} & set(data):
        category_id = data.get("category_id") if "category_id" in data else None
        category_name = data.get("category_name") if "category_name" in data else None
        merchant = data.get("merchant", expense.merchant)
        if "category_id" in data or "category_name" in data:
            category = await resolve_category(db, current_user.id, category_id=category_id, category_name=category_name, merchant=merchant)
        else:
            category = await resolve_category(db, current_user.id, category_id=expense.category_id, merchant=merchant)
        expense.category_id = category.id if category else None
    for field, value in data.items():
        if field == "amount" and value is not None:
            expense.amount = normalize_money(value)
        elif field == "expense_date" and value is not None:
            expense.expense_date = datetime.fromisoformat(value).date()
        elif field not in {"category_id", "category_name"}:
            setattr(expense, field, value)

    current_category = None
    if expense.category_id:
        category_result = await db.execute(select(Category).where(Category.id == expense.category_id, Category.user_id == current_user.id))
        current_category = category_result.scalar_one_or_none()
    expense.needs_review = body.needs_review if body.needs_review is not None else expense_requires_review(current_category, expense.confidence, expense.source)
    await db.flush()
    await recompute_recurring_expenses(db, current_user.id)
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
