"""Focused tests for admin authorization and approval controls."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.middleware.auth import create_access_token
from app.models.user import User


def _auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.email)}"}


@pytest.mark.asyncio
async def test_admin_panel_access_and_review_controls(client, db_session):
    original_admin_email = settings.admin_email
    settings.admin_email = "srsudhir31@gmail.com"

    try:
        admin_user = User(
            id=uuid.uuid4(),
            email=settings.admin_email,
            name="Admin User",
            status="approved",
        )
        regular_user = User(
            id=uuid.uuid4(),
            email="member@example.com",
            name="Member User",
            status="pending",
        )
        non_admin = User(
            id=uuid.uuid4(),
            email="not-admin@example.com",
            name="Not Admin",
            status="approved",
        )

        db_session.add_all([admin_user, regular_user, non_admin])
        await db_session.commit()

        status_response = await client.get("/api/auth/status", headers=_auth_headers(admin_user))
        assert status_response.status_code == 200
        assert status_response.json() == {"status": "approved", "is_admin": True}

        panel_response = await client.get("/api/admin/panel/users", headers=_auth_headers(admin_user))
        assert panel_response.status_code == 200
        returned_emails = {user["email"] for user in panel_response.json()}
        assert settings.admin_email in returned_emails
        assert regular_user.email in returned_emails

        forbidden_response = await client.get("/api/admin/panel/users", headers=_auth_headers(non_admin))
        assert forbidden_response.status_code == 403

        invalid_status_response = await client.patch(
            f"/api/admin/panel/users/{regular_user.id}/status",
            json={"status": "pending"},
            headers=_auth_headers(admin_user),
        )
        assert invalid_status_response.status_code == 400
        assert "approved" in invalid_status_response.json()["detail"]
        assert "rejected" in invalid_status_response.json()["detail"]

        approve_response = await client.patch(
            f"/api/admin/panel/users/{regular_user.id}/status",
            json={"status": "approved"},
            headers=_auth_headers(admin_user),
        )
        assert approve_response.status_code == 200
        assert approve_response.json()["status"] == "approved"
    finally:
        settings.admin_email = original_admin_email


@pytest.mark.asyncio
async def test_google_auth_auto_approves_configured_admin(client, db_session):
    original_admin_email = settings.admin_email
    settings.admin_email = "srsudhir31@gmail.com"

    try:
        existing_admin = User(
            id=uuid.uuid4(),
            email=settings.admin_email,
            name="Pending Admin",
            status="pending",
        )
        db_session.add(existing_admin)
        await db_session.commit()

        ensure_categories = AsyncMock()
        send_approval_email = AsyncMock()

        with (
            patch(
                "app.api.auth.id_token.verify_oauth2_token",
                return_value={
                    "email": "SRSudhir31@gmail.com",
                    "name": "Sudhir",
                    "picture": "https://example.com/avatar.png",
                },
            ),
            patch("app.api.auth.ensure_default_categories", new=ensure_categories),
            patch("app.api.auth.send_approval_request_email", new=send_approval_email),
        ):
            response = await client.post("/api/auth/google", json={"id_token": "fake-google-token"})

        assert response.status_code == 200
        payload = response.json()
        assert payload["user"]["email"] == settings.admin_email
        assert payload["user"]["status"] == "approved"
        assert payload["user"]["is_admin"] is True

        await db_session.refresh(existing_admin)
        assert existing_admin.status == "approved"
        ensure_categories.assert_awaited_once()
        send_approval_email.assert_not_awaited()
    finally:
        settings.admin_email = original_admin_email
