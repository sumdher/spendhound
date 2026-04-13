"""One-shot monthly report delivery job."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.monthly_report_delivery import MonthlyReportDelivery
from app.models.user import User
from app.services.email import send_monthly_report_email
from app.services.report_exports import build_expense_export_json_bytes

logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class MonthlyReportJobSummary:
    report_month: str
    processed_users: int = 0
    skipped_users: int = 0
    sent_users: int = 0
    failed_users: int = 0


@dataclass(slots=True)
class MonthlyReportSendResult:
    report_month: str
    outcome: str
    delivery: MonthlyReportDelivery


def previous_calendar_month_start(reference_datetime: datetime | None = None) -> date:
    timezone_name = ZoneInfo(settings.monthly_reports_timezone)
    local_now = reference_datetime.astimezone(timezone_name) if reference_datetime else datetime.now(timezone_name)
    if local_now.month == 1:
        return date(local_now.year - 1, 12, 1)
    return date(local_now.year, local_now.month - 1, 1)


async def fetch_monthly_report_pdf(user: User, report_month: date) -> bytes:
    if not settings.monthly_reports_frontend_pdf_url:
        raise RuntimeError("MONTHLY_REPORTS_FRONTEND_PDF_URL is not configured")

    headers = {"Accept": "application/pdf"}
    if settings.monthly_reports_frontend_token:
        headers[settings.monthly_reports_frontend_token_header] = settings.monthly_reports_frontend_token

    payload = {
        "user_id": str(user.id),
        "user_email": user.email,
        "user_name": user.name,
        "report_month": report_month.strftime("%Y-%m"),
    }

    async with httpx.AsyncClient(timeout=settings.monthly_reports_frontend_timeout_seconds) as client:
        response = await client.post(settings.monthly_reports_frontend_pdf_url, headers=headers, json=payload)
        response.raise_for_status()

    if not response.content:
        raise RuntimeError("Frontend PDF response was empty")

    content_type = response.headers.get("content-type", "")
    if content_type and "pdf" not in content_type.lower():
        logger.warning(
            "monthly_reports.frontend_pdf.unexpected_content_type",
            user_id=str(user.id),
            report_month=report_month.strftime("%Y-%m"),
            content_type=content_type,
        )
    return response.content


async def get_or_create_monthly_report_delivery(
    db: AsyncSession,
    *,
    user_id,
    report_month: date,
) -> MonthlyReportDelivery:
    delivery_result = await db.execute(
        select(MonthlyReportDelivery).where(
            MonthlyReportDelivery.user_id == user_id,
            MonthlyReportDelivery.report_month == report_month,
        )
    )
    delivery = delivery_result.scalar_one_or_none()
    if delivery is None:
        delivery = MonthlyReportDelivery(user_id=user_id, report_month=report_month, status="pending")
        db.add(delivery)
        await db.flush()
    return delivery


async def send_monthly_report_for_user(
    db: AsyncSession,
    user: User,
    report_month: date,
    *,
    force: bool = False,
) -> MonthlyReportSendResult:
    report_month_key = report_month.strftime("%Y-%m")
    delivery = await get_or_create_monthly_report_delivery(db, user_id=user.id, report_month=report_month)

    if not force and delivery.status == "sent":
        logger.info(
            "monthly_reports.delivery.skipped",
            user_id=str(user.id),
            email=user.email,
            report_month=report_month_key,
            reason="already_sent",
        )
        return MonthlyReportSendResult(report_month=report_month_key, outcome="skipped", delivery=delivery)

    try:
        attempted_at = datetime.now(timezone.utc)
        delivery.status = "pending"
        delivery.attempted_at = attempted_at
        delivery.sent_at = None
        delivery.error_message = None
        delivery.resend_email_id = None
        delivery.pdf_source_url = settings.monthly_reports_frontend_pdf_url or None

        expense_json_bytes = await build_expense_export_json_bytes(db, user_id=user.id, month=report_month_key)
        dashboard_pdf_bytes = await fetch_monthly_report_pdf(user, report_month)
        resend_email_id = await send_monthly_report_email(
            user.email,
            user.name,
            report_month,
            expense_json_bytes=expense_json_bytes,
            dashboard_pdf_bytes=dashboard_pdf_bytes,
        )
        if not resend_email_id:
            raise RuntimeError("Monthly report email was not sent; verify Resend configuration")

        delivery.status = "sent"
        delivery.sent_at = datetime.now(timezone.utc)
        delivery.resend_email_id = resend_email_id
        await db.commit()
        await db.refresh(delivery)
        logger.info(
            "monthly_reports.delivery.sent",
            user_id=str(user.id),
            email=user.email,
            report_month=report_month_key,
            resend_email_id=resend_email_id,
            forced=force,
        )
        return MonthlyReportSendResult(report_month=report_month_key, outcome="sent", delivery=delivery)
    except Exception as error:
        delivery.status = "failed"
        delivery.error_message = str(error)
        delivery.resend_email_id = None
        await db.commit()
        await db.refresh(delivery)
        logger.error(
            "monthly_reports.delivery.failed",
            user_id=str(user.id),
            email=user.email,
            report_month=report_month_key,
            error=str(error),
            forced=force,
        )
        return MonthlyReportSendResult(report_month=report_month_key, outcome="failed", delivery=delivery)


async def send_monthly_reports_for_month(db: AsyncSession, report_month: date) -> MonthlyReportJobSummary:
    report_month_key = report_month.strftime("%Y-%m")
    summary = MonthlyReportJobSummary(report_month=report_month_key)
    users_result = await db.execute(select(User).where(User.status == "approved").order_by(User.created_at.asc()))

    for user in users_result.scalars().all():
        summary.processed_users += 1
        if not user.automatic_monthly_reports:
            summary.skipped_users += 1
            logger.info(
                "monthly_reports.delivery.skipped",
                user_id=str(user.id),
                email=user.email,
                report_month=report_month_key,
                reason="automatic_monthly_reports_disabled",
            )
            continue

        result = await send_monthly_report_for_user(db, user, report_month)
        if result.outcome == "sent":
            summary.sent_users += 1
        elif result.outcome == "failed":
            summary.failed_users += 1
        else:
            summary.skipped_users += 1

    return summary


async def run_monthly_report_job(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    *,
    reference_datetime: datetime | None = None,
) -> MonthlyReportJobSummary:
    report_month = previous_calendar_month_start(reference_datetime)
    summary = MonthlyReportJobSummary(report_month=report_month.strftime("%Y-%m"))

    if not settings.monthly_reports_enabled:
        logger.info("monthly_reports.job.disabled", report_month=summary.report_month)
        return summary

    async_session_factory = session_factory or AsyncSessionLocal
    async with async_session_factory() as db:
        summary = await send_monthly_reports_for_month(db, report_month)

    logger.info(
        "monthly_reports.job.completed",
        report_month=summary.report_month,
        processed_users=summary.processed_users,
        skipped_users=summary.skipped_users,
        sent_users=summary.sent_users,
        failed_users=summary.failed_users,
    )
    return summary


def main() -> None:
    asyncio.run(run_monthly_report_job())


if __name__ == "__main__":
    main()
