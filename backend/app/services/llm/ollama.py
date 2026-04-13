"""
Ollama LLM provider adapter.
Uses httpx for both complete() and streaming requests against the Ollama REST API.
Configure via OLLAMA_URL and OLLAMA_MODEL environment variables.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator

import httpx
import structlog

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig, Message


logger = structlog.get_logger(__name__)


class OllamaProvider(BaseLLMProvider):
    """LLM provider backed by a local or remote Ollama instance."""

    @staticmethod
    def _normalize_image(image_data: str) -> str:
        normalized = image_data.strip()
        if normalized.startswith("data:") and ";base64," in normalized:
            normalized = normalized.split(";base64,", 1)[1]
        return normalized

    def _build_payload(self, messages: list[Message], config: LLMConfig | None) -> dict:
        model = (config.model if config else None) or settings.ollama_model
        temperature = config.temperature if config else 0.1
        payload = {
            "model": model,
            "messages": [
                {
                    "role": message.role,
                    "content": message.content,
                    **(
                        {"images": [self._normalize_image(image.data) for image in message.images]}
                        if message.images
                        else {}
                    ),
                }
                for message in messages
            ],
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }
        if config and config.extra.get("format"):
            payload["format"] = config.extra["format"]
        return payload

    def _base_url(self, config: LLMConfig | None) -> str:
        return (config.base_url if config else None) or settings.ollama_url

    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        """Send messages to Ollama and return the full completion string."""
        url = f"{self._base_url(config)}/api/chat"
        payload = self._build_payload(messages, config)
        payload["stream"] = False
        has_images = any(message.images for message in messages)

        logger.debug(
            "ollama.complete.request",
            url=url,
            model=payload["model"],
            message_count=len(messages),
            has_images=has_images,
            image_count=sum(len(message.images) for message in messages),
            response_format=payload.get("format"),
        )

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                content = data.get("message", {}).get("content")
                if content is None:
                    raise ValueError(f"Unexpected Ollama response payload keys: {sorted(data.keys())}")
                return content
        except httpx.HTTPStatusError as exc:
            raise ValueError(
                f"Ollama request failed with status {exc.response.status_code}: {exc.response.text}"
            ) from exc
        except httpx.RequestError as exc:
            raise ValueError(f"Ollama connection error: {exc}") from exc
        except (KeyError, json.JSONDecodeError) as exc:
            raise ValueError(f"Unexpected Ollama response format: {exc}") from exc

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens from Ollama line by line."""
        url = f"{self._base_url(config)}/api/chat"
        payload = self._build_payload(messages, config)
        payload["stream"] = True

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", url, json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield chunk
                        if data.get("done", False):
                            break
        except httpx.HTTPStatusError as exc:
            raise ValueError(
                f"Ollama stream failed with status {exc.response.status_code}: {exc.response.text}"
            ) from exc
        except httpx.RequestError as exc:
            raise ValueError(f"Ollama connection error during stream: {exc}") from exc
