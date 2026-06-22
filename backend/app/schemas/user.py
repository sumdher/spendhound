"""
Pydantic v2 schemas for user-related API responses.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserResponse(BaseModel):
    """Public user profile returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str | None = None
    avatar_url: str | None = None
    status: str
    is_admin: bool = False
    automatic_monthly_reports: bool = True
    receipt_prompt_override: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_base_url: str | None = None
    has_llm_api_key: bool = (
        False  # True if a stored encrypted key exists — never return the raw key
    )
    created_at: datetime


class UserUpdateRequest(BaseModel):
    """Authenticated user profile updates supported by the API."""

    automatic_monthly_reports: bool


class UserReceiptPromptUpdateRequest(BaseModel):
    receipt_prompt_override: str | None = None


class UserLLMSettingsUpdateRequest(BaseModel):
    """Request schema for updating a user's LLM provider settings and API key."""

    llm_provider: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None  # Plaintext; backend encrypts before storing
    llm_base_url: str | None = None
    clear_api_key: bool = False  # If True, delete the stored key


class LLMTestRequest(BaseModel):
    """Request schema for testing LLM settings without saving them."""

    provider: str | None = None
    model: str | None = None
    api_key: str | None = None  # Plaintext, NOT saved to DB
    base_url: str | None = None


class LLMTestResponse(BaseModel):
    """Response schema for the LLM test endpoint."""

    success: bool
    response: str | None = None  # LLM reply on success
    error: str | None = None  # Error message on failure


class LLMModelPricing(BaseModel):
    """Per-provider token pricing when the API exposes it."""

    input_per_1m: float | None = None  # USD per 1M input tokens
    output_per_1m: float | None = None  # USD per 1M output tokens


class LLMModelInfo(BaseModel):
    """Metadata for a single chat/vision model returned by the listing endpoint."""

    id: str  # model identifier (used in API calls)
    name: str  # display name
    description: str | None = None
    context_length: int | None = None
    pricing: LLMModelPricing | None = None  # None = no pricing info available
    supports_vision: bool = False  # true if image input supported
