"""Receipt extraction tests for SpendHound."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.receipt_extraction import _extract_json_object, fallback_preview_from_text, llm_receipt_preview
from app.services.llm.base import LLMConfig


def test_extract_json_object_embedded_payload():
    payload = _extract_json_object('hello {"merchant": "Cafe Roma", "amount": 8.50, "confidence": 0.8} world')
    assert payload is not None
    assert payload["merchant"] == "Cafe Roma"


def test_fallback_preview_from_text_parses_amount_and_date():
    preview = fallback_preview_from_text("Cafe Roma\nTotal EUR 8.50\n2026-04-11", "receipt.txt")
    assert preview.merchant == "Cafe Roma"
    assert preview.amount == 8.50
    assert preview.expense_date == "2026-04-11"


@pytest.mark.asyncio
async def test_llm_receipt_preview_validates_json_response():
    provider = MagicMock()
    provider.complete = AsyncMock(return_value='{"merchant":"Trainline","amount":27.4,"currency":"EUR","expense_date":"2026-04-03","description":"Rail ticket","category_name":"Transport","notes":"","confidence":0.91}')
    with patch("app.services.receipt_extraction.get_llm_provider", return_value=provider):
        preview = await llm_receipt_preview("Trainline receipt", "ticket.txt", LLMConfig(provider="ollama", model="test"))
    assert preview is not None
    assert preview.merchant == "Trainline"
    assert preview.category_name == "Transport"
    assert preview.confidence == pytest.approx(0.91)
