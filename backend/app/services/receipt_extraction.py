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
from sqlalchemy import select

from app.config import settings
from app.models.user import User
from app.services.llm.base import ImageInput, LLMConfig, Message
from app.services.llm.factory import get_llm_provider, resolve_user_llm_config
from app.services.spendhound import TRANSACTION_TYPE_CREDIT, TRANSACTION_TYPE_DEBIT, find_matching_category, get_category_by_name, normalize_grocery_description, normalize_match_text, normalize_transaction_type, resolve_category


logger = structlog.get_logger(__name__)

_ITALIAN_SUPERMARKET_MERCHANTS = {
    "esselunga": "Esselunga",
    "lidl": "Lidl",
    "carrefour": "Carrefour",
    "aldi": "Aldi",
    "md": "MD",
    "conad": "Conad",
    "coop": "Coop",
    "pam": "Pam",
    "interspar": "Interspar",
    "eurospar": "Eurospar",
    "iper": "Iper",
    "famila": "Famila",
    "bennet": "Bennet",
    "tigre": "Tigre",
    "despar": "Despar",
}

_GENERIC_CATEGORY_NAMES = {"misc", "miscellaneous", "other", "other expense", "shopping", "spesa varia", "varie"}


DEFAULT_RECEIPT_SYSTEM_PROMPT = (
    "You are a receipt parser. Output only a single valid JSON object — no prose, no markdown, no code fences, no explanation. "
    "Receipts may contain Italian text. The merchant is the store name near the top of the receipt, not a tax ID, VAT number, address, or footer line. "
    "Default transaction_type to 'debit'. Use null for any field that is not visible on the receipt."
)


def build_receipt_system_prompt(override: str | None = None) -> str:
    return (override or "").strip() or DEFAULT_RECEIPT_SYSTEM_PROMPT


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
    transaction_type: str | None = Field(default=TRANSACTION_TYPE_DEBIT)
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
    transaction_type: str | None = Field(default=TRANSACTION_TYPE_DEBIT)
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


def _canonical_supermarket_name(value: str | None) -> str | None:
    normalized = normalize_match_text(value)
    if not normalized:
        return None
    compact = normalized.replace(" ", "")
    for candidate, label in _ITALIAN_SUPERMARKET_MERCHANTS.items():
        if candidate == normalized or candidate == compact or candidate in normalized or normalized in candidate:
            return label
    return None


def _looks_like_noise_line(line: str) -> bool:
    normalized = normalize_match_text(line)
    if not normalized:
        return True
    if any(token in normalized for token in {"totale", "subtotal", "pagamento", "contanti", "resto", "iva", "telefono", "scontrino", "documento", "eur", "euro", "bancomat", "cassa"}):
        return True
    if re.search(r"\d{2}[/-]\d{2}[/-]\d{2,4}", line):
        return True
    if re.search(r"\d+[\.,]\d{2}", line):
        return True
    return False


def _merchant_hint_from_receipt_text(text: str | None) -> str | None:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()][:10]
    for line in lines:
        canonical = _canonical_supermarket_name(line)
        if canonical:
            return canonical
    for line in lines:
        if _looks_like_noise_line(line):
            continue
        cleaned = re.sub(r"\s+", " ", line).strip(" -:")
        if 2 <= len(cleaned) <= 80:
            return cleaned.title()[:255]
    return None


def _is_supermarket_merchant(value: str | None) -> bool:
    return _canonical_supermarket_name(value) is not None


def _looks_like_grocery_item(description: str | None) -> bool:
    normalized = normalize_grocery_description(description)
    if not normalized:
        return False
    grocery_terms = {
        "pomodoro", "pomodori", "latte", "pane", "pasta", "riso", "banana", "mele", "mela", "insalata", "zucchine", "pollo", "uova", "mozzarella", "yogurt", "acqua", "detersivo", "sapone", "shampoo", "cien", "verdura", "frutta",
    }
    return any(term in normalized for term in grocery_terms)


