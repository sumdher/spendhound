"""
Nebius LLM provider adapter.
Nebius exposes an OpenAI-compatible API; we reuse the openai library with a
custom base_url override.
Configure via NEBIUS_API_KEY, NEBIUS_MODEL, and NEBIUS_BASE_URL environment
variables.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig, Message


class NebiusProvider(BaseLLMProvider):
    """LLM provider backed by Nebius AI Studio (OpenAI-compatible endpoint)."""

    def _get_client(self, config: LLMConfig | None):
        """Construct an AsyncOpenAI client pointing at the Nebius base URL."""
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise ValueError(
                "openai package is not installed. Run: pip install openai"
            ) from exc

        api_key = (config.api_key if config else None) or settings.nebius_api_key
        base_url = (config.base_url if config else None) or settings.nebius_base_url

        if not api_key:
            raise ValueError("NEBIUS_API_KEY is not configured.")
        if not base_url:
            raise ValueError("NEBIUS_BASE_URL is not configured.")

        return AsyncOpenAI(api_key=api_key, base_url=base_url)

    def _resolve_model(self, config: LLMConfig | None) -> str:
        return (config.model if config else None) or settings.nebius_model

    def _build_messages(self, messages: list[Message]) -> list[dict]:
        built_messages: list[dict] = []
        for message in messages:
            if message.images:
                content: list[dict] = []
                if message.content:
                    content.append({"type": "text", "text": message.content})
                content.extend(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{image.media_type};base64,{image.data}"},
                    }
                    for image in message.images
                )
                built_messages.append({"role": message.role, "content": content})
            else:
                built_messages.append({"role": message.role, "content": message.content})
        return built_messages

    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        """Send messages to Nebius and return the full completion string."""
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
                raise ValueError("Nebius returned an empty completion.")
            return content
        except Exception as exc:
            raise ValueError(f"Nebius completion error: {exc}") from exc

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens from Nebius using AsyncStream."""
        client = self._get_client(config)
        model = self._resolve_model(config)
        temperature = config.temperature if config else 0.1
        max_tokens = config.max_tokens if config else 4096

        try:
            async with client.chat.completions.stream(
                model=model,
                messages=self._build_messages(messages),  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=max_tokens,
            ) as stream:
                async for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        yield delta
        except Exception as exc:
            raise ValueError(f"Nebius stream error: {exc}") from exc
