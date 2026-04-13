"""Pydantic schemas for SpendHound expense chat."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatSessionCreate(BaseModel):
    title: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    role: str
    content: str
    client_id: str
    parent_client_id: str | None = None
    provider: str | None = None
    model: str | None = None
    token_count: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    summary: str | None = None
    token_count: int
    max_tokens: int
    message_count: int = 0
    last_message_preview: str | None = None
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChatHistoryResponse(BaseModel):
    session: ChatSessionResponse
    messages: list[ChatMessageResponse]


class ChatStreamRequest(BaseModel):
    message: str
    client_id: str | None = None
    parent_client_id: str | None = None
    assistant_client_id: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    temperature: float = 0.1
    max_tokens: int = 4096


class ChatSummarizeStreamRequest(BaseModel):
    session_id: UUID | None = None
    prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    temperature: float = 0.1
    max_tokens: int = 1024
