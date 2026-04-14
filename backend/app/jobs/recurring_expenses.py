"""One-shot recurring expense generation job."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User
from app.services.spendhound import generate_recurring_expenses_for_month

logger = structlog.get_logger(__name__)


@dataclass(slots=True)
class RecurringExpenseGenerationSummary:
    target_month: str
    processed_users: int = 0
    skipped_users: int = 0
    generated_expenses: int = 0


def current_calendar_month_start(reference_datetime: datetime | None = None) -> date:
    timezone_name = ZoneInfo(settings.recurring_generation_timezone)
    local_now = reference_datetime.astimezone(timezone_name) if reference_datetime else datetime.now(timezone_name)
    return date(local_now.year, local_now.month, 1)


async def generate_recurring_expenses_for_all_users(
    db: AsyncSession,
    target_month: date,
) -> RecurringExpenseGenerationSummary:
    summary = RecurringExpenseGenerationSummary(target_month=target_month.strftime("%Y-%m"))
    users_result = await db.execute(select(User).where(User.status == "approved").order_by(User.created_at.asc()))

    for user in users_result.scalars().all():
        summary.processed_users += 1
        generated = await generate_recurring_expenses_for_month(db, user.id, target_month)
        if generated:
            summary.generated_expenses += len(generated)
        else:
            summary.skipped_users += 1

    return summary


async def run_recurring_expense_generation_job(
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    *,
    reference_datetime: datetime | None = None,
) -> RecurringExpenseGenerationSummary:
    target_month = current_calendar_month_start(reference_datetime)
    summary = RecurringExpenseGenerationSummary(target_month=target_month.strftime("%Y-%m"))

    if not settings.recurring_generation_enabled:
        logger.info("recurring_expenses.job.disabled", target_month=summary.target_month)
        return summary

    async_session_factory = session_factory or AsyncSessionLocal
    async with async_session_factory() as db:
        summary = await generate_recurring_expenses_for_all_users(db, target_month)
        await db.commit()

    logger.info(
        "recurring_expenses.job.completed",
        target_month=summary.target_month,
        processed_users=summary.processed_users,
        skipped_users=summary.skipped_users,
        generated_expenses=summary.generated_expenses,
    )
    return summary


def main() -> None:
    asyncio.run(run_recurring_expense_generation_job())


if __name__ == "__main__":
    main()
