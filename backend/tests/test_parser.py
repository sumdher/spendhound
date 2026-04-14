"""Receipt extraction tests for SpendHound."""

from __future__ import annotations

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.receipt_extraction import _canonical_supermarket_name, _extract_json_object, _merchant_hint_from_receipt_text, _should_force_groceries, ReceiptPreviewItemModel, ReceiptPreviewModel, extract_text_from_file, fallback_preview_from_text, fallback_statement_preview_from_text, llm_receipt_preview, llm_receipt_preview_from_image
from app.services.llm.base import ImageInput, LLMConfig, Message
from app.services.llm.ollama import OllamaProvider


def test_extract_json_object_embedded_payload():
    payload = _extract_json_object('hello {"merchant": "Cafe Roma", "amount": 8.50, "confidence": 0.8} world')
    assert payload is not None
    assert payload["merchant"] == "Cafe Roma"


def test_extract_json_object_from_markdown_fence():
    payload = _extract_json_object('```json\n{"merchant":"Cafe Roma","amount":8.5,"confidence":0.8}\n```')
    assert payload is not None
    assert payload["amount"] == 8.5


def test_fallback_preview_from_text_parses_amount_and_date():
    preview = fallback_preview_from_text("Cafe Roma\nTotal EUR 8.50\n2026-04-11", "receipt.txt")
    assert preview.merchant == "Cafe Roma"
    assert preview.amount == 8.50
    assert preview.expense_date == "2026-04-11"


def test_fallback_preview_from_text_uses_filename_for_missing_merchant():
    preview = fallback_preview_from_text("Total EUR 8.50\n2026-04-11", "cafe-roma_2026-04-11.png")
    assert preview.merchant == "Cafe Roma"
    assert preview.expense_date == "2026-04-11"


def test_merchant_hint_from_receipt_text_prefers_known_supermarket_brand():
    merchant = _merchant_hint_from_receipt_text("PUNTI FIDELITY\nESSELUNGA ROMA\nVia Example 12\nTotale 24,90")
    assert merchant == "Esselunga"


def test_canonical_supermarket_name_normalizes_short_brands():
    assert _canonical_supermarket_name("md discount") == "MD"


def test_should_force_groceries_for_supermarket_receipts():
    preview = ReceiptPreviewModel(
        merchant="Carrefour Market",
        transaction_type="debit",
        items=[ReceiptPreviewItemModel(description="Pomodori datterini"), ReceiptPreviewItemModel(description="Cien shampoo")],
    )
    assert _should_force_groceries(preview) is True


def test_fallback_statement_preview_from_text_parses_multiple_entries():
    preview = fallback_statement_preview_from_text(
        "12/04/2026 CARREFOUR MARKET -45,67\n13/04/2026 FARMACIA CENTRALE -12,30",
        "statement.pdf",
    )
    assert len(preview.entries) == 2
    assert preview.entries[0].merchant == "Carrefour Market"
    assert preview.entries[0].amount == pytest.approx(45.67)
    assert preview.entries[0].expense_date == "2026-04-12"


def test_fallback_statement_preview_from_text_handles_credit_and_debit_markers():
    preview = fallback_statement_preview_from_text(
        "12/04/2026 ACME PAYROLL 3200,00 CR\n13/04/2026 CARD PURCHASE SUPERMARKET 45,67 DR",
        "statement.pdf",
    )
    assert len(preview.entries) == 2
    assert preview.entries[0].transaction_type == "credit"
    assert preview.entries[0].amount == pytest.approx(3200.00)
    assert preview.entries[1].transaction_type == "debit"
    assert preview.entries[1].amount == pytest.approx(45.67)


@pytest.mark.asyncio
async def test_extract_text_from_pdf_prefers_pdfplumber(tmp_path):
    pdf_path = tmp_path / "statement.pdf"
    pdf_path.write_bytes(b"fake-pdf")

    fake_page = MagicMock()
    fake_page.extract_text.side_effect = ["Line one", "Line one"]
    fake_pdf = MagicMock()
    fake_pdf.pages = [fake_page]
    fake_context = MagicMock()
    fake_context.__enter__.return_value = fake_pdf
    fake_context.__exit__.return_value = False

    with patch("app.services.receipt_extraction.pdfplumber.open", return_value=fake_context):
        text = await extract_text_from_file(str(pdf_path), "application/pdf")

    assert "Line one" in text


