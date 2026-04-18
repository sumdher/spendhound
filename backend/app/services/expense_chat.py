"""SpendHound expense chat service built on structured finance context."""

from __future__ import annotations

import json
import math
import re
import uuid
from collections.abc import AsyncGenerator
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.budget import Budget
from app.models.category import Category
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.receipt import Receipt
from app.schemas.chat import ChatHistoryResponse, ChatMessageResponse, ChatSessionResponse, ChatSummarizeStreamRequest, ChatStreamRequest
from app.models.user import User
from app.services.receipt_extraction import create_llm_config
from app.services.spendhound import month_start_from_string
from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider, resolve_user_llm_config


SYSTEM_PROMPT = """You are SpendHound's expense assistant.
You have direct access to the user's real expense data — it is injected into every message in the structured finance context below.
This context includes: this month's spending totals, category breakdowns, top merchants, budgets, recurring charges, receipt items, and recent transactions.
Today's date and the exact data range are stated at the top of the finance context — always reference them when answering date-relative questions like "this month", "this week", or "recently".
Never say you do not have access to the user's data. The data IS provided. If a specific figure is absent from the context, say that particular detail is not in the available data, but never claim general lack of access.
Do not invent transactions, categories, budgets, or receipt details — only reference what appears in the context.
Keep answers concise, practical, and finance-focused.
When discussing money, include the currency when it is available in the context.
"""

TITLE_MAX_WORDS = 8
TITLE_FALLBACK = "New Chat"
TITLE_SYSTEM_PROMPT = (
    "You write concise modern chat titles. "
    "Return only the title, with no quotes or surrounding commentary."
)


