"""
Anthropic LLM provider adapter.
Uses the official anthropic Python library for both complete() and streaming.
Configure via ANTHROPIC_API_KEY and ANTHROPIC_MODEL environment variables.

Note: Anthropic's Messages API separates the system prompt from the message
list. The first message with role="system" is extracted automatically.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig, Message


def _split_system(messages: list[Message]) -> tuple[str | None, list[Message]]:
    """Extract a leading system message from the message list."""
    if messages and messages[0].role == "system":
        return messages[0].content, messages[1:]
    return None, messages


class AnthropicProvider(BaseLLMProvider):
    """LLM provider backed by the Anthropic Messages API."""

    def _get_client(self, config: LLMConfig | None):
        """Construct an AsyncAnthropic client."""
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:
            raise ValueError(
                "anthropic package is not installed. Run: pip install anthropic"
            ) from exc

        api_key = (config.api_key if config else None) or settings.anthropic_api_key
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is not configured.")

        return AsyncAnthropic(api_key=api_key)

    def _resolve_model(self, config: LLMConfig | None) -> str:
        return (config.model if config else None) or settings.anthropic_model

    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        """Send messages to Anthropic and return the full completion string."""
        client = self._get_client(config)
        model = self._resolve_model(config)
        temperature = config.temperature if config else 0.1
        max_tokens = config.max_tokens if config else 4096

        system_prompt, user_messages = _split_system(messages)
        anthropic_messages = [{"role": m.role, "content": m.content} for m in user_messages]

        kwargs: dict = {
            "model": model,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        try:
            response = await client.messages.create(**kwargs)
            block = response.content[0]
            if hasattr(block, "text"):
                return block.text
            raise ValueError(f"Unexpected Anthropic content block type: {type(block)}")
        except Exception as exc:
            raise ValueError(f"Anthropic completion error: {exc}") from exc

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens from Anthropic."""
        client = self._get_client(config)
        model = self._resolve_model(config)
        temperature = config.temperature if config else 0.1
        max_tokens = config.max_tokens if config else 4096

        system_prompt, user_messages = _split_system(messages)
        anthropic_messages = [{"role": m.role, "content": m.content} for m in user_messages]

        kwargs: dict = {
            "model": model,
            "messages": anthropic_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if system_prompt:
            kwargs["system"] = system_prompt

        try:
            async with client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as exc:
            raise ValueError(f"Anthropic stream error: {exc}") from exc
