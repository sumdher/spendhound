"""Core expense API tests for SpendHound."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_create_list_update_delete_expense(client: AsyncClient, auth_headers: dict):
    payload = {
        "merchant": "Metro Grocery",
        "amount": 24.95,
        "currency": "EUR",
        "expense_date": "2026-04-10",
        "category_name": "Groceries",
        "description": "Weekly food shop",
    }
    create_response = await client.post("/api/expenses", json=payload, headers=auth_headers)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["merchant"] == "Metro Grocery"
    assert created["category_name"] == "Groceries"

    list_response = await client.get("/api/expenses?month=2026-04", headers=auth_headers)
    assert list_response.status_code == 200
    listing = list_response.json()
    assert listing["total"] >= 1
    assert any(item["merchant"] == "Metro Grocery" for item in listing["items"])

    update_response = await client.patch(
        f"/api/expenses/{created['id']}",
        json={"notes": "Corrected at review", "category_name": "Food"},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["notes"] == "Corrected at review"
    assert updated["category_name"] == "Food"

    delete_response = await client.delete(f"/api/expenses/{created['id']}", headers=auth_headers)
    assert delete_response.status_code == 204


async def test_review_queue_and_export(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/expenses",
        json={
            "merchant": "Unknown Cash",
            "amount": 12.00,
            "currency": "EUR",
            "expense_date": "2026-04-09",
            "description": "No category on purpose",
        },
        headers=auth_headers,
    )

    review_response = await client.get("/api/expenses/review-queue", headers=auth_headers)
    assert review_response.status_code == 200
    review_data = review_response.json()
    assert len(review_data["expenses"]) >= 1
    assert review_data["expenses"][0]["needs_review"] is True

    export_json = await client.get("/api/expenses/export?format=json&month=2026-04", headers=auth_headers)
    assert export_json.status_code == 200
    assert export_json.json()["total"] >= 1

    export_csv = await client.get("/api/expenses/export?format=csv&month=2026-04", headers=auth_headers)
    assert export_csv.status_code == 200
    assert "merchant" in export_csv.text
