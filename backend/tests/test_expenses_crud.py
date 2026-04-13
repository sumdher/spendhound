"""Core expense API tests for SpendHound."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.receipt import Receipt
from app.services.spendhound import normalize_money, recompute_recurring_expenses, replace_expense_items

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


async def test_create_credit_transaction_and_filter_by_type(client: AsyncClient, auth_headers: dict):
    payload = {
        "merchant": "ACME Payroll",
        "amount": 3500.00,
        "transaction_type": "credit",
        "currency": "EUR",
        "expense_date": "2026-04-10",
        "category_name": "Salary",
        "description": "Monthly salary",
    }
    create_response = await client.post("/api/expenses", json=payload, headers=auth_headers)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["transaction_type"] == "credit"
    assert created["category_name"] == "Salary"
    assert created["signed_amount"] == 3500.0

    credit_list_response = await client.get("/api/expenses?month=2026-04&transaction_type=credit", headers=auth_headers)
    assert credit_list_response.status_code == 200
    credit_listing = credit_list_response.json()
    assert any(item["id"] == created["id"] for item in credit_listing["items"])
    assert all(item["transaction_type"] == "credit" for item in credit_listing["items"])


async def test_all_time_listing_and_cadence_filter(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/expenses",
        json={
            "merchant": "Annual Insurance",
            "amount": 640.00,
            "currency": "EUR",
            "expense_date": "2018-05-10",
            "category_name": "Bills",
            "description": "Insurance premium",
            "cadence": "yearly",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    created = response.json()
    assert created["cadence"] == "yearly"
    assert created["is_recurring"] is True

    filtered = await client.get("/api/expenses?month=all&cadence=yearly", headers=auth_headers)
    assert filtered.status_code == 200
    payload = filtered.json()
    assert any(item["id"] == created["id"] for item in payload["items"])

    current_month = await client.get("/api/expenses?month=2026-04", headers=auth_headers)
    assert current_month.status_code == 200
    assert all(item["id"] != created["id"] for item in current_month.json()["items"])


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


async def test_create_expense_from_receipt_is_listed_in_saved_month(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    receipt = Receipt(
        id=uuid.uuid4(),
        user_id=test_user.id,
        original_filename="march-receipt.jpg",
        stored_filename="stored-march-receipt.jpg",
        content_type="image/jpeg",
        storage_path="receipts/test-user/march-receipt.jpg",
        preview_data={
            "merchant": "Old Town Cafe",
            "amount": 18.5,
            "currency": "EUR",
            "expense_date": "2026-03-28",
            "category_name": "Dining",
            "items": [
                {"description": "Soup", "quantity": 1, "unit_price": 6.5, "total": 6.5},
                {"description": "Sandwich", "quantity": 1, "unit_price": 12.0, "total": 12.0},
            ],
            "confidence": 0.97,
        },
        document_kind="receipt",
        extraction_confidence=0.97,
        extraction_status="review",
        needs_review=True,
    )
    db_session.add(receipt)
    await db_session.commit()

    create_response = await client.post(
        "/api/expenses/from-receipt",
        json={
            "receipt_id": str(receipt.id),
            "merchant": "Old Town Cafe",
            "description": "Lunch",
            "amount": 18.5,
            "currency": "EUR",
            "expense_date": "2026-03-28",
            "category_name": "Dining",
            "confidence": 0.97,
        },
        headers=auth_headers,
    )
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["source"] == "receipt"
    assert created["expense_date"] == "2026-03-28"

    march_list_response = await client.get("/api/expenses?month=2026-03", headers=auth_headers)
    assert march_list_response.status_code == 200
    march_listing = march_list_response.json()
    assert any(item["id"] == created["id"] for item in march_listing["items"])

    april_list_response = await client.get("/api/expenses?month=2026-04", headers=auth_headers)
    assert april_list_response.status_code == 200
    april_listing = april_list_response.json()
    assert all(item["id"] != created["id"] for item in april_listing["items"])

    detail_response = await client.get(f"/api/expenses/{created['id']}", headers=auth_headers)
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert len(detail["items"]) == 2
    assert detail["items"][0]["description"] == "Soup"


async def test_create_expense_from_statement_entry_updates_queue(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    statement = Receipt(
        id=uuid.uuid4(),
        user_id=test_user.id,
        original_filename="statement-april.pdf",
        stored_filename="statement-april.pdf",
        content_type="application/pdf",
        storage_path="receipts/test-user/statement-april.pdf",
        preview_data={
            "summary": "Parsed 2 statement entries.",
            "confidence": 0.81,
            "entries": [
                {
                    "merchant": "Carrefour Market",
                    "amount": 45.67,
                    "currency": "EUR",
                    "expense_date": "2026-04-12",
                    "description": "CARREFOUR MARKET",
                    "category_name": "Groceries",
                    "confidence": 0.88,
                    "status": "pending",
                    "saved_expense_id": None,
                },
                {
                    "merchant": "Fuel Station",
                    "amount": 30.0,
                    "currency": "EUR",
                    "expense_date": "2026-04-13",
                    "description": "FUEL STATION",
                    "category_name": "Transport",
                    "confidence": 0.84,
                    "status": "pending",
                    "saved_expense_id": None,
                },
            ],
        },
        extraction_confidence=0.81,
        document_kind="statement",
        extraction_status="review",
        needs_review=True,
    )
    db_session.add(statement)
    await db_session.commit()

    response = await client.post(
        "/api/expenses/from-statement-entry",
        json={
            "receipt_id": str(statement.id),
            "entry_index": 0,
            "merchant": "Carrefour Market",
            "description": "Card purchase",
            "amount": 45.67,
            "currency": "EUR",
            "expense_date": "2026-04-12",
            "category_name": "Groceries",
            "confidence": 0.88,
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["expense"]["source"] == "statement"
    assert payload["statement"]["preview"]["entries"][0]["status"] == "finalized"
    assert payload["statement"]["preview"]["entries"][1]["status"] == "pending"


async def test_create_credit_transaction_from_statement_entry(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    statement = Receipt(
        id=uuid.uuid4(),
        user_id=test_user.id,
        original_filename="statement-income.pdf",
        stored_filename="statement-income.pdf",
        content_type="application/pdf",
        storage_path="receipts/test-user/statement-income.pdf",
        preview_data={
            "summary": "Parsed 1 statement entry.",
            "confidence": 0.86,
            "entries": [
                {
                    "merchant": "ACME Payroll",
                    "amount": 3200.00,
                    "transaction_type": "credit",
                    "currency": "EUR",
                    "expense_date": "2026-04-15",
                    "description": "MONTHLY SALARY",
                    "category_name": "Salary",
                    "confidence": 0.93,
                    "status": "pending",
                    "saved_expense_id": None,
                }
            ],
        },
        extraction_confidence=0.86,
        document_kind="statement",
        extraction_status="review",
        needs_review=True,
    )
    db_session.add(statement)
    await db_session.commit()

    response = await client.post(
        "/api/expenses/from-statement-entry",
        json={
            "receipt_id": str(statement.id),
            "entry_index": 0,
            "merchant": "ACME Payroll",
            "description": "Salary payment",
            "amount": 3200.00,
            "transaction_type": "credit",
            "currency": "EUR",
            "expense_date": "2026-04-15",
            "category_name": "Salary",
            "confidence": 0.93,
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["expense"]["transaction_type"] == "credit"
    assert payload["expense"]["signed_amount"] == 3200.0
    assert payload["expense"]["category_name"] == "Salary"


async def test_replace_expense_items_replaces_rows_without_relationship_assignment(db_session: AsyncSession, test_user):
    expense = Expense(
        id=uuid.uuid4(),
        user_id=test_user.id,
        merchant="Market Square",
        amount=normalize_money(12.40),
        currency="EUR",
        expense_date=date(2026, 4, 12),
        source="receipt",
        confidence=0.91,
        needs_review=False,
    )
    db_session.add(expense)
    await db_session.flush()

    await replace_expense_items(
        db_session,
        expense,
        [
            {"description": "Milk", "quantity": 1, "unit_price": 1.8, "total": 1.8},
            {"description": "Bread", "quantity": 2, "unit_price": 1.2, "total": 2.4},
        ],
    )
    await replace_expense_items(
        db_session,
        expense,
        [
            {"description": "Coffee", "quantity": 1, "unit_price": 4.5, "total": 4.5},
        ],
    )

    stored_items = (
        (
            await db_session.execute(
                select(ExpenseItem).where(ExpenseItem.expense_id == expense.id).order_by(ExpenseItem.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    assert len(stored_items) == 1
    assert stored_items[0].description == "Coffee"
    assert stored_items[0].total_price == normalize_money(4.5)
    assert [item.description for item in expense.items] == ["Coffee"]


async def test_replace_expense_items_assigns_deterministic_grocery_subcategories(db_session: AsyncSession, test_user):
    grocery_category = Category(user_id=test_user.id, name="Groceries", color="#34d399")
    db_session.add(grocery_category)
    await db_session.flush()

    expense = Expense(
        id=uuid.uuid4(),
        user_id=test_user.id,
        merchant="Neighborhood Market",
        amount=normalize_money(19.80),
        currency="EUR",
        expense_date=date(2026, 4, 12),
        category_id=grocery_category.id,
        source="receipt",
        confidence=0.94,
        needs_review=False,
    )
    db_session.add(expense)
    await db_session.flush()

    await replace_expense_items(
        db_session,
        expense,
        [
            {"description": "Baby spinach", "quantity": 1, "unit_price": 2.2, "total": 2.2},
            {"description": "Chicken breast", "quantity": 1, "unit_price": 8.5, "total": 8.5},
            {"description": "Dish detergent", "quantity": 1, "unit_price": 3.9, "total": 3.9},
        ],
    )

    stored_items = (
        (
            await db_session.execute(
                select(ExpenseItem).where(ExpenseItem.expense_id == expense.id).order_by(ExpenseItem.created_at.asc())
            )
        )
        .scalars()
        .all()
    )

    assert [item.subcategory for item in stored_items] == ["Vegetables", "Meat", "Cleaning Products"]
    assert all(item.subcategory_confidence is not None for item in stored_items)


async def test_dashboard_analytics_derives_grocery_subcategories_for_existing_blank_items(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    grocery_category = Category(user_id=test_user.id, name="Groceries", color="#34d399")
    db_session.add(grocery_category)
    await db_session.flush()

    expense = Expense(
        id=uuid.uuid4(),
        user_id=test_user.id,
        merchant="Fresh Mart",
        amount=normalize_money(17.20),
        currency="EUR",
        expense_date=date(2026, 4, 13),
        category_id=grocery_category.id,
        source="receipt",
        confidence=0.96,
        needs_review=False,
    )
    db_session.add(expense)
    await db_session.flush()
    db_session.add_all(
        [
            ExpenseItem(expense_id=expense.id, description="Bananas", quantity=1, unit_price=1.8, total_price=normalize_money(1.8)),
            ExpenseItem(expense_id=expense.id, description="Laundry detergent", quantity=1, unit_price=5.4, total_price=normalize_money(5.4)),
            ExpenseItem(expense_id=expense.id, description="Pasta", quantity=2, unit_price=1.5, total_price=normalize_money(3.0)),
        ]
    )
    await db_session.commit()

    response = await client.get("/api/analytics/dashboard?month=2026-04", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    grouped_names = {item["name"] for item in payload["grocery_insights"]["top_subcategories"]}
    assert "Fruit" in grouped_names
    assert "Cleaning Products" in grouped_names
    assert "Pantry" in grouped_names
    assert payload["grocery_insights"]["uncategorized_count"] == 0


async def test_dashboard_analytics_separates_money_in_and_out(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    grocery_category = Category(user_id=test_user.id, name="Groceries", color="#34d399", transaction_type="debit")
    salary_category = Category(user_id=test_user.id, name="Salary", color="#10b981", transaction_type="credit")
    db_session.add_all([grocery_category, salary_category])
    await db_session.flush()

    db_session.add_all(
        [
            Expense(
                id=uuid.uuid4(),
                user_id=test_user.id,
                merchant="Fresh Mart",
                amount=normalize_money(40.00),
                transaction_type="debit",
                currency="EUR",
                expense_date=date(2026, 4, 12),
                category_id=grocery_category.id,
                source="manual",
                confidence=1.0,
                needs_review=False,
            ),
            Expense(
                id=uuid.uuid4(),
                user_id=test_user.id,
                merchant="ACME Payroll",
                amount=normalize_money(3000.00),
                transaction_type="credit",
                currency="EUR",
                expense_date=date(2026, 4, 15),
                category_id=salary_category.id,
                source="statement",
                confidence=0.97,
                needs_review=False,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get("/api/analytics/dashboard?month=2026-04", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["money_out"] == 40.0
    assert payload["summary"]["money_in"] == 3000.0
    assert payload["summary"]["net"] == 2960.0
    assert payload["spend_by_category"][0]["name"] == "Groceries"
    assert payload["income_by_category"][0]["name"] == "Salary"


async def test_dashboard_analytics_surfaces_yearly_and_major_one_time_transactions(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    bills_category = Category(user_id=test_user.id, name="Bills", color="#f87171", transaction_type="debit")
    shopping_category = Category(user_id=test_user.id, name="Shopping", color="#22c55e", transaction_type="debit")
    db_session.add_all([bills_category, shopping_category])
    await db_session.flush()

    yearly_insurance = Expense(
        id=uuid.uuid4(),
        user_id=test_user.id,
        merchant="Contoso Insurance",
        amount=normalize_money(680.00),
        transaction_type="debit",
        currency="EUR",
        expense_date=date(2026, 4, 5),
        category_id=bills_category.id,
        source="manual",
        confidence=1.0,
        needs_review=False,
        cadence="yearly",
        cadence_override="yearly",
    )
    phone_purchase = Expense(
        id=uuid.uuid4(),
        user_id=test_user.id,
        merchant="Tech Store",
        amount=normalize_money(1199.00),
        transaction_type="debit",
        currency="EUR",
        expense_date=date(2026, 4, 9),
        category_id=shopping_category.id,
        source="manual",
        confidence=1.0,
        needs_review=False,
        cadence="one_time",
        cadence_override="one_time",
        is_major_purchase=True,
    )
    db_session.add_all([yearly_insurance, phone_purchase])
    await db_session.flush()
    await recompute_recurring_expenses(db_session, test_user.id)
    await db_session.commit()

    response = await client.get("/api/analytics/dashboard?month=2026-04", headers=auth_headers)
    assert response.status_code == 200
    payload = response.json()

    recurring = {item["merchant"]: item for item in payload["recurring_transactions"]}
    assert recurring["Contoso Insurance"]["cadence"] == "yearly"

    major_purchases = {item["merchant"]: item for item in payload["major_one_time_purchases"]}
    assert major_purchases["Tech Store"]["cadence"] == "one_time"
    assert major_purchases["Tech Store"]["is_major_purchase"] is True


async def test_create_expense_from_receipt_is_idempotent_for_repeated_submission(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    receipt = Receipt(
        id=uuid.uuid4(),
        user_id=test_user.id,
        original_filename="duplicate-receipt.jpg",
        stored_filename="duplicate-receipt.jpg",
        content_type="image/jpeg",
        storage_path="receipts/test-user/duplicate-receipt.jpg",
        preview_data={
            "merchant": "Corner Bakery",
            "amount": 9.8,
            "currency": "EUR",
            "expense_date": "2026-04-11",
            "category_name": "Dining",
            "confidence": 0.92,
        },
        extraction_confidence=0.92,
        document_kind="receipt",
        extraction_status="review",
        needs_review=True,
    )
    db_session.add(receipt)
    await db_session.commit()

    payload = {
        "receipt_id": str(receipt.id),
        "merchant": "Corner Bakery",
        "description": "Breakfast",
        "amount": 9.8,
        "currency": "EUR",
        "expense_date": "2026-04-11",
        "category_name": "Dining",
        "confidence": 0.92,
    }
    first_response = await client.post("/api/expenses/from-receipt", json=payload, headers=auth_headers)
    second_response = await client.post("/api/expenses/from-receipt", json=payload, headers=auth_headers)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["id"] == second_response.json()["id"]

    expense_count = await db_session.scalar(select(func.count(Expense.id)).where(Expense.receipt_id == receipt.id))
    assert expense_count == 1

    await db_session.refresh(receipt)
    assert receipt.extraction_status == "finalized"
    assert receipt.finalized_at is not None


async def test_create_expense_from_statement_entry_is_idempotent_for_repeated_submission(client: AsyncClient, auth_headers: dict, db_session: AsyncSession, test_user):
    statement = Receipt(
        id=uuid.uuid4(),
        user_id=test_user.id,
        original_filename="duplicate-statement.pdf",
        stored_filename="duplicate-statement.pdf",
        content_type="application/pdf",
        storage_path="receipts/test-user/duplicate-statement.pdf",
        preview_data={
            "summary": "Parsed 1 statement entry.",
            "confidence": 0.8,
            "entries": [
                {
                    "merchant": "Station Kiosk",
                    "amount": 14.25,
                    "currency": "EUR",
                    "expense_date": "2026-04-12",
                    "description": "STATION KIOSK",
                    "category_name": "Transport",
                    "confidence": 0.86,
                    "status": "pending",
                    "saved_expense_id": None,
                }
            ],
        },
        extraction_confidence=0.8,
        document_kind="statement",
        extraction_status="review",
        needs_review=True,
    )
    db_session.add(statement)
    await db_session.commit()

    payload = {
        "receipt_id": str(statement.id),
        "entry_index": 0,
        "merchant": "Station Kiosk",
        "description": "Transit purchase",
        "amount": 14.25,
        "currency": "EUR",
        "expense_date": "2026-04-12",
        "category_name": "Transport",
        "confidence": 0.86,
    }
    first_response = await client.post("/api/expenses/from-statement-entry", json=payload, headers=auth_headers)
    second_response = await client.post("/api/expenses/from-statement-entry", json=payload, headers=auth_headers)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_response.json()["expense"]["id"] == second_response.json()["expense"]["id"]

    expense_count = await db_session.scalar(select(func.count(Expense.id)).where(Expense.receipt_id == statement.id, Expense.source == "statement"))
    assert expense_count == 1

    await db_session.refresh(statement)
    assert statement.preview_data["entries"][0]["status"] == "finalized"
    assert statement.preview_data["entries"][0]["saved_expense_id"] == first_response.json()["expense"]["id"]
