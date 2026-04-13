"""Monthly report job tests."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.jobs import monthly_reports
from app.models.expense import Expense
from app.models.monthly_report_delivery import MonthlyReportDelivery
from app.services.spendhound import normalize_money

pytestmark = pytest.mark.asyncio


async def test_send_monthly_reports_for_month_records_success(monkeypatch, db_session: AsyncSession, test_user):
    expense = Expense(
        user_id=test_user.id,
        merchant="Metro Grocery",
        description="Weekly food shop",
        amount=normalize_money(24.95),
        transaction_type="debit",
        currency="EUR",
        expense_date=date(2026, 3, 14),
        source="manual",
        confidence=1.0,
        needs_review=False,
        cadence="one_time",
        is_major_purchase=False,
    )
    db_session.add(expense)
    await db_session.commit()

    monkeypatch.setattr(monthly_reports.settings, "monthly_reports_frontend_pdf_url", "http://frontend:3000/api/internal/reports/monthly-pdf")

    async def fake_fetch_monthly_report_pdf(user, report_month):
        assert user.id == test_user.id
        assert report_month == date(2026, 3, 1)
        return b"%PDF-1.4 fake pdf bytes"

    async def fake_send_monthly_report_email(user_email, user_name, report_month, *, expense_json_bytes, dashboard_pdf_bytes):
        assert user_email == test_user.email
        assert user_name == test_user.name
        assert report_month == date(2026, 3, 1)
        assert b'Metro Grocery' in expense_json_bytes
        assert dashboard_pdf_bytes.startswith(b"%PDF-1.4")
        return "re_test_123"

    monkeypatch.setattr(monthly_reports, "fetch_monthly_report_pdf", fake_fetch_monthly_report_pdf)
    monkeypatch.setattr(monthly_reports, "send_monthly_report_email", fake_send_monthly_report_email)

    summary = await monthly_reports.send_monthly_reports_for_month(db_session, date(2026, 3, 1))

    assert summary.report_month == "2026-03"
    assert summary.processed_users == 1
    assert summary.sent_users == 1
    assert summary.failed_users == 0
    assert summary.skipped_users == 0

    delivery = (
        await db_session.execute(
            select(MonthlyReportDelivery).where(
                MonthlyReportDelivery.user_id == test_user.id,
                MonthlyReportDelivery.report_month == date(2026, 3, 1),
            )
        )
    ).scalar_one()
    assert delivery.status == "sent"
    assert delivery.resend_email_id == "re_test_123"
    assert delivery.error_message is None


async def test_send_monthly_reports_for_month_skips_existing_sent_delivery(monkeypatch, db_session: AsyncSession, test_user):
    db_session.add(
        MonthlyReportDelivery(
            user_id=test_user.id,
            report_month=date(2026, 3, 1),
            status="sent",
        )
    )
    await db_session.commit()

    async def should_not_run(*args, **kwargs):
        raise AssertionError("monthly report generation should have been skipped")

    monkeypatch.setattr(monthly_reports, "fetch_monthly_report_pdf", should_not_run)
    monkeypatch.setattr(monthly_reports, "send_monthly_report_email", should_not_run)

    summary = await monthly_reports.send_monthly_reports_for_month(db_session, date(2026, 3, 1))

    assert summary.processed_users == 1
    assert summary.skipped_users == 1
    assert summary.sent_users == 0
    assert summary.failed_users == 0


async def test_send_monthly_reports_for_month_skips_users_with_auto_send_disabled(monkeypatch, db_session: AsyncSession, test_user):
    test_user.automatic_monthly_reports = False
    await db_session.commit()

    async def should_not_run(*args, **kwargs):
        raise AssertionError("monthly report generation should have been skipped")

    monkeypatch.setattr(monthly_reports, "fetch_monthly_report_pdf", should_not_run)
    monkeypatch.setattr(monthly_reports, "send_monthly_report_email", should_not_run)

    summary = await monthly_reports.send_monthly_reports_for_month(db_session, date(2026, 3, 1))

    assert summary.processed_users == 1
    assert summary.skipped_users == 1
    assert summary.sent_users == 0
    assert summary.failed_users == 0


async def test_manual_send_endpoint_resends_and_reuses_existing_delivery(monkeypatch, client, db_session: AsyncSession, test_user, auth_headers):
    existing_delivery = MonthlyReportDelivery(
        user_id=test_user.id,
        report_month=date(2026, 3, 1),
        status="sent",
        resend_email_id="re_old_123",
    )
    db_session.add(existing_delivery)
    await db_session.commit()

    async def fake_fetch_monthly_report_pdf(user, report_month):
        assert user.id == test_user.id
        assert report_month == date(2026, 3, 1)
        return b"%PDF-1.4 manual pdf bytes"

    async def fake_send_monthly_report_email(user_email, user_name, report_month, *, expense_json_bytes, dashboard_pdf_bytes):
        assert user_email == test_user.email
        assert user_name == test_user.name
        assert report_month == date(2026, 3, 1)
        assert dashboard_pdf_bytes.startswith(b"%PDF-1.4")
        return "re_manual_456"

    monkeypatch.setattr(monthly_reports, "fetch_monthly_report_pdf", fake_fetch_monthly_report_pdf)
    monkeypatch.setattr(monthly_reports, "send_monthly_report_email", fake_send_monthly_report_email)

    response = await client.post(
        "/api/monthly-reports/send",
        json={"month": "2026-03"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["report_month"] == "2026-03"
    assert payload["status"] == "sent"
    assert payload["resend_email_id"] == "re_manual_456"

    deliveries = (
        await db_session.execute(
            select(MonthlyReportDelivery).where(
                MonthlyReportDelivery.user_id == test_user.id,
                MonthlyReportDelivery.report_month == date(2026, 3, 1),
            )
        )
    ).scalars().all()
    assert len(deliveries) == 1
    assert deliveries[0].id == existing_delivery.id
    assert deliveries[0].status == "sent"
    assert deliveries[0].resend_email_id == "re_manual_456"
    assert deliveries[0].attempted_at is not None