class ExpenseChatService:
    """Application service for session-based expense chat."""

    def __init__(self, db: AsyncSession, user: User):
        self.db = db
        self.user = user

    async def list_sessions(self, user_id: uuid.UUID) -> list[ChatSessionResponse]:
        result = await self.db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .options(selectinload(ChatSession.messages))
            .order_by(ChatSession.last_message_at.desc().nullslast(), ChatSession.updated_at.desc())
        )
        return [self._session_response(session) for session in result.scalars().all()]

    async def create_session(self, user_id: uuid.UUID, *, title: str | None = None) -> ChatSessionResponse:
        clean_title = (title or "New Chat").strip() or "New Chat"
        session = ChatSession(
            user_id=user_id,
            title=clean_title[:255],
            max_tokens=4096,
            token_count=0,
            last_message_at=None,
        )
        self.db.add(session)
        await self.db.flush()
        await self.db.refresh(session)
        return self._session_response(session)

    async def rename_session(
        self, user_id: uuid.UUID, *, session_id: uuid.UUID, title: str
    ) -> ChatSessionResponse:
        session = await self._get_session(user_id, session_id)
        clean_title = title.strip()
        if not clean_title:
            raise HTTPException(status_code=400, detail="Title is required")
        session.title = clean_title[:255]
        await self.db.flush()
        await self.db.refresh(session)
        return self._session_response(session)

    async def delete_session(self, user_id: uuid.UUID, *, session_id: uuid.UUID) -> None:
        session = await self._get_session(user_id, session_id)
        await self.db.delete(session)
        await self.db.flush()

    async def get_history(self, user_id: uuid.UUID, *, session_id: uuid.UUID) -> ChatHistoryResponse:
        session = await self._get_session(user_id, session_id, load_messages=True)
        messages = [self._message_response(message) for message in session.messages]
        return ChatHistoryResponse(session=self._session_response(session), messages=messages)

    async def clear_history(self, user_id: uuid.UUID, *, session_id: uuid.UUID) -> ChatHistoryResponse:
        session = await self._get_session(user_id, session_id)
        await self.db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
        session.summary = None
        session.token_count = 0
        session.last_message_at = None
        await self.db.flush()
        await self.db.refresh(session)
        return ChatHistoryResponse(session=self._session_response(session), messages=[])

    async def stream_chat(
        self, user_id: uuid.UUID, *, session_id: uuid.UUID, request: ChatStreamRequest
    ) -> AsyncGenerator[str, None]:
        session = await self._get_session(user_id, session_id, load_messages=True)
        llm_config = self._build_llm_config(request)
        provider_name, model_name = self._resolve_provider_and_model(llm_config)
        user_client_id = request.client_id or f"user-{uuid.uuid4()}"
        assistant_client_id = request.assistant_client_id or f"assistant-{uuid.uuid4()}"
        user_message = ChatMessage(
            user_id=user_id,
            session_id=session.id,
            role="user",
            content=request.message.strip(),
            client_id=user_client_id,
            parent_client_id=request.parent_client_id,
            token_count=self._estimate_tokens(request.message),
            message_metadata={"kind": "chat", "source": "expense_chat"},
        )
        self.db.add(user_message)
        await self.db.flush()

        history_messages = [message for message in session.messages if message.id != user_message.id]
        prompt_messages = await self._build_chat_prompt_messages(
            user_id=user_id,
            session=session,
            history_messages=history_messages,
            user_prompt=user_message.content,
        )
        provider = get_llm_provider(llm_config)

        accumulated = ""
        meta_payload = {
            "mode": "chat",
            "session": self._session_response(session).model_dump(mode="json"),
            "request_message": {
                "id": str(user_message.id),
                "client_id": user_message.client_id,
                "parent_client_id": user_message.parent_client_id,
            },
            "assistant_client_id": assistant_client_id,
            "provider": provider_name,
            "model": model_name,
        }
        yield self._sse_event("meta", meta_payload)

        try:
            async for chunk in provider.stream(prompt_messages, llm_config):
                if not chunk:
                    continue
                accumulated += chunk
                yield self._sse_event("token", {"text": chunk, "token": chunk})
        except Exception as exc:
            session.last_message_at = datetime.now(timezone.utc)
            session.max_tokens = request.max_tokens
            session.token_count += user_message.token_count or 0
            if session.title == TITLE_FALLBACK:
                session.title = await self._generate_title(user_message.content, llm_config)
            await self.db.flush()
            yield self._sse_event("error", {"error": str(exc)})
            yield self._sse_event("done", {"ok": False})
            return

        assistant_message = ChatMessage(
            user_id=user_id,
            session_id=session.id,
            role="assistant",
            content=accumulated.strip(),
            client_id=assistant_client_id,
            parent_client_id=user_message.client_id,
            provider=provider_name,
            model=model_name,
            token_count=self._estimate_tokens(accumulated),
            message_metadata={"kind": "chat", "source": "expense_chat"},
        )
        self.db.add(assistant_message)
        session.last_message_at = datetime.now(timezone.utc)
        session.max_tokens = request.max_tokens
        session.token_count += (user_message.token_count or 0) + (assistant_message.token_count or 0)
        if session.title == TITLE_FALLBACK:
            session.title = await self._generate_title(user_message.content, llm_config)
        await self.db.flush()
        await self.db.refresh(session)
        await self.db.refresh(assistant_message)
        yield self._sse_event(
            "done",
            {
                "ok": True,
                "session": self._session_response(session).model_dump(mode="json"),
                "message": self._message_response(assistant_message).model_dump(mode="json"),
            },
        )

    async def stream_summary(
        self, user_id: uuid.UUID, *, request: ChatSummarizeStreamRequest
    ) -> AsyncGenerator[str, None]:
        llm_config = self._build_llm_config(request)
        provider_name, model_name = self._resolve_provider_and_model(llm_config)
        provider = get_llm_provider(llm_config)
        session: ChatSession | None = None
        history_messages: list[ChatMessage] = []
        if request.session_id is not None:
            session = await self._get_session(user_id, request.session_id, load_messages=True)
            history_messages = session.messages[-12:]

        finance_context = await self._build_finance_context(user_id)
        summary_prompt = self._build_summary_prompt(
            finance_context=finance_context,
            prompt=request.prompt,
            session=session,
            history_messages=history_messages,
        )
        messages = [Message(role="system", content=SYSTEM_PROMPT), Message(role="user", content=summary_prompt)]

        yield self._sse_event(
            "meta",
            {
                "mode": "summary",
                "session_id": str(session.id) if session else None,
                "provider": provider_name,
                "model": model_name,
            },
        )

        accumulated = ""
        try:
            async for chunk in provider.stream(messages, llm_config):
                if not chunk:
                    continue
                accumulated += chunk
                yield self._sse_event("token", {"text": chunk, "token": chunk})
        except Exception as exc:
            yield self._sse_event("error", {"error": str(exc)})
            yield self._sse_event("done", {"ok": False})
            return

        if session is not None:
            session.summary = accumulated.strip()[:4000] or None
            await self.db.flush()
        yield self._sse_event("done", {"ok": True, "summary": accumulated.strip()})

    async def _get_session(
        self, user_id: uuid.UUID, session_id: uuid.UUID, *, load_messages: bool = False
    ) -> ChatSession:
        statement = select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        if load_messages:
            statement = statement.options(selectinload(ChatSession.messages))
        result = await self.db.execute(statement)
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=404, detail="Chat session not found")
        return session

    async def _build_chat_prompt_messages(
        self,
        *,
        user_id: uuid.UUID,
        session: ChatSession,
        history_messages: list[ChatMessage],
        user_prompt: str,
    ) -> list[Message]:
        finance_context = await self._build_finance_context(user_id)
        contextual_system = SYSTEM_PROMPT + "\n\n" + self._build_context_block(session=session, finance_context=finance_context)
        prompt_messages: list[Message] = [Message(role="system", content=contextual_system)]
        for message in history_messages[-16:]:
            if message.role not in {"user", "assistant"}:
                continue
            prompt_messages.append(Message(role=message.role, content=message.content))
        prompt_messages.append(Message(role="user", content=user_prompt))
        return prompt_messages

    async def _build_finance_context(self, user_id: uuid.UUID) -> str:
        today = date.today()
        current_month = month_start_from_string(today.strftime("%Y-%m"))
        next_month = date(current_month.year + (1 if current_month.month == 12 else 0), 1 if current_month.month == 12 else current_month.month + 1, 1)
        lookback_date = today - timedelta(days=90)

        recent_expenses_result = await self.db.execute(
            select(Expense, Category.name)
            .outerjoin(Category, Category.id == Expense.category_id)
            .where(Expense.user_id == user_id)
            .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
            .limit(12)
        )
        recent_expenses = recent_expenses_result.all()

        category_totals_result = await self.db.execute(
            select(Category.name, Expense.transaction_type, Expense.currency, func.sum(Expense.amount))
            .select_from(Expense)
            .outerjoin(Category, Category.id == Expense.category_id)
            .where(Expense.user_id == user_id, Expense.expense_date >= lookback_date)
            .group_by(Category.name, Expense.transaction_type, Expense.currency)
            .order_by(func.sum(Expense.amount).desc())
            .limit(12)
        )

        merchant_totals_result = await self.db.execute(
            select(Expense.merchant, Expense.currency, func.sum(Expense.amount), func.count(Expense.id))
            .where(
                Expense.user_id == user_id,
                Expense.expense_date >= lookback_date,
                Expense.transaction_type == "debit",
            )
            .group_by(Expense.merchant, Expense.currency)
            .order_by(func.sum(Expense.amount).desc())
            .limit(8)
        )

        recurring_result = await self.db.execute(
            select(Expense.merchant, Expense.cadence, Expense.currency, func.avg(Expense.amount), func.count(Expense.id))
            .where(
                Expense.user_id == user_id,
                (Expense.is_recurring.is_(True)) | (Expense.cadence != "one_time"),
            )
            .group_by(Expense.merchant, Expense.cadence, Expense.currency)
            .order_by(func.count(Expense.id).desc(), func.avg(Expense.amount).desc())
            .limit(8)
        )

        budget_result = await self.db.execute(
            select(Budget, Category.name)
            .outerjoin(Category, Category.id == Budget.category_id)
            .where(Budget.user_id == user_id, Budget.month_start == current_month)
            .order_by(Budget.amount.desc())
        )
        budgets = budget_result.all()

        monthly_spend_result = await self.db.execute(
            select(Expense.category_id, func.sum(Expense.amount))
            .where(
                Expense.user_id == user_id,
                Expense.transaction_type == "debit",
                Expense.expense_date >= current_month,
                Expense.expense_date < next_month,
            )
            .group_by(Expense.category_id)
        )
        monthly_spend_by_category = {category_id: float(total or 0) for category_id, total in monthly_spend_result.all()}

        month_total_result = await self.db.execute(
            select(func.sum(Expense.amount))
            .where(
                Expense.user_id == user_id,
                Expense.transaction_type == "debit",
                Expense.expense_date >= current_month,
                Expense.expense_date < next_month,
            )
        )
        month_total_spend = float(month_total_result.scalar() or 0)

        receipt_items_result = await self.db.execute(
            select(ExpenseItem.description, func.sum(ExpenseItem.total_price), func.count(ExpenseItem.id))
            .select_from(ExpenseItem)
            .join(Expense, Expense.id == ExpenseItem.expense_id)
            .where(Expense.user_id == user_id, Expense.expense_date >= lookback_date)
            .group_by(ExpenseItem.description)
            .order_by(func.sum(ExpenseItem.total_price).desc().nullslast(), func.count(ExpenseItem.id).desc())
            .limit(10)
        )

        receipt_result = await self.db.execute(
            select(Receipt.original_filename, Receipt.document_kind, Receipt.extraction_status, Receipt.created_at)
            .where(Receipt.user_id == user_id)
            .order_by(Receipt.created_at.desc())
            .limit(5)
        )

        sections: list[str] = []
        sections.append("=== DATE CONTEXT ===")
        sections.append(f"Today's date: {today.isoformat()} ({today.strftime('%A, %B %d, %Y')})")
        sections.append(f"Current month: {today.strftime('%B %Y')} — starts {current_month.isoformat()}, ends {(next_month - timedelta(days=1)).isoformat()}")
        sections.append(f"Expense data range: {lookback_date.isoformat()} to {today.isoformat()} (last 90 days)")
        sections.append("====================")
        sections.append("")
        sections.append("Recent expenses:")
        if recent_expenses:
            sections.extend(
                f"- {expense.expense_date.isoformat()} | {expense.merchant} | {float(expense.amount):.2f} {expense.currency} | {expense.transaction_type} | {category_name or 'Uncategorized'}"
                for expense, category_name in recent_expenses
            )
        else:
            sections.append("- No expenses available.")

        sections.append("Category totals over last 90 days:")
        totals = category_totals_result.all()
        if totals:
            sections.extend(
                f"- {(category_name or 'Uncategorized')}: {float(total or 0):.2f} {currency} ({transaction_type})"
                for category_name, transaction_type, currency, total in totals
            )
        else:
            sections.append("- No category totals available.")

        sections.append("Budgets for current month:")
        if budgets:
            for budget, category_name in budgets:
                actual = month_total_spend if budget.category_id is None else monthly_spend_by_category.get(budget.category_id, 0.0)
                sections.append(
                    f"- {budget.name}: budget {float(budget.amount):.2f} {budget.currency}, spent {actual:.2f} {budget.currency}, remaining {float(budget.amount) - actual:.2f} {budget.currency} | category {category_name or 'All spending'}"
                )
        else:
            sections.append("- No budgets set for the current month.")

        sections.append("Top merchants over last 90 days:")
        merchants = merchant_totals_result.all()
        if merchants:
            sections.extend(
                f"- {merchant}: {float(total or 0):.2f} {currency} across {int(count)} expenses"
                for merchant, currency, total, count in merchants
            )
        else:
            sections.append("- No merchant trends available.")

        sections.append("Recurring spend patterns:")
        recurring_rows = recurring_result.all()
        if recurring_rows:
            sections.extend(
                f"- {merchant}: {cadence} avg {float(avg_amount or 0):.2f} {currency} across {int(count)} occurrences"
                for merchant, cadence, currency, avg_amount, count in recurring_rows
            )
        else:
            sections.append("- No recurring expenses detected.")

        sections.append("Receipt-derived items:")
        item_rows = receipt_items_result.all()
        if item_rows:
            sections.extend(
                f"- {description}: {float(total or 0):.2f} across {int(count)} line items"
                for description, total, count in item_rows
            )
        else:
            sections.append("- No receipt line items available.")

        sections.append("Recent receipts:")
        receipt_rows = receipt_result.all()
        if receipt_rows:
            sections.extend(
                f"- {created_at.date().isoformat()} | {original_filename} | {document_kind} | {extraction_status}"
                for original_filename, document_kind, extraction_status, created_at in receipt_rows
            )
        else:
            sections.append("- No uploaded receipts available.")

        return "\n".join(sections)

    def _build_context_block(self, *, session: ChatSession, finance_context: str) -> str:
        session_summary = session.summary or "No saved summary yet."
        return f"Session title: {session.title}\nSession summary: {session_summary}\n\nStructured finance context:\n{finance_context}"

    def _build_summary_prompt(
        self,
        *,
        finance_context: str,
        prompt: str | None,
        session: ChatSession | None,
        history_messages: list[ChatMessage],
    ) -> str:
        history_text = "\n".join(f"- {message.role}: {message.content}" for message in history_messages[-12:])
        return (
            "Summarize the user's finances using the structured SpendHound context below. "
            "Prioritize notable spend trends, category outliers, budgets at risk, recurring charges, and helpful next actions.\n\n"
            f"Additional user request: {(prompt or 'Provide a concise overall summary.').strip()}\n\n"
            f"Session title: {session.title if session else 'N/A'}\n"
            f"Recent chat history:\n{history_text or '- No prior chat history.'}\n\n"
            f"Finance context:\n{finance_context}"
        )

    def _session_response(self, session: ChatSession) -> ChatSessionResponse:
        messages = list(session.__dict__.get("messages", []))
        last_preview = messages[-1].content[:160] if messages else None
        return ChatSessionResponse(
            id=session.id,
            title=session.title,
            summary=session.summary,
            token_count=session.token_count,
            max_tokens=session.max_tokens,
            message_count=len(messages),
            last_message_preview=last_preview,
            last_message_at=session.last_message_at,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )

    def _message_response(self, message: ChatMessage) -> ChatMessageResponse:
        return ChatMessageResponse(
            id=message.id,
            session_id=message.session_id,
            role=message.role,
            content=message.content,
            client_id=message.client_id,
            parent_client_id=message.parent_client_id,
            provider=message.provider,
            model=message.model,
            token_count=message.token_count,
            metadata=message.message_metadata or {},
            created_at=message.created_at,
            updated_at=message.updated_at,
        )

    def _build_llm_config(self, request: ChatStreamRequest | ChatSummarizeStreamRequest) -> LLMConfig:
        # Build a config from any explicit request params (may all be None)
        request_config = create_llm_config(
            provider=request.provider,
            model=request.model,
            api_key=request.api_key,
            base_url=request.base_url,
        )
        # Resolve final config using user's stored settings as fallback
        resolved = resolve_user_llm_config(self.user, request_config)
        # Always honour temperature and max_tokens from the chat request
        resolved.temperature = request.temperature
        resolved.max_tokens = request.max_tokens
        return resolved

    async def _generate_title(self, message: str, llm_config: LLMConfig) -> str:
        fallback = self._derive_title(message)
        compact = " ".join(message.strip().split())
        if not compact:
            return TITLE_FALLBACK

        title_config = LLMConfig(
            provider=llm_config.provider,
            model=llm_config.model,
            api_key=llm_config.api_key,
            base_url=llm_config.base_url,
            temperature=0.2,
            max_tokens=32,
            extra=llm_config.extra,
        )

        try:
            provider = get_llm_provider(title_config)
            raw_title = await provider.complete(
                [
                    Message(role="system", content=TITLE_SYSTEM_PROMPT),
                    Message(
                        role="user",
                        content=(
                            "Create a concise title for this expense chat.\n"
                            f"Use at most {TITLE_MAX_WORDS} words.\n"
                            "Reflect the user's main intent.\n"
                            "Return title only.\n\n"
                            f"User message: {compact}"
                        ),
                    ),
                ],
                title_config,
            )
        except Exception:
            return fallback

        cleaned = self._clean_generated_title(raw_title)
        return cleaned or fallback

    def _derive_title(self, message: str) -> str:
        compact = " ".join(message.strip().split())
        if not compact:
            return TITLE_FALLBACK

        words = compact.split(" ")
        title = " ".join(words[:TITLE_MAX_WORDS]).rstrip(".,:;!? ")
        return title[:255] or TITLE_FALLBACK

    def _clean_generated_title(self, raw_title: str) -> str:
        cleaned = " ".join(raw_title.strip().split())
        cleaned = cleaned.strip().strip("\"'`“”")
        cleaned = re.sub(r"^title\s*[:\-]\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.rstrip(".,:;!? ")
        words = [word for word in cleaned.split(" ") if word]
        if not words:
            return TITLE_FALLBACK
        return " ".join(words[:TITLE_MAX_WORDS])[:255]

    def _estimate_tokens(self, text: str) -> int:
        return max(1, math.ceil(len(text.strip()) / 4))

    def _resolve_provider_and_model(self, llm_config: LLMConfig) -> tuple[str, str]:
        provider_name = llm_config.provider or settings.llm_provider
        if provider_name == "openai":
            return provider_name, llm_config.model or settings.openai_model
        if provider_name == "anthropic":
            return provider_name, llm_config.model or settings.anthropic_model
        if provider_name == "nebius":
            return provider_name, llm_config.model or settings.nebius_model
        return provider_name, llm_config.model or settings.ollama_model

    def _sse_event(self, event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
