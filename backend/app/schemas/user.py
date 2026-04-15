"""
Pydantic v2 schemas for user-related API responses.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserResponse(BaseModel):
    """Public user profile returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    status: str
    is_admin: bool = False
    automatic_monthly_reports: bool = True
    receipt_prompt_override: Optional[str] = None
    created_at: datetime


class UserUpdateRequest(BaseModel):
    """Authenticated user profile updates supported by the API."""

    automatic_monthly_reports: bool


class UserReceiptPromptUpdateRequest(BaseModel):
    receipt_prompt_override: Optional[str] = None