@pytest.mark.asyncio
async def test_llm_receipt_preview_validates_json_response():
    provider = MagicMock()
    provider.complete = AsyncMock(return_value='{"merchant":"Trainline","amount":27.4,"currency":"EUR","expense_date":"2026-04-03","description":"Rail ticket","category_name":"Transport","notes":"","items":[{"description":"Rail ticket","total":27.4}],"confidence":0.91}')
    with patch("app.services.receipt_extraction.get_llm_provider", return_value=provider):
        preview = await llm_receipt_preview("Trainline receipt", "ticket.txt", LLMConfig(provider="ollama", model="test"))
    assert preview is not None
    assert preview.merchant == "Trainline"
    assert preview.category_name == "Transport"
    assert preview.items[0].description == "Rail ticket"
    assert preview.confidence == pytest.approx(0.91)


@pytest.mark.asyncio
async def test_llm_receipt_preview_from_image_uses_multimodal_message(tmp_path):
    provider = MagicMock()
    provider.complete = AsyncMock(return_value='{"merchant":"Cafe Roma","amount":8.5,"currency":"EUR","expense_date":"2026-04-11","description":"Coffee and pastry","category_name":"Dining","notes":"","items":[{"description":"Coffee","quantity":1,"unit_price":3.5,"total":3.5},{"description":"Pastry","quantity":1,"unit_price":5.0,"total":5.0}],"confidence":0.89}')
    image_path = tmp_path / "receipt.png"
    image_path.write_bytes(b"fake-image-bytes")

    with patch("app.services.receipt_extraction.get_llm_provider", return_value=provider):
        preview = await llm_receipt_preview_from_image(str(image_path), "receipt.png", "image/png", LLMConfig(provider="ollama", model="test"))

    assert preview is not None
    assert preview.merchant == "Cafe Roma"
    assert preview.amount == pytest.approx(8.5)
    assert len(preview.items) == 2

    sent_messages = provider.complete.await_args.args[0]
    sent_config = provider.complete.await_args.args[1]
    assert sent_messages[1].images[0].media_type == "image/png"
    assert sent_messages[1].images[0].data == base64.b64encode(b"fake-image-bytes").decode("utf-8")
    assert sent_config.extra["format"] == "json"


@pytest.mark.asyncio
async def test_llm_receipt_preview_from_image_accepts_partial_json_with_null_fields(tmp_path):
    provider = MagicMock()
    provider.complete = AsyncMock(return_value='{"merchant":null,"amount":8.5,"currency":null,"expense_date":null,"description":null,"category_name":null,"notes":"","items":null,"confidence":0.74}')
    image_path = tmp_path / "cafe-roma_2026-04-11.png"
    image_path.write_bytes(b"fake-image-bytes")

    with patch("app.services.receipt_extraction.get_llm_provider", return_value=provider):
        preview = await llm_receipt_preview_from_image(str(image_path), "cafe-roma_2026-04-11.png", "image/png", LLMConfig(provider="ollama", model="test"))

    assert preview is not None
    assert preview.merchant == "Cafe Roma"
    assert preview.amount == pytest.approx(8.5)
    assert preview.currency == "EUR"
    assert preview.expense_date == "2026-04-11"
    assert preview.items == []
    assert preview.confidence == pytest.approx(0.74)


def test_ollama_provider_build_payload_normalizes_multimodal_images_for_chat_api():
    provider = OllamaProvider()
    payload = provider._build_payload(
        [
            Message(
                role="user",
                content="What is on this receipt?",
                images=[
                    ImageInput(
                        media_type="image/png",
                        data="data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==",
                    )
                ],
            ),
        ],
        LLMConfig(provider="ollama", model="qwen2.5vl", extra={"format": "json"}),
    )
    assert payload["format"] == "json"
    assert payload["messages"][0]["role"] == "user"
    assert payload["messages"][0]["images"] == ["ZmFrZS1pbWFnZS1ieXRlcw=="]
