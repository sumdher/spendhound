"""Email service for SpendHound account approval notifications."""

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)
RESEND_API_URL = "https://api.resend.com/emails"


async def send_approval_request_email(user_email: str, user_name: str | None, approve_url: str, reject_url: str) -> None:
    if not settings.admin_email:
        logger.warning("ADMIN_EMAIL not set — skipping approval request email")
        return
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set — skipping approval request email")
        return
    from_addr = settings.resend_from_email or "SpendHound <onboarding@resend.dev>"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": from_addr,
                    "to": [settings.admin_email],
                    "subject": f"[SpendHound] Access request from {user_email}",
                    "html": _approval_email_html(user_email, user_name, approve_url, reject_url),
                },
            )
            response.raise_for_status()
        logger.info("Approval request email sent", to=settings.admin_email)
    except Exception as error:
        logger.error("Failed to send approval request email", error=str(error))


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
