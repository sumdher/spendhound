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
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_base_url: Optional[str] = None
    has_llm_api_key: bool = False  # True if a stored encrypted key exists — never return the raw key
    created_at: datetime


class UserUpdateRequest(BaseModel):
    """Authenticated user profile updates supported by the API."""

    automatic_monthly_reports: bool


class UserReceiptPromptUpdateRequest(BaseModel):
    receipt_prompt_override: Optional[str] = None


class UserLLMSettingsUpdateRequest(BaseModel):
    """Request schema for updating a user's LLM provider settings and API key."""

    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_api_key: Optional[str] = None   # Plaintext; backend encrypts before storing
    llm_base_url: Optional[str] = None
    clear_api_key: bool = False          # If True, delete the stored key


class LLMTestRequest(BaseModel):
    """Request schema for testing LLM settings without saving them."""

    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None       # Plaintext, NOT saved to DB
    base_url: Optional[str] = None


class LLMTestResponse(BaseModel):
    """Response schema for the LLM test endpoint."""

    success: bool
    response: Optional[str] = None     # LLM reply on success
    error: Optional[str] = None        # Error message on failure


class LLMModelPricing(BaseModel):
    """Per-provider token pricing when the API exposes it."""

    input_per_1m: Optional[float] = None   # USD per 1M input tokens
    output_per_1m: Optional[float] = None  # USD per 1M output tokens


class LLMModelInfo(BaseModel):
    """Metadata for a single chat/vision model returned by the listing endpoint."""

    id: str                                 # model identifier (used in API calls)
    name: str                               # display name
    description: Optional[str] = None
    context_length: Optional[int] = None
    pricing: Optional[LLMModelPricing] = None  # None = no pricing info available
    supports_vision: bool = False           # true if image input supported
