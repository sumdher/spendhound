"""Email service helpers for SpendHound transactional emails."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)
RESEND_API_URL = "https://api.resend.com/emails"


@dataclass(slots=True, frozen=True)
class EmailAttachment:
    filename: str
    content: bytes


def _default_from_addr() -> str:
    return settings.resend_from_email or "SpendHound <onboarding@resend.dev>"


def _serialize_attachment(attachment: EmailAttachment) -> dict[str, str]:
    return {
        "filename": attachment.filename,
        "content": base64.b64encode(attachment.content).decode("ascii"),
    }


async def send_email(
    *,
    to: list[str],
    subject: str,
    html: str,
    attachments: list[EmailAttachment] | None = None,
    from_addr: str | None = None,
) -> dict | None:
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set — skipping email send", subject=subject)
        return None

    payload: dict[str, object] = {
        "from": from_addr or _default_from_addr(),
        "to": to,
        "subject": subject,
        "html": html,
    }
    if attachments:
        payload["attachments"] = [_serialize_attachment(attachment) for attachment in attachments]

    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def send_approval_request_email(user_email: str, user_name: str | None, approve_url: str, reject_url: str) -> None:
    if not settings.admin_email:
        logger.warning("ADMIN_EMAIL not set — skipping approval request email")
        return
    try:
        response = await send_email(
            to=[settings.admin_email],
            subject=f"[SpendHound] Access request from {user_email}",
            html=_approval_email_html(user_email, user_name, approve_url, reject_url),
        )
        if response is not None:
            logger.info("Approval request email sent", to=settings.admin_email, resend_email_id=response.get("id"))
    except Exception as error:
        logger.error("Failed to send approval request email", error=str(error))


async def send_monthly_report_email(
    user_email: str,
    user_name: str | None,
    report_month: date,
    *,
    expense_json_bytes: bytes,
    dashboard_pdf_bytes: bytes,
) -> str | None:
    report_month_key = report_month.strftime("%Y-%m")
    report_month_label = report_month.strftime("%B %Y")
    response = await send_email(
        to=[user_email],
        subject=f"[SpendHound] Your monthly report for {report_month_label}",
        html=_monthly_report_email_html(user_email, user_name, report_month_label),
        attachments=[
            EmailAttachment(
                filename=f"spendhound-expenses-{report_month_key}.json",
                content=expense_json_bytes,
            ),
            EmailAttachment(
                filename=f"spendhound-dashboard-{report_month_key}.pdf",
                content=dashboard_pdf_bytes,
            ),
        ],
    )
    if response is None:
        return None
    logger.info("Monthly report email sent", to=user_email, report_month=report_month_key, resend_email_id=response.get("id"))
    return response.get("id")


def _approval_email_html(user_email: str, user_name: str | None, approve_url: str, reject_url: str) -> str:
    name = user_name or user_email
    return f"""<!DOCTYPE html>
<html>
<body style='font-family: sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 32px;'>
  <h2 style='color: #3b82f6; margin-bottom: 8px;'>SpendHound — New Access Request</h2>
  <p style='color: #6b7280;'>A new user is requesting access:</p>
  <table style='border-collapse: collapse; margin: 16px 0; width: 100%;'>
    <tr><td style='padding: 6px 16px 6px 0; color: #9ca3af; width: 80px;'>Name</td><td style='padding: 6px 0;'><strong>{name}</strong></td></tr>
    <tr><td style='padding: 6px 16px 6px 0; color: #9ca3af;'>Email</td><td style='padding: 6px 0;'><strong>{user_email}</strong></td></tr>
  </table>
  <div style='margin: 28px 0;'>
    <a href='{approve_url}' style='background: #22c55e; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-right: 12px; display: inline-block;'>✓ Approve Access</a>
    <a href='{reject_url}' style='background: #ef4444; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;'>✗ Reject</a>
  </div>
  <p style='color: #9ca3af; font-size: 12px; margin-top: 32px;'>These links expire in 72 hours. Sent by SpendHound.</p>
</body>
</html>"""


def _monthly_report_email_html(user_email: str, user_name: str | None, report_month_label: str) -> str:
    name = user_name or user_email
    return f"""<!DOCTYPE html>
<html>
<body style='font-family: sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 32px;'>
  <h2 style='color: #3b82f6; margin-bottom: 8px;'>SpendHound — Monthly Report</h2>
  <p>Hello <strong>{name}</strong>,</p>
  <p>Your monthly SpendHound report for <strong>{report_month_label}</strong> is attached.</p>
  <ul>
    <li>A full JSON expense export for the reporting month</li>
    <li>A dashboard PDF snapshot generated by the frontend</li>
  </ul>
  <p style='color: #6b7280;'>This email was generated automatically by SpendHound.</p>
</body>
</html>"""
