"""Receipt storage, OCR, and validated extraction helpers for SpendHound."""

from __future__ import annotations

import base64
import json
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from fastapi import UploadFile
from pydantic import BaseModel, Field
import pdfplumber
from pypdf import PdfReader
import structlog

from app.config import settings
from app.services.llm.base import ImageInput, LLMConfig, Message
from app.services.llm.factory import get_llm_provider
from app.services.spendhound import resolve_category


logger = structlog.get_logger(__name__)


class ReceiptPreviewItemModel(BaseModel):
    description: str | None = Field(default="")
    quantity: float | None = Field(default=None)
    unit_price: float | None = Field(default=None)
    total: float | None = Field(default=None)
    subcategory: str | None = Field(default=None)
    subcategory_confidence: float | None = Field(default=None, ge=0, le=1)


class ReceiptPreviewModel(BaseModel):
    merchant: str | None = Field(default=None)
    amount: float | None = Field(default=None)
    currency: str | None = Field(default=settings.default_currency)
    expense_date: str | None = Field(default=None)
    description: str | None = Field(default=None)
    category_name: str | None = Field(default=None)
    notes: str | None = Field(default=None)
    items: list[ReceiptPreviewItemModel] | None = Field(default_factory=list)
    confidence: float | None = Field(default=0.35, ge=0, le=1)


class StatementPreviewEntryModel(BaseModel):
    merchant: str | None = Field(default=None)
    amount: float | None = Field(default=None)
    currency: str | None = Field(default=settings.default_currency)
    expense_date: str | None = Field(default=None)
    description: str | None = Field(default=None)
    category_name: str | None = Field(default=None)
    notes: str | None = Field(default=None)
    confidence: float | None = Field(default=0.45, ge=0, le=1)
    status: str | None = Field(default="pending")
    saved_expense_id: str | None = Field(default=None)


class StatementPreviewModel(BaseModel):
    summary: str | None = Field(default=None)
    notes: str | None = Field(default=None)
    confidence: float | None = Field(default=0.45, ge=0, le=1)
    entries: list[StatementPreviewEntryModel] = Field(default_factory=list)


@dataclass
class StoredReceipt:
    stored_filename: str
    storage_path: str
    file_size: int


@dataclass
class ReceiptExtractionResult:
    preview: ReceiptPreviewModel | StatementPreviewModel
    extracted_text: str | None = None
    used_text_fallback: bool = False


async def store_upload(user_id: uuid.UUID, upload: UploadFile) -> StoredReceipt:
    receipt_dir = Path(settings.receipt_storage_dir) / str(user_id)
    receipt_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "receipt").suffix
    stored_filename = f"{uuid.uuid4()}{suffix}"
    target_path = receipt_dir / stored_filename
    content = await upload.read()
    target_path.write_bytes(content)
    return StoredReceipt(stored_filename=stored_filename, storage_path=str(target_path), file_size=len(content))


