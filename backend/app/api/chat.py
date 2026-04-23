"""Expense chat API for SpendHound."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.rate_limit import limiter
from app.config import settings
from app.models.user import User
from app.schemas.chat import ChatHistoryResponse, ChatSessionCreate, ChatSessionResponse, ChatSessionUpdate, ChatSummarizeStreamRequest, ChatStreamRequest
from app.services.expense_chat import ExpenseChatService

router = APIRouter()


@router.get("/sessions", response_model=list[ChatSessionResponse])
async def list_chat_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChatSessionResponse]:
    service = ExpenseChatService(db, current_user)
    return await service.list_sessions(current_user.id)


@router.post("/sessions", response_model=ChatSessionResponse)
async def create_chat_session(
    body: ChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    service = ExpenseChatService(db, current_user)
    return await service.create_session(current_user.id, title=body.title)


@router.patch("/sessions/{session_id}", response_model=ChatSessionResponse)
async def rename_chat_session(
    session_id: uuid.UUID,
    body: ChatSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    service = ExpenseChatService(db, current_user)
    return await service.rename_session(current_user.id, session_id=session_id, title=body.title)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_chat_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    service = ExpenseChatService(db, current_user)
    await service.delete_session(current_user.id, session_id=session_id)
    return Response(status_code=204)


@router.get("/sessions/{session_id}/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryResponse:
    service = ExpenseChatService(db, current_user)
    return await service.get_history(current_user.id, session_id=session_id)


@router.delete("/sessions/{session_id}/history", response_model=ChatHistoryResponse)
async def clear_chat_history(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatHistoryResponse:
    service = ExpenseChatService(db, current_user)
    return await service.clear_history(current_user.id, session_id=session_id)


@router.post("/sessions/{session_id}/stream")
@limiter.limit(f"{settings.rate_limit_chat_per_minute}/minute")
async def stream_chat(
    request: Request,
    session_id: uuid.UUID,
    body: ChatStreamRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    service = ExpenseChatService(db, current_user)
    return StreamingResponse(
        service.stream_chat(current_user.id, session_id=session_id, request=body, http_request=request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/summarize/stream")
@limiter.limit(f"{settings.rate_limit_chat_per_minute}/minute")
async def stream_chat_summary(
    request: Request,
    body: ChatSummarizeStreamRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    service = ExpenseChatService(db, current_user)
    return StreamingResponse(
        service.stream_summary(current_user.id, request=body, http_request=request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
