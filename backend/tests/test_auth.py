"""Focused tests for authenticated profile endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_get_and_patch_me_manage_automatic_monthly_reports(client, auth_headers):
    get_response = await client.get("/api/auth/me", headers=auth_headers)

    assert get_response.status_code == 200
    assert get_response.json()["automatic_monthly_reports"] is True

    patch_response = await client.patch(
        "/api/auth/me",
        json={"automatic_monthly_reports": False},
        headers=auth_headers,
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["automatic_monthly_reports"] is False

    confirm_response = await client.get("/api/auth/me", headers=auth_headers)
    assert confirm_response.status_code == 200
    assert confirm_response.json()["automatic_monthly_reports"] is False