async def extract_text_from_file(storage_path: str, content_type: str | None) -> str:
    path = Path(storage_path)
    file_bytes = path.read_bytes()
    if (content_type or "").startswith("text/"):
        return file_bytes.decode("utf-8", errors="ignore").strip()
    if path.suffix.lower() == ".pdf":
        plumber_text: list[str] = []
        try:
            with pdfplumber.open(storage_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text(layout=True) or page.extract_text() or ""
                    if page_text.strip():
                        plumber_text.append(page_text)
        except Exception:
            plumber_text = []
        if plumber_text:
            return "\n\n".join(plumber_text).strip()
        try:
            reader = PdfReader(storage_path)
            return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        except Exception:
            return ""
    return ""


def _is_supported_image(content_type: str | None, filename: str) -> bool:
    if (content_type or "").startswith("image/"):
        return True
    return Path(filename).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def _normalize_currency(value: str | None) -> str:
    currency = (value or settings.default_currency).strip().upper()
    return currency[:8] or settings.default_currency


def _normalize_items(items: list[ReceiptPreviewItemModel] | None) -> list[ReceiptPreviewItemModel]:
    normalized: list[ReceiptPreviewItemModel] = []
    for item in (items or [])[:50]:
        cleaned = ReceiptPreviewItemModel.model_validate(item)
        cleaned.description = (cleaned.description or "").strip()[:300]
        if not cleaned.description and cleaned.total is None:
            continue
        for field_name in ("quantity", "unit_price", "total"):
            value = getattr(cleaned, field_name)
            if value is not None:
                try:
                    parsed = float(Decimal(str(value)).quantize(Decimal("0.01")))
                except (InvalidOperation, ValueError):
                    parsed = None
                setattr(cleaned, field_name, parsed)
        if cleaned.subcategory:
            cleaned.subcategory = cleaned.subcategory.strip()[:120] or None
        if cleaned.subcategory_confidence is not None:
            cleaned.subcategory_confidence = min(max(cleaned.subcategory_confidence, 0.0), 1.0)
        normalized.append(cleaned)
    return normalized


def _normalize_statement_entries(entries: list[StatementPreviewEntryModel] | None) -> list[StatementPreviewEntryModel]:
    normalized: list[StatementPreviewEntryModel] = []
    for entry in (entries or [])[:200]:
        cleaned = StatementPreviewEntryModel.model_validate(entry)
        if cleaned.amount is not None:
            try:
                cleaned.amount = abs(float(Decimal(str(cleaned.amount)).quantize(Decimal("0.01"))))
            except (InvalidOperation, ValueError):
                cleaned.amount = None
        cleaned.currency = _normalize_currency(cleaned.currency)
        cleaned.expense_date = _parse_date_candidate(cleaned.expense_date)
        cleaned.merchant = (cleaned.merchant or "").strip()[:255] or None
        cleaned.description = (cleaned.description or "").strip()[:300] or None
        cleaned.category_name = (cleaned.category_name or "").strip()[:120] or None
        cleaned.notes = (cleaned.notes or "").strip()[:2000] or None
        cleaned.status = cleaned.status if cleaned.status in {"pending", "finalized"} else "pending"
        cleaned.confidence = min(max(cleaned.confidence if cleaned.confidence is not None else 0.45, 0.0), 1.0)
        if cleaned.amount is None or not cleaned.merchant or cleaned.expense_date is None:
            continue
        normalized.append(cleaned)
    return normalized


def _parse_date_candidate(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip().replace("/", "-")
    if re.fullmatch(r"\d{2}-\d{2}-\d{2}", candidate):
        day, month, year = candidate.split("-")
        return f"20{year}-{month}-{day}"
    if re.fullmatch(r"\d{2}-\d{2}-\d{4}", candidate):
        day, month, year = candidate.split("-")
        return f"{year}-{month}-{day}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
        return candidate
    return None


def _parse_amount_candidate(value: str | None) -> float | None:
    if not value:
        return None
    candidate = value.strip().replace(" ", "")
    if "," in candidate and "." in candidate:
        if candidate.rfind(",") > candidate.rfind("."):
            candidate = candidate.replace(".", "").replace(",", ".")
        else:
            candidate = candidate.replace(",", "")
    else:
        candidate = candidate.replace(",", ".")
    candidate = re.sub(r"[^0-9\.-]", "", candidate)
    if not candidate:
        return None
    try:
        return abs(float(Decimal(candidate).quantize(Decimal("0.01"))))
    except (InvalidOperation, ValueError):
        return None


def _merchant_hint_from_filename(filename: str) -> str | None:
    stem = Path(filename).stem
    normalized = re.sub(r"[_\-.]+", " ", stem)
    normalized = re.sub(r"\b\d{4}[-_ ]?\d{2}[-_ ]?\d{2}\b", " ", normalized)
    normalized = re.sub(r"\b\d+\b", " ", normalized)
    tokens = [token for token in normalized.split() if token]
    generic_tokens = {"receipt", "image", "img", "scan", "document", "photo", "picture", "file"}
    filtered = [token for token in tokens if token.lower() not in generic_tokens]
    candidate = " ".join(filtered).strip()
    if len(candidate) < 2:
        return None
    return candidate.title()[:255]


def _preview_context_defaults(*, filename: str | None, context_text: str | None) -> dict[str, str | float | None]:
    text = (context_text or "").strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    amount = None
    amount_match = re.search(r"(?:€|EUR|\$)?\s*(\d+[\.,]\d{2})", text)
    if amount_match:
        try:
            amount = float(amount_match.group(1).replace(",", "."))
        except ValueError:
            amount = None

    date_source = text
    if filename:
        date_source = f"{date_source}\n{filename}".strip()
    date_match = re.search(r"(\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})", date_source)
    expense_date = _parse_date_candidate(date_match.group(1)) if date_match else None

    merchant = lines[0][:255] if lines else None
    if not merchant and filename:
        merchant = _merchant_hint_from_filename(filename)

    description = lines[1][:300] if len(lines) > 1 else None
    return {
        "merchant": merchant,
        "amount": amount,
        "expense_date": expense_date,
        "description": description,
    }


def _finalize_preview_model(model: ReceiptPreviewModel, *, filename: str | None = None, context_text: str | None = None) -> ReceiptPreviewModel:
    defaults = _preview_context_defaults(filename=filename, context_text=context_text)
    if not model.merchant:
        model.merchant = defaults["merchant"] if isinstance(defaults["merchant"], str) else None
    if model.amount is not None:
        try:
            amount = float(Decimal(str(model.amount)).quantize(Decimal("0.01")))
            model.amount = amount if amount > 0 else None
        except (InvalidOperation, ValueError):
            model.amount = None
    elif isinstance(defaults["amount"], float):
        model.amount = defaults["amount"]
    model.currency = _normalize_currency(model.currency)
    if model.merchant:
        model.merchant = model.merchant.strip()[:255]
    parsed_expense_date = _parse_date_candidate(model.expense_date)
    model.expense_date = parsed_expense_date or (defaults["expense_date"] if isinstance(defaults["expense_date"], str) else None)
    if model.description:
        model.description = model.description.strip()[:300]
    elif isinstance(defaults["description"], str):
        model.description = defaults["description"]
    if model.category_name:
        model.category_name = model.category_name.strip()[:120] or None
    if model.notes:
        model.notes = model.notes.strip()[:2000] or None
    model.confidence = min(max(model.confidence if model.confidence is not None else 0.35, 0.0), 1.0)
    model.items = _normalize_items(model.items)
    return model


def _finalize_statement_preview(model: StatementPreviewModel, *, text: str | None = None) -> StatementPreviewModel:
    model.summary = (model.summary or "").strip()[:500] or None
    model.notes = (model.notes or "").strip()[:2000] or None
    model.confidence = min(max(model.confidence if model.confidence is not None else 0.45, 0.0), 1.0)
    model.entries = _normalize_statement_entries(model.entries)
    if model.summary is None and model.entries:
        merchants = ", ".join(entry.merchant or "Unknown" for entry in model.entries[:3])
        model.summary = f"Imported {len(model.entries)} candidate expenses from statement text, including {merchants}."
    if model.notes is None:
        model.notes = "Bank statement import extracted multiple candidate expenses that require review before save."
    return model


def _extract_json_object(raw_text: str) -> dict | None:
    text = raw_text.strip()
    if not text:
        return None

    fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fenced_match:
        text = fenced_match.group(1).strip()

    try:
        payload = json.loads(text)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            payload, _ = decoder.raw_decode(text[match.start() :])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        return None


def _receipt_llm_config(llm_config: LLMConfig | None) -> LLMConfig:
    if llm_config is None:
        return LLMConfig(extra={"format": "json"})

    extra = dict(llm_config.extra)
    extra.setdefault("format", "json")
    return LLMConfig(
        provider=llm_config.provider,
        model=llm_config.model,
        api_key=llm_config.api_key,
        base_url=llm_config.base_url,
        temperature=llm_config.temperature,
        max_tokens=llm_config.max_tokens,
        extra=extra,
    )


def _response_preview(raw_text: str, *, limit: int = 400) -> str:
    compact = re.sub(r"\s+", " ", raw_text).strip()
    return compact[:limit]


def _effective_provider_name(llm_config: LLMConfig | None) -> str:
    return (llm_config.provider if llm_config and llm_config.provider else settings.llm_provider)


def _effective_model_name(llm_config: LLMConfig | None) -> str:
    if llm_config and llm_config.model:
        return llm_config.model
    provider = _effective_provider_name(llm_config)
    if provider == "openai":
        return settings.openai_model
    if provider == "anthropic":
        return settings.anthropic_model
    if provider == "nebius":
        return settings.nebius_model
    return settings.ollama_model


def fallback_preview_from_text(text: str, filename: str) -> ReceiptPreviewModel:
    defaults = _preview_context_defaults(filename=filename, context_text=text)
    return _finalize_preview_model(ReceiptPreviewModel(
        merchant=defaults["merchant"] if isinstance(defaults["merchant"], str) else None,
        amount=defaults["amount"] if isinstance(defaults["amount"], float) else None,
        expense_date=defaults["expense_date"] if isinstance(defaults["expense_date"], str) else None,
        description=defaults["description"] if isinstance(defaults["description"], str) else None,
        notes="Fallback text extraction used after multimodal receipt extraction was unavailable or failed.",
        confidence=0.4 if isinstance(defaults["amount"], float) else 0.25,
    ), filename=filename, context_text=text)


def _merchant_from_statement_description(description: str) -> str | None:
    normalized = re.sub(r"\s+", " ", description).strip(" -")
    normalized = re.sub(r"\b(?:card|visa|pos|debit|purchase|payment|transaction|auth|ref)\b", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized).strip(" -")
    if not normalized:
        return None
    return normalized.title()[:255]


def fallback_statement_preview_from_text(text: str, filename: str) -> StatementPreviewModel:
    entries: list[StatementPreviewEntryModel] = []
    pattern = re.compile(
        r"(?P<date>\d{2}[/-]\d{2}[/-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\s+(?P<description>.+?)\s+(?P<amount>-?[\d\.,]+)\s*$"
    )
    for line in text.splitlines():
        candidate = line.strip()
        match = pattern.search(candidate)
        if not match:
            continue
        amount = _parse_amount_candidate(match.group("amount"))
        description = match.group("description").strip()
        expense_date = _parse_date_candidate(match.group("date"))
        merchant = _merchant_from_statement_description(description)
        if amount is None or expense_date is None or merchant is None:
            continue
        entries.append(
            StatementPreviewEntryModel(
                merchant=merchant,
                amount=amount,
                currency=settings.default_currency,
                expense_date=expense_date,
                description=description[:300],
                notes="Fallback statement parsing used line-based PDF text extraction.",
                confidence=0.58,
                status="pending",
            )
        )
    return _finalize_statement_preview(
        StatementPreviewModel(
            summary=f"Parsed {len(entries)} statement lines from {filename}." if entries else None,
            notes="Statement import used a local text parser because structured extraction was unavailable or returned invalid data.",
            confidence=0.58 if entries else 0.2,
            entries=entries,
        ),
        text=text,
    )


def _receipt_prompt(filename: str) -> str:
    return (
        "Read this receipt image directly and return strict JSON only. "
        "Return exactly one minified JSON object and no surrounding prose, markdown, or code fences. "
        "Infer the best possible structured expense draft from the receipt itself. "
        "Use null only when the value is genuinely not visible or inferable from the receipt. "
        "Return exactly one JSON object with keys: "
        "merchant, amount, currency, expense_date, description, category_name, notes, items, confidence. "
        "The items value must be an array of objects with keys: description, quantity, unit_price, total. "
        "Use JSON numbers for amount, quantity, unit_price, total, and confidence. "
        "Use double-quoted JSON strings. "
        "Set expense_date to ISO format YYYY-MM-DD when possible. "
        "Set currency to an ISO-style currency code when possible. "
        "Confidence must be a number between 0 and 1 reflecting extraction certainty. "
        f"Filename: {filename}"
    )


async def llm_receipt_preview_from_image(
    storage_path: str,
    filename: str,
    content_type: str | None,
    llm_config: LLMConfig | None,
) -> ReceiptPreviewModel | None:
    if not _is_supported_image(content_type, filename):
        logger.info(
            "receipt_extraction.multimodal_skipped_unsupported_image",
            filename=filename,
            content_type=content_type,
        )
        return None
    path = Path(storage_path)
    file_bytes = path.read_bytes()
    if not file_bytes or len(file_bytes) > settings.receipt_multimodal_max_bytes:
        logger.info(
            "receipt_extraction.multimodal_skipped_invalid_size",
            filename=filename,
            content_type=content_type,
            file_size=len(file_bytes),
            max_bytes=settings.receipt_multimodal_max_bytes,
        )
        return None
    media_type = content_type or f"image/{path.suffix.lower().lstrip('.')}"
    try:
        provider = get_llm_provider(llm_config)
        request_config = _receipt_llm_config(llm_config)
        response = await provider.complete(
            [
                Message(
                    role="system",
                    content=(
                        "You extract receipt fields from images into validated JSON for an expense draft. "
                        "Never return prose, markdown, or code fences. Return JSON only."
                    ),
                ),
                Message(
                    role="user",
                    content=_receipt_prompt(filename),
                    images=[ImageInput(media_type=media_type, data=base64.b64encode(file_bytes).decode("utf-8"))],
                ),
            ],
            request_config,
        )
        payload = _extract_json_object(response)
        if payload is None:
            logger.warning(
                "receipt_extraction.multimodal_json_parse_failed",
                filename=filename,
                provider=_effective_provider_name(request_config),
                model=_effective_model_name(request_config),
                response_preview=_response_preview(response),
            )
            return None
        model = ReceiptPreviewModel.model_validate(payload)
        if not model.notes:
            model.notes = "Primary extraction used direct multimodal receipt analysis."
        return _finalize_preview_model(model, filename=filename)
    except Exception as exc:
        logger.warning(
            "receipt_extraction.multimodal_failed",
            filename=filename,
            content_type=content_type,
            provider=_effective_provider_name(llm_config),
            model=_effective_model_name(llm_config),
            error=str(exc),
        )
        return None


async def llm_receipt_preview(text: str, filename: str, llm_config: LLMConfig | None) -> ReceiptPreviewModel | None:
    if not text.strip():
        return None
    try:
        provider = get_llm_provider(llm_config)
        request_config = _receipt_llm_config(llm_config)
        response = await provider.complete(
            [
                Message(
                    role="system",
                    content=(
                        "You extract expense receipt fields into strict JSON only. Return one object with keys: merchant, amount, currency, expense_date, description, category_name, notes, items, confidence. Use null where unknown."
                    ),
                ),
                Message(
                    role="user",
                    content=(
                        f"Filename: {filename}\nReceipt text follows. Infer the best structured expense draft. Include line items when visible in the text.\n\n{text[:8000]}"
                    ),
                ),
            ],
            request_config,
        )
        payload = _extract_json_object(response)
        if payload is None:
            logger.warning(
                "receipt_extraction.text_json_parse_failed",
                filename=filename,
                provider=_effective_provider_name(request_config),
                model=_effective_model_name(request_config),
                response_preview=_response_preview(response),
            )
            return None
        model = ReceiptPreviewModel.model_validate(payload)
        if not model.notes:
            model.notes = "Fallback structured extraction used text content rather than direct image analysis."
        return _finalize_preview_model(model, filename=filename, context_text=text)
    except Exception as exc:
        logger.warning(
            "receipt_extraction.text_llm_failed",
            filename=filename,
            provider=_effective_provider_name(llm_config),
            model=_effective_model_name(llm_config),
            error=str(exc),
        )
        return None


def _statement_prompt(filename: str, text: str) -> str:
    return (
        "Extract debit expenses from this bank statement into strict JSON only. "
        "Return exactly one JSON object with keys: summary, notes, confidence, entries. "
        "The entries value must be an array of objects with keys: merchant, amount, currency, expense_date, description, category_name, notes, confidence, status, saved_expense_id. "
        "Use status='pending' and saved_expense_id=null for every extracted entry. "
        "Only include purchase-like expenses, not salary, refunds, transfers in, balances, or fees unless they clearly represent user spending. "
        "Use positive JSON numbers for amounts and ISO dates when possible. "
        f"Filename: {filename}\n\nStatement text:\n{text[:16000]}"
    )


async def llm_statement_preview(text: str, filename: str, llm_config: LLMConfig | None) -> StatementPreviewModel | None:
    if not text.strip():
        return None
    try:
        provider = get_llm_provider(llm_config)
        request_config = _receipt_llm_config(llm_config)
        response = await provider.complete(
            [
                Message(
                    role="system",
                    content=(
                        "You extract bank statement expenses into strict JSON only. "
                        "Return a single valid JSON object and no prose or markdown."
                    ),
                ),
                Message(role="user", content=_statement_prompt(filename, text)),
            ],
            request_config,
        )
        payload = _extract_json_object(response)
        if payload is None:
            logger.warning(
                "receipt_extraction.statement_json_parse_failed",
                filename=filename,
                provider=_effective_provider_name(request_config),
                model=_effective_model_name(request_config),
                response_preview=_response_preview(response),
            )
            return None
        model = StatementPreviewModel.model_validate(payload)
        return _finalize_statement_preview(model, text=text)
    except Exception as exc:
        logger.warning(
            "receipt_extraction.statement_llm_failed",
            filename=filename,
            provider=_effective_provider_name(llm_config),
            model=_effective_model_name(llm_config),
            error=str(exc),
        )
        return None


async def build_receipt_preview(
    db,
    user_id: uuid.UUID,
    *,
    storage_path: str,
    content_type: str | None,
    filename: str,
    llm_config: LLMConfig | None,
) -> ReceiptExtractionResult:
    extracted_text: str | None = None
    used_text_fallback = False
    preview = await llm_receipt_preview_from_image(storage_path, filename, content_type, llm_config)
    if preview is None:
        logger.info(
            "receipt_extraction.using_text_fallback",
            filename=filename,
            content_type=content_type,
        )
        extracted_text = await extract_text_from_file(storage_path, content_type)
        used_text_fallback = bool(extracted_text.strip()) or not _is_supported_image(content_type, filename)
        preview = await llm_receipt_preview(extracted_text, filename, llm_config)
        if preview is None:
            logger.info(
                "receipt_extraction.using_rule_based_fallback",
                filename=filename,
                content_type=content_type,
                extracted_text_present=bool(extracted_text.strip()),
            )
            preview = fallback_preview_from_text(extracted_text, filename)
    if preview.category_name is None and preview.merchant:
        category = await resolve_category(db, user_id, merchant=preview.merchant)
        if category is not None:
            preview.category_name = category.name
            preview.confidence = max(preview.confidence, 0.72)
    preview = _finalize_preview_model(preview, filename=filename, context_text=extracted_text)
    return ReceiptExtractionResult(preview=preview, extracted_text=extracted_text, used_text_fallback=used_text_fallback)


async def build_statement_preview(
    db,
    user_id: uuid.UUID,
    *,
    storage_path: str,
    content_type: str | None,
    filename: str,
    llm_config: LLMConfig | None,
) -> ReceiptExtractionResult:
    extracted_text = await extract_text_from_file(storage_path, content_type)
    preview = await llm_statement_preview(extracted_text, filename, llm_config)
    if preview is None:
        logger.info("receipt_extraction.using_statement_fallback", filename=filename, content_type=content_type)
        preview = fallback_statement_preview_from_text(extracted_text, filename)
    resolved_entries: list[dict[str, Any]] = []
    for entry in preview.entries:
        payload = entry.model_dump()
        if payload.get("category_name") is None and payload.get("merchant"):
            category = await resolve_category(db, user_id, merchant=payload["merchant"])
            if category is not None:
                payload["category_name"] = category.name
                payload["confidence"] = max(float(payload.get("confidence") or 0.45), 0.72)
        resolved_entries.append(payload)
    preview = _finalize_statement_preview(
        StatementPreviewModel(
            summary=preview.summary,
            notes=preview.notes,
            confidence=preview.confidence,
            entries=resolved_entries,
        ),
        text=extracted_text,
    )
    return ReceiptExtractionResult(preview=preview, extracted_text=extracted_text, used_text_fallback=True)


def create_llm_config(*, provider: str | None, model: str | None, api_key: str | None, base_url: str | None) -> LLMConfig | None:
    if not any([provider, model, api_key, base_url]):
        return None
    return LLMConfig(provider=provider or None, model=model or None, api_key=api_key or None, base_url=base_url or None)
