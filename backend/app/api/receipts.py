"""Receipt upload and review API for SpendHound."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.receipt import Receipt
from app.models.user import User
from app.services.receipt_extraction import build_receipt_preview, create_llm_config, store_upload
from app.services.spendhound import ensure_default_categories, serialize_receipt

router = APIRouter()


@router.get("")
async def list_receipts(needs_review: bool | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    statement = select(Receipt).where(Receipt.user_id == current_user.id)
    if needs_review is not None:
        statement = statement.where(Receipt.needs_review.is_(needs_review))
    result = await db.execute(statement.order_by(Receipt.created_at.desc()))
    return [serialize_receipt(receipt) for receipt in result.scalars().all()]


@router.post("/upload")
async def upload_receipt(file: UploadFile = File(...), provider: str | None = Form(default=None), model: str | None = Form(default=None), api_key: str | None = Form(default=None), base_url: str | None = Form(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    await ensure_default_categories(db, current_user.id)
    stored = await store_upload(current_user.id, file)
    extraction = await build_receipt_preview(
        db,
        current_user.id,
        storage_path=stored.storage_path,
        content_type=file.content_type,
        filename=file.filename or stored.stored_filename,
        llm_config=create_llm_config(provider=provider, model=model, api_key=api_key, base_url=base_url),
    )
    preview = extraction.preview
    needs_review = (
        preview.confidence < settings.receipt_review_confidence_threshold
        or preview.category_name is None
        or preview.amount is None
        or not preview.merchant
        or preview.expense_date is None
    )
    receipt = Receipt(
        user_id=current_user.id,
        original_filename=file.filename or stored.stored_filename,
        stored_filename=stored.stored_filename,
        content_type=file.content_type,
        file_size=stored.file_size,
        storage_path=stored.storage_path,
        ocr_text=extraction.extracted_text,
        preview_data=preview.model_dump(),
        extraction_confidence=preview.confidence,
        extraction_status="review" if needs_review else "extracted",
        needs_review=needs_review,
    )
    db.add(receipt)
    await db.flush()
    await db.refresh(receipt)
    return serialize_receipt(receipt)


@router.get("/{receipt_id}")
async def get_receipt(receipt_id: uuid.UUID, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == current_user.id))
    receipt = result.scalar_one_or_none()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return serialize_receipt(receipt)
