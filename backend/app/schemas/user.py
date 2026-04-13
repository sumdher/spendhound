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
    created_at: datetime