def _should_force_groceries(preview: ReceiptPreviewModel, context_text: str | None = None) -> bool:
    if normalize_transaction_type(preview.transaction_type, default=TRANSACTION_TYPE_DEBIT) != TRANSACTION_TYPE_DEBIT:
        return False
    if _is_supermarket_merchant(preview.merchant):
        return True
    item_descriptions = [item.description for item in (preview.items or []) if item.description]
    if item_descriptions and sum(1 for description in item_descriptions if _looks_like_grocery_item(description)) >= max(1, len(item_descriptions) // 2):
        return True
    return _canonical_supermarket_name(context_text or "") is not None


async def _apply_category_heuristics(db, user_id: uuid.UUID, preview: ReceiptPreviewModel, *, context_text: str | None = None) -> ReceiptPreviewModel:
    if _should_force_groceries(preview, context_text=context_text):
        preview.category_name = "Groceries"
        preview.confidence = max(preview.confidence or 0.35, 0.86)

    normalized_category_name = normalize_match_text(preview.category_name)
    if preview.merchant:
        matched_category = await find_matching_category(db, user_id, preview.merchant, transaction_type=preview.transaction_type or TRANSACTION_TYPE_DEBIT)
        if matched_category is not None and (not normalized_category_name or normalized_category_name in _GENERIC_CATEGORY_NAMES or _is_supermarket_merchant(preview.merchant)):
            preview.category_name = matched_category.name
            preview.confidence = max(preview.confidence or 0.35, 0.82)

    if preview.category_name:
        existing_category = await get_category_by_name(db, user_id, preview.category_name, transaction_type=preview.transaction_type or TRANSACTION_TYPE_DEBIT)
        if existing_category is not None:
            preview.category_name = existing_category.name
    return preview


_CREDIT_DESCRIPTION_KEYWORDS = {
    "salary",
    "payroll",
    "refund",
    "reimbursement",
    "interest",
    "gift",
    "transfer in",
    "incoming transfer",
    "cashback",
    "dividend",
    "bonus",
    "deposit",
}

_DEBIT_DESCRIPTION_KEYWORDS = {
    "purchase",
    "payment",
    "card purchase",
    "pos",
    "debit",
    "direct debit",
    "transfer out",
    "outgoing transfer",
    "withdrawal",
    "cash withdrawal",
    "atm",
    "fee",
    "charge",
}

_CREDIT_DIRECTION_MARKERS = {"credit", "cr", "incoming", "in"}
_DEBIT_DIRECTION_MARKERS = {"debit", "dr", "outgoing", "out"}


def _infer_transaction_type(description: str | None, amount: float | None, *, direction_hint: str | None = None) -> str:
    normalized_description = re.sub(r"\s+", " ", (description or "").lower()).strip()
    normalized_hint = re.sub(r"[^a-z]", "", (direction_hint or "").lower())
    if normalized_hint in _CREDIT_DIRECTION_MARKERS:
        return TRANSACTION_TYPE_CREDIT
    if normalized_hint in _DEBIT_DIRECTION_MARKERS:
        return TRANSACTION_TYPE_DEBIT
    if any(keyword in normalized_description for keyword in _CREDIT_DESCRIPTION_KEYWORDS):
        return TRANSACTION_TYPE_CREDIT
    if any(keyword in normalized_description for keyword in _DEBIT_DESCRIPTION_KEYWORDS):
        return TRANSACTION_TYPE_DEBIT
    if amount is not None and amount < 0:
        return TRANSACTION_TYPE_DEBIT
    return TRANSACTION_TYPE_DEBIT


def _normalize_statement_entries(entries: list[StatementPreviewEntryModel] | None) -> list[StatementPreviewEntryModel]:
    normalized: list[StatementPreviewEntryModel] = []
    for entry in (entries or [])[:200]:
        cleaned = StatementPreviewEntryModel.model_validate(entry)
        if cleaned.amount is not None:
            try:
                normalized_amount = float(Decimal(str(cleaned.amount)).quantize(Decimal("0.01")))
            except (InvalidOperation, ValueError):
                normalized_amount = None
            cleaned.transaction_type = normalize_transaction_type(cleaned.transaction_type or _infer_transaction_type(f"{cleaned.description or ''} {cleaned.notes or ''}", normalized_amount), default=TRANSACTION_TYPE_DEBIT)
            cleaned.amount = abs(normalized_amount) if normalized_amount is not None else None
        else:
            cleaned.transaction_type = normalize_transaction_type(cleaned.transaction_type, default=TRANSACTION_TYPE_DEBIT)
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
        return float(Decimal(candidate).quantize(Decimal("0.01")))
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

    merchant = _merchant_hint_from_receipt_text(text)
    if not merchant and filename:
        merchant = _merchant_hint_from_filename(filename)
    canonical_merchant = _canonical_supermarket_name(merchant)
    if canonical_merchant:
        merchant = canonical_merchant

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
    model.transaction_type = normalize_transaction_type(model.transaction_type, default=TRANSACTION_TYPE_DEBIT)
    model.currency = _normalize_currency(model.currency)
    if model.merchant:
        model.merchant = (_canonical_supermarket_name(model.merchant) or model.merchant.strip())[:255]
    elif isinstance(defaults["merchant"], str):
        model.merchant = defaults["merchant"][:255]
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


async def _apply_receipt_category_heuristics(db, user_id: uuid.UUID, preview: ReceiptPreviewModel, *, context_text: str | None = None) -> ReceiptPreviewModel:
    if _should_force_groceries(preview, context_text=context_text):
        preview.category_name = "Groceries"
        preview.confidence = max(preview.confidence or 0.35, 0.86)

    normalized_category_name = normalize_match_text(preview.category_name)
    if preview.merchant:
        matched_category = await find_matching_category(
            db,
            user_id,
            preview.merchant,
            transaction_type=preview.transaction_type or TRANSACTION_TYPE_DEBIT,
        )
        if matched_category is not None and (
            not normalized_category_name
            or normalized_category_name in _GENERIC_CATEGORY_NAMES
            or _is_supermarket_merchant(preview.merchant)
        ):
            preview.category_name = matched_category.name
            preview.confidence = max(preview.confidence or 0.35, 0.82)

    if preview.category_name:
        existing_category = await get_category_by_name(
            db,
            user_id,
            preview.category_name,
            transaction_type=preview.transaction_type or TRANSACTION_TYPE_DEBIT,
        )
        if existing_category is not None:
            preview.category_name = existing_category.name
    return preview


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
        transaction_type=TRANSACTION_TYPE_DEBIT,
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
        r"(?P<date>\d{2}[/-]\d{2}[/-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\s+(?P<description>.+?)\s+(?P<amount>-?[\d\.,]+)\s*(?P<marker>CR|DR|CREDIT|DEBIT)?\s*$",
        flags=re.IGNORECASE,
    )
    for line in text.splitlines():
        candidate = line.strip()
        match = pattern.search(candidate)
        if not match:
            continue
        amount = _parse_amount_candidate(match.group("amount"))
        description = match.group("description").strip()
        direction_marker = match.group("marker")
        expense_date = _parse_date_candidate(match.group("date"))
        merchant = _merchant_from_statement_description(description)
        if amount is None or expense_date is None or merchant is None:
            continue
        entries.append(
            StatementPreviewEntryModel(
                merchant=merchant,
                amount=abs(amount),
                transaction_type=normalize_transaction_type(_infer_transaction_type(f"{description} {direction_marker or ''}", amount, direction_hint=direction_marker), default=TRANSACTION_TYPE_DEBIT),
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


_RECEIPT_ITEM_SUBCATEGORIES = (
    "Vegetables | Fruit | Meat | Fish & Seafood | Dairy & Eggs | Bakery | Frozen | Snacks | Beverages | "
    "Cleaning Products | Personal Care | Baby | Pet Care | Household | "
    "Breakfast & Cereal | Condiments & Spices | Pantry | Prepared Meals | Other Grocery"
)

_RECEIPT_ITALIAN_SUBCATEGORY_GUIDE = (
    "pomodori/verdura/insalata→Vegetables  frutta/mele/arance/fragole→Fruit  "
    "pollo/carne/manzo/prosciutto/salame→Meat  pesce/tonno/salmone/gamberi/cozze→Fish & Seafood  "
    "latte/formaggio/uova/burro/yogurt/mozzarella/parmigiano→Dairy & Eggs  "
    "pane/focaccia/cornetto/brioche/grissini/panino→Bakery  "
    "surgelati/surgelato/gelato→Frozen  "
    "patatine/biscotti/cioccolato/snack/wafer→Snacks  "
    "acqua/birra/vino/caffe/succo/bibite/aranciata→Beverages  "
    "detersivo/ammorbidente/candeggina/anticalcare→Cleaning Products  "
    "shampoo/sapone/dentifricio/bagnoschiuma/rasoio→Personal Care  "
    "pannolini/omogeneizzato/biberon→Baby  "
    "pasta/riso/farina/olio/conserva/fagioli/pelati/brodo/zucchero→Pantry  "
    "cereali/fiocchi/avena/muesli→Breakfast & Cereal  "
    "sale/pepe/origano/basilico/aceto/dado/senape/maionese→Condiments & Spices  "
    "gastronomia/rosticceria→Prepared Meals"
)


def _receipt_prompt(filename: str) -> str:
    return (
        "Read this receipt and return exactly one JSON object. No prose, no markdown, no code fences.\n"
        "\n"
        "Top-level keys: merchant, amount, transaction_type, currency, expense_date, "
        "category_name, description, notes, confidence, items\n"
        "\n"
        "Each element of 'items' must have: description, quantity, unit_price, total, subcategory\n"
        "\n"
        f"Valid subcategory values: {_RECEIPT_ITEM_SUBCATEGORIES}\n"
        "\n"
        f"Italian item guide: {_RECEIPT_ITALIAN_SUBCATEGORY_GUIDE}\n"
        "\n"
        "Rules:\n"
        "- merchant: store name near top of receipt (e.g. Esselunga, Lidl, Coop, Carrefour, Conad, Aldi, MD)\n"
        "- category_name: 'Groceries' for any supermarket receipt\n"
        "- amount: positive total paid (number, not string)\n"
        "- currency: ISO code such as EUR, USD, GBP\n"
        "- expense_date: YYYY-MM-DD format\n"
        "- transaction_type: 'debit' (default) or 'credit' (refund/reimbursement only)\n"
        "- confidence: 0.0 to 1.0 reflecting your extraction certainty\n"
        "- subcategory: classify each item using the valid subcategory list above; use null only if truly unclassifiable\n"
        "- Keep repeated line items as separate rows unless the receipt shows an explicit quantity\n"
        "- Use null for any value not visible on the receipt\n"
        f"- Filename: {filename}"
    )


async def llm_receipt_preview_from_image(
    storage_path: str,
    filename: str,
    content_type: str | None,
    llm_config: LLMConfig | None,
    system_prompt: str | None = None,
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
                    content=build_receipt_system_prompt(system_prompt),
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


async def llm_receipt_preview(text: str, filename: str, llm_config: LLMConfig | None, system_prompt: str | None = None) -> ReceiptPreviewModel | None:
    if not text.strip():
        return None
    try:
        provider = get_llm_provider(llm_config)
        request_config = _receipt_llm_config(llm_config)
        response = await provider.complete(
            [
                Message(
                    role="system",
                    content=build_receipt_system_prompt(system_prompt),
                ),
                Message(
                    role="user",
                    content=(
                        "Extract the receipt text below into one JSON object. No prose, no markdown.\n"
                        "\n"
                        "Top-level keys: merchant, amount, transaction_type, currency, expense_date, "
                        "category_name, description, notes, confidence, items\n"
                        "\n"
                        "Each element of 'items' must have: description, quantity, unit_price, total, subcategory\n"
                        "\n"
                        f"Valid subcategory values: {_RECEIPT_ITEM_SUBCATEGORIES}\n"
                        "\n"
                        f"Italian item guide: {_RECEIPT_ITALIAN_SUBCATEGORY_GUIDE}\n"
                        "\n"
                        "Rules:\n"
                        "- merchant: store name (e.g. Esselunga, Lidl, Coop, Carrefour, Conad, Aldi)\n"
                        "- category_name: 'Groceries' for any supermarket receipt\n"
                        "- amount: positive total paid (number); currency as ISO code\n"
                        "- expense_date: YYYY-MM-DD; transaction_type: 'debit' (default) or 'credit'\n"
                        "- confidence: 0.0 to 1.0; use null for values not present in the text\n"
                        "\n"
                        f"Filename: {filename}\n"
                        f"Receipt text:\n{text[:8000]}"
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
        "Extract bank statement transactions into strict JSON only. "
        "Return exactly one JSON object with keys: summary, notes, confidence, entries. "
        "The entries value must be an array of objects with keys: merchant, amount, transaction_type, currency, expense_date, description, category_name, notes, confidence, status, saved_expense_id. "
        "Use status='pending' and saved_expense_id=null for every extracted entry. "
        "Include both money-out debits and money-in credits such as salary, gifts, refunds, reimbursements, transfer-ins, and interest when they appear as real account activity. "
        "Pay close attention to explicit debit or credit indicators such as CR, DR, credit, debit, withdrawal, deposit, payroll, and refund wording. "
        "Use positive JSON numbers for amounts, set transaction_type to either 'debit' or 'credit', and use ISO dates when possible. "
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
                        "You extract bank statement transactions into strict JSON only. "
                        "Represent both debit spend and credit income transactions with a transaction_type field. "
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
    user: User,
    *,
    storage_path: str,
    content_type: str | None,
    filename: str,
    llm_config: LLMConfig | None,
) -> ReceiptExtractionResult:
    # Resolve the effective LLM config: user's stored key > admin env fallback > error
    effective_config = resolve_user_llm_config(user, llm_config)

    extracted_text: str | None = None
    used_text_fallback = False
    # Use the user's own prompt override if set; otherwise fall back to admin's global default
    prompt_override = user.receipt_prompt_override
    if not prompt_override:
        admin_email = settings.admin_email
        if admin_email:
            admin_prompt_result = await db.execute(
                select(User.receipt_prompt_override).where(User.email == admin_email).limit(1)
            )
            prompt_override = admin_prompt_result.scalar_one_or_none()
    preview = await llm_receipt_preview_from_image(storage_path, filename, content_type, effective_config, prompt_override)
    if preview is None:
        logger.info(
            "receipt_extraction.using_text_fallback",
            filename=filename,
            content_type=content_type,
        )
        extracted_text = await extract_text_from_file(storage_path, content_type)
        used_text_fallback = bool(extracted_text.strip()) or not _is_supported_image(content_type, filename)
        preview = await llm_receipt_preview(extracted_text, filename, effective_config, prompt_override)
        if preview is None:
            logger.info(
                "receipt_extraction.using_rule_based_fallback",
                filename=filename,
                content_type=content_type,
                extracted_text_present=bool(extracted_text.strip()),
            )
            preview = fallback_preview_from_text(extracted_text, filename)
    if preview.category_name is None and preview.merchant:
        category = await resolve_category(db, user.id, merchant=preview.merchant, transaction_type=preview.transaction_type or TRANSACTION_TYPE_DEBIT)
        if category is not None:
            preview.category_name = category.name
            preview.confidence = max(preview.confidence, 0.72)
    preview = await _apply_receipt_category_heuristics(db, user.id, preview, context_text=extracted_text)
    preview = _finalize_preview_model(preview, filename=filename, context_text=extracted_text)
    return ReceiptExtractionResult(preview=preview, extracted_text=extracted_text, used_text_fallback=used_text_fallback)


async def build_statement_preview(
    db,
    user: User,
    *,
    storage_path: str,
    content_type: str | None,
    filename: str,
    llm_config: LLMConfig | None,
) -> ReceiptExtractionResult:
    # Resolve the effective LLM config: user's stored key > admin env fallback > error
    effective_config = resolve_user_llm_config(user, llm_config)

    extracted_text = await extract_text_from_file(storage_path, content_type)
    preview = await llm_statement_preview(extracted_text, filename, effective_config)
    if preview is None:
        logger.info("receipt_extraction.using_statement_fallback", filename=filename, content_type=content_type)
        preview = fallback_statement_preview_from_text(extracted_text, filename)
    resolved_entries: list[dict[str, Any]] = []
    for entry in preview.entries:
        payload = entry.model_dump()
        if payload.get("category_name") is None and payload.get("merchant"):
            category = await resolve_category(db, user.id, merchant=payload["merchant"], transaction_type=payload.get("transaction_type") or TRANSACTION_TYPE_DEBIT)
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
