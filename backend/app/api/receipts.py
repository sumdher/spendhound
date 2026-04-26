"""Receipt upload and review API for SpendHound."""

from __future__ import annotations

import asyncio
import uuid

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.bot_detect import block_bots
from app.middleware.rate_limit import limiter
from app.models.receipt import Receipt
from app.models.user import User
from app.services.receipt_extraction import build_statement_preview, create_llm_config, store_upload
from app.services.receipt_queue import ExtractionJob, get_receipt_queue
from app.services.spendhound import ensure_default_categories, serialize_receipt

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("")
async def list_receipts(needs_review: bool | None = Query(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict]:
    statement = select(Receipt).where(Receipt.user_id == current_user.id)
    if needs_review is not None:
        statement = statement.where(Receipt.needs_review.is_(needs_review))
    result = await db.execute(statement.order_by(Receipt.created_at.desc()))
    return [serialize_receipt(receipt) for receipt in result.scalars().all()]


@router.post("/upload")
@limiter.limit(f"{settings.rate_limit_upload_per_minute}/minute")
async def upload_receipt(request: Request, file: UploadFile = File(...), provider: str | None = Form(default=None), model: str | None = Form(default=None), api_key: str | None = Form(default=None), base_url: str | None = Form(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), _bot_check: None = Depends(block_bots)) -> dict:
    await ensure_default_categories(db, current_user.id)
    stored = await store_upload(current_user.id, file)
    filename = file.filename or stored.stored_filename
    llm_config = create_llm_config(provider=provider, model=model, api_key=api_key, base_url=base_url)
    receipt = Receipt(
        user_id=current_user.id,
        original_filename=filename,
        stored_filename=stored.stored_filename,
        content_type=file.content_type,
        file_size=stored.file_size,
        storage_path=stored.storage_path,
        ocr_text=None,
        preview_data=None,
        extraction_confidence=0.0,
        document_kind="receipt",
        extraction_status="pending",
        needs_review=True,
    )
    db.add(receipt)
    await db.flush()
    await db.refresh(receipt)

    job = ExtractionJob(
        receipt_id=receipt.id,
        user_id=current_user.id,
        stored=stored,
        content_type=file.content_type,
        filename=filename,
        llm_config=llm_config,
    )
    try:
        get_receipt_queue().put_nowait(job)
    except asyncio.QueueFull:
        # Queue is at capacity. Receipt is saved but won't auto-extract.
        # The frontend polls extraction_status and will show it as pending.
        logger.warning(
            "receipt_extraction.queue_full",
            receipt_id=str(receipt.id),
            queue_size=get_receipt_queue().qsize(),
        )
        receipt.extraction_status = "queued_full"
        await db.flush()  # persist status; get_db dependency commits after endpoint returns

    return serialize_receipt(receipt)


@router.post("/upload-statement")
async def upload_statement(file: UploadFile = File(...), provider: str | None = Form(default=None), model: str | None = Form(default=None), api_key: str | None = Form(default=None), base_url: str | None = Form(default=None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    filename = file.filename or "statement.pdf"
    is_pdf = (file.content_type or "") == "application/pdf" or filename.lower().endswith(".pdf")
    if not is_pdf:
        raise HTTPException(status_code=400, detail="Bank statement import currently requires a PDF upload")

    stored = await store_upload(current_user.id, file)
    extraction = await build_statement_preview(
        db,
        current_user,
        storage_path=stored.storage_path,
        content_type=file.content_type,
        filename=filename,
        llm_config=create_llm_config(provider=provider, model=model, api_key=api_key, base_url=base_url),
    )
    preview = extraction.preview
    receipt = Receipt(
        user_id=current_user.id,
        original_filename=filename,
        stored_filename=stored.stored_filename,
        content_type=file.content_type,
        file_size=stored.file_size,
        storage_path=stored.storage_path,
        ocr_text=extraction.extracted_text,
        preview_data=preview.model_dump(),
        extraction_confidence=preview.confidence,
        document_kind="statement",
        extraction_status="review",
        needs_review=True,
        review_notes=preview.notes,
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
