"""
Ollama LLM provider adapter.
Uses httpx for both complete() and streaming requests against the Ollama REST API.
Configure via OLLAMA_URL and OLLAMA_MODEL environment variables.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

import httpx
import structlog
from fastapi import HTTPException

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig, Message


logger = structlog.get_logger(__name__)

# Module-level singleton — created lazily inside the running event loop on first call.
# A single Semaphore(N) serialises all concurrent Ollama calls across the whole process.
# This works correctly only with a single uvicorn worker (--workers 1).
_llm_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _llm_semaphore
    if _llm_semaphore is None:
        _llm_semaphore = asyncio.Semaphore(settings.ollama_max_concurrent)
    return _llm_semaphore


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
        try:
            await asyncio.wait_for(
                _get_semaphore().acquire(), timeout=settings.llm_semaphore_wait_timeout
            )
        except asyncio.TimeoutError:
            logger.warning(
                "ollama.complete.semaphore_timeout",
                max_concurrent=settings.ollama_max_concurrent,
            )
            raise HTTPException(status_code=503, detail="LLM is busy. Please try again in a moment.")

        try:
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

            timeout = httpx.Timeout(
                connect=30.0, read=float(settings.llm_timeout_seconds), write=30.0, pool=10.0
            )
            async with httpx.AsyncClient(timeout=timeout) as client:
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
        finally:
            _get_semaphore().release()

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens from Ollama. Acquires the global semaphore first."""
        try:
            await asyncio.wait_for(
                _get_semaphore().acquire(), timeout=settings.llm_semaphore_wait_timeout
            )
        except asyncio.TimeoutError:
            logger.warning(
                "ollama.stream.semaphore_timeout",
                max_concurrent=settings.ollama_max_concurrent,
            )
            # Raising here means the SSE response will close immediately.
            # expense_chat.py catches ValueError from the provider and emits an SSE error event.
            raise ValueError("LLM is busy. Please try again in a moment.")

        try:
            async for chunk in self._stream_inner(messages, config):
                yield chunk
        finally:
            _get_semaphore().release()

    async def _stream_inner(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Raw streaming loop — called only while the semaphore is held."""
        url = f"{self._base_url(config)}/api/chat"
        payload = self._build_payload(messages, config)
        payload["stream"] = True
        timeout = httpx.Timeout(
            connect=30.0, read=float(settings.llm_timeout_seconds), write=30.0, pool=10.0
        )

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
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
