"""
OpenAI LLM provider adapter.
Uses the official openai Python library for both complete() and streaming.
Configure via OPENAI_API_KEY and OPENAI_MODEL environment variables.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig, Message


class OpenAIProvider(BaseLLMProvider):
    """LLM provider backed by the OpenAI Chat Completions API."""

    def _get_client(self, config: LLMConfig | None):
        """Construct an AsyncOpenAI client, honouring per-request overrides."""
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise ValueError(
                "openai package is not installed. Run: pip install openai"
            ) from exc

        api_key = (config.api_key if config else None) or settings.openai_api_key
        base_url = (config.base_url if config else None) or None

        if not api_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        kwargs: dict = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url

        return AsyncOpenAI(**kwargs)

    def _resolve_model(self, config: LLMConfig | None) -> str:
        return (config.model if config else None) or settings.openai_model

    def _build_messages(self, messages: list[Message]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        """Send messages to OpenAI and return the full completion string."""
        client = self._get_client(config)
        model = self._resolve_model(config)
        temperature = config.temperature if config else 0.1
        max_tokens = config.max_tokens if config else 4096

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=self._build_messages(messages),  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
            )
            content = response.choices[0].message.content
            if content is None:
                raise ValueError("OpenAI returned an empty completion.")
            return content
        except Exception as exc:
            # Re-raise as ValueError so callers get a consistent error type.
            raise ValueError(f"OpenAI completion error: {exc}") from exc

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens from OpenAI using AsyncStream."""
        client = self._get_client(config)
        model = self._resolve_model(config)
        temperature = config.temperature if config else 0.1
        max_tokens = config.max_tokens if config else 4096

        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=self._build_messages(messages),  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield delta
        except Exception as exc:
            raise ValueError(f"OpenAI stream error: {exc}") from exc
