"""
Bounded async queue for background receipt extraction.

Why: asyncio.create_task() is unbounded — 20 simultaneous uploads = 20 concurrent
Ollama calls, completely bypassing the semaphore.  A single queue worker processes
jobs one at a time, naturally serialising Ollama calls through the provider semaphore.

Architecture:
  upload endpoint  ──put_nowait──►  asyncio.Queue  ──get──►  single worker coroutine
                                        (maxsize=N)                  │
                                                           _run_extraction_job()
                                                                     │
                                                            OllamaProvider (semaphore)

Usage:
  - Call set_receipt_queue(queue) from lifespan startup.
  - Call get_receipt_queue() from the upload endpoint to enqueue jobs.
  - asyncio.QueueFull is raised by put_nowait() when the queue is full;
    the endpoint catches this and sets extraction_status = "queued_full".
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import structlog
from sqlalchemy import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.receipt import Receipt
from app.models.user import User
from app.services.llm.base import LLMConfig
from app.services.receipt_extraction import StoredReceipt, build_receipt_preview

logger = structlog.get_logger(__name__)

_receipt_queue: asyncio.Queue[ExtractionJob] | None = None


@dataclass
class ExtractionJob:
    receipt_id: uuid.UUID
    user_id: uuid.UUID
    stored: StoredReceipt
    content_type: str | None
    filename: str
    llm_config: LLMConfig | None


def set_receipt_queue(queue: asyncio.Queue[ExtractionJob]) -> None:
    global _receipt_queue
    _receipt_queue = queue


def get_receipt_queue() -> asyncio.Queue[ExtractionJob]:
    if _receipt_queue is None:
        raise RuntimeError("Receipt queue not initialised — call set_receipt_queue() in lifespan.")
    return _receipt_queue


async def _run_extraction_job(job: ExtractionJob) -> None:
    """Process one extraction job. Called exclusively by the queue worker."""
    try:
        async with AsyncSessionLocal() as db:
            user_result = await db.execute(select(User).where(User.id == job.user_id))
            user = user_result.scalar_one_or_none()
            if user is None:
                return
            extraction = await build_receipt_preview(
                db,
                user,
                storage_path=job.stored.storage_path,
                content_type=job.content_type,
                filename=job.filename,
                llm_config=job.llm_config,
            )
            preview = extraction.preview
            needs_review = (
                preview.confidence < settings.receipt_review_confidence_threshold
                or preview.category_name is None
                or preview.amount is None
                or not preview.merchant
                or preview.expense_date is None
            )
            receipt_result = await db.execute(select(Receipt).where(Receipt.id == job.receipt_id))
            receipt = receipt_result.scalar_one_or_none()
            if receipt is None:
                return
            receipt.ocr_text = extraction.extracted_text
            receipt.preview_data = preview.model_dump()
            receipt.extraction_confidence = preview.confidence
            receipt.extraction_status = "review" if needs_review else "extracted"
            receipt.needs_review = needs_review
            await db.commit()
            logger.info(
                "receipt_extraction.complete",
                receipt_id=str(job.receipt_id),
                status=receipt.extraction_status,
            )
    except Exception as exc:
        logger.warning(
            "receipt_extraction.failed",
            receipt_id=str(job.receipt_id),
            error=str(exc),
        )
        try:
            async with AsyncSessionLocal() as db:
                receipt_result = await db.execute(select(Receipt).where(Receipt.id == job.receipt_id))
                receipt = receipt_result.scalar_one_or_none()
                if receipt:
                    receipt.extraction_status = "error"
                    await db.commit()
        except Exception:
            pass


async def receipt_queue_worker(queue: asyncio.Queue[ExtractionJob]) -> None:
    """
    Single background coroutine — drains the queue sequentially.
    Runs for the lifetime of the process; cancelled on shutdown.
    """
    logger.info(
        "receipt_queue.worker.started",
        maxsize=queue.maxsize,
    )
    while True:
        job: ExtractionJob = await queue.get()
        logger.debug(
            "receipt_queue.worker.processing",
            receipt_id=str(job.receipt_id),
            queue_remaining=queue.qsize(),
        )
        try:
            await _run_extraction_job(job)
        finally:
            queue.task_done()
