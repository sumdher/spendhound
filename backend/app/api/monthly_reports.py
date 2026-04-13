"""Authenticated monthly report delivery endpoints."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.jobs.monthly_reports import send_monthly_report_for_user
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.spendhound import month_start_from_string

router = APIRouter()


class ManualMonthlyReportSendRequest(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class MonthlyReportSendResponse(BaseModel):
    report_month: str
    status: str
    resend_email_id: str | None = None
    attempted_at: str | None = None
    sent_at: str | None = None


def _parse_report_month(month: str) -> date:
    try:
        return month_start_from_string(month)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="month must be a valid YYYY-MM value") from error


@router.post("/send", response_model=MonthlyReportSendResponse)
async def send_monthly_report(
    body: ManualMonthlyReportSendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MonthlyReportSendResponse:
    report_month = _parse_report_month(body.month)
    result = await send_monthly_report_for_user(db, current_user, report_month, force=True)
    delivery = result.delivery
    return MonthlyReportSendResponse(
        report_month=result.report_month,
        status=delivery.status,
        resend_email_id=delivery.resend_email_id,
        attempted_at=delivery.attempted_at.isoformat() if delivery.attempted_at else None,
        sent_at=delivery.sent_at.isoformat() if delivery.sent_at else None,
    )
