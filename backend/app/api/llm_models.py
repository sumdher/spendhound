"""Dynamic LLM model listing endpoint.

GET /api/llm/models?provider={provider}&api_key={optional}

Supports: openai | anthropic | nebius | groq | together | mistral | openrouter | ollama

Always returns HTTP 200 — empty list on any error (graceful degradation).
Providers that expose pricing: openrouter, together.
"""

from __future__ import annotations

import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, Query

from app.config import settings
from app.middleware.auth import get_current_user
from app.models.user import User
from app.schemas.user import LLMModelInfo, LLMModelPricing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["llm"])

_MAX_MODELS = 200
_TIMEOUT = 10.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

OPENAI_INCLUDE_PREFIXES = ("gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1", "o3", "o4")
OPENAI_EXCLUDE_SUBSTRINGS = (
    "dall-e", "whisper", "tts", "embedding", "moderation", "audio",
    "babbage", "davinci", "search", "realtime", "transcribe",
)
OPENAI_VISION_SUBSTRINGS = ("gpt-4o", "gpt-4-turbo", "o1", "o3", "o4")


def _get_effective_api_key(
    query_api_key: Optional[str],
    user: User,
    provider: str,
) -> Optional[str]:
    """
    Returns the API key to use for the model listing request.
    Priority: query param > user's stored (decrypted) DB key > admin .env fallback.
    """
    if query_api_key:
        return query_api_key

    if user.llm_api_key:
        try:
            from app.services.llm.encryption import decrypt_api_key  # noqa: PLC0415
            return decrypt_api_key(user.llm_api_key)
        except Exception:
            pass

    # Admin fallback: if the logged-in user IS the admin, try env keys
    admin_lower = (settings.admin_email or "").strip().lower()
    if admin_lower and user.email.lower() == admin_lower:
        provider_key_map: dict[str, str] = {
            "openai": settings.openai_api_key or "",
            "anthropic": settings.anthropic_api_key or "",
            "nebius": settings.nebius_api_key or "",
            "groq": getattr(settings, "groq_api_key", "") or "",
            "together": getattr(settings, "together_api_key", "") or "",
            "mistral": getattr(settings, "mistral_api_key", "") or "",
        }
        return provider_key_map.get(provider) or None

    return None


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

async def _list_openai(api_key: str) -> List[LLMModelInfo]:
    """Fetch and filter models from the OpenAI API."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("openai model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        model_id: str = m.get("id", "")
        if not model_id:
            continue

        # Exclude unwanted model types
        lower_id = model_id.lower()
        if any(excl in lower_id for excl in OPENAI_EXCLUDE_SUBSTRINGS):
            continue
        if ":ft-" in model_id:
            continue

        # Only include if starts with a known prefix
        if not any(model_id.startswith(prefix) for prefix in OPENAI_INCLUDE_PREFIXES):
            continue

        vision = any(substr in lower_id for substr in OPENAI_VISION_SUBSTRINGS)
        models.append(LLMModelInfo(id=model_id, name=model_id, supports_vision=vision))

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_anthropic(api_key: str) -> List[LLMModelInfo]:
    """Fetch models from the Anthropic API."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("anthropic model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        if m.get("type") != "model":
            continue
        model_id: str = m.get("id", "")
        display_name: str = m.get("display_name", model_id)
        if not model_id:
            continue
        vision = "claude-3" in model_id or "claude-opus" in model_id or "claude-sonnet" in model_id or "claude-haiku" in model_id
        models.append(LLMModelInfo(id=model_id, name=display_name, supports_vision=vision))

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_openrouter() -> List[LLMModelInfo]:
    """Fetch models from the OpenRouter public API (no auth required)."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get("https://openrouter.ai/api/v1/models")
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("openrouter model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        model_id: str = m.get("id", "")
        if not model_id:
            continue

        arch = m.get("architecture") or {}
        input_modalities: list = arch.get("input_modalities") or []
        output_modalities: list = arch.get("output_modalities") or []

        # Only include text-input models; skip pure image/audio generators
        if "text" not in input_modalities:
            continue
        if output_modalities and all(mod != "text" for mod in output_modalities):
            continue

        vision = "image" in input_modalities

        # Pricing
        pricing_data = m.get("pricing") or {}
        pricing: Optional[LLMModelPricing] = None
        try:
            prompt_cost = pricing_data.get("prompt")
            completion_cost = pricing_data.get("completion")
            if prompt_cost is not None and completion_cost is not None:
                pricing = LLMModelPricing(
                    input_per_1m=float(prompt_cost) * 1_000_000,
                    output_per_1m=float(completion_cost) * 1_000_000,
                )
        except (TypeError, ValueError):
            pass

        models.append(
            LLMModelInfo(
                id=model_id,
                name=m.get("name") or model_id,
                description=m.get("description") or None,
                context_length=m.get("context_length") or None,
                pricing=pricing,
                supports_vision=vision,
            )
        )

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_groq(api_key: str) -> List[LLMModelInfo]:
    """Fetch models from the Groq OpenAI-compatible API."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("groq model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        model_id: str = m.get("id", "")
        if not model_id:
            continue
        if model_id.startswith("whisper"):
            continue
        if "embed" in model_id.lower():
            continue
        vision = "vision" in model_id.lower()
        models.append(LLMModelInfo(id=model_id, name=model_id, supports_vision=vision))

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_together(api_key: str) -> List[LLMModelInfo]:
    """Fetch models from the Together AI API."""
    TOGETHER_CHAT_TYPES = {"chat", "language", "code"}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.together.xyz/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("together model listing failed: %s", exc)
        return []

    # Together AI returns a top-level array (not wrapped in "data")
    raw_list = data if isinstance(data, list) else data.get("data", [])

    models: List[LLMModelInfo] = []
    for m in raw_list:
        model_id: str = m.get("id", "")
        if not model_id:
            continue

        model_type: str = (m.get("type") or "").lower()
        if model_type not in TOGETHER_CHAT_TYPES:
            continue

        display_name: str = m.get("display_name") or m.get("name") or model_id

        # Context length: try config.max_tokens fallback
        ctx = m.get("context_length")
        if ctx is None:
            ctx = (m.get("config") or {}).get("max_tokens")

        # Pricing
        pricing: Optional[LLMModelPricing] = None
        pricing_data = m.get("pricing") or {}
        try:
            in_cost = pricing_data.get("input")
            out_cost = pricing_data.get("output")
            if in_cost is not None and float(in_cost) > 0:
                pricing = LLMModelPricing(
                    input_per_1m=float(in_cost) * 1_000_000,
                    output_per_1m=float(out_cost) * 1_000_000 if out_cost is not None else None,
                )
        except (TypeError, ValueError):
            pass

        vision = model_type == "chat" and "vision" in model_id.lower()

        models.append(
            LLMModelInfo(
                id=model_id,
                name=display_name,
                context_length=int(ctx) if ctx is not None else None,
                pricing=pricing,
                supports_vision=vision,
            )
        )

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_mistral(api_key: str) -> List[LLMModelInfo]:
    """Fetch models from the Mistral AI API."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                "https://api.mistral.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("mistral model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        model_id: str = m.get("id", "")
        if not model_id:
            continue
        if "embed" in model_id.lower():
            continue

        caps = m.get("capabilities") or {}
        vision = bool(caps.get("vision", False))

        models.append(
            LLMModelInfo(
                id=model_id,
                name=m.get("name") or model_id,
                supports_vision=vision,
            )
        )

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_nebius(api_key: str, base_url: Optional[str]) -> List[LLMModelInfo]:
    """Fetch models from the Nebius (OpenAI-compatible) API."""
    nebius_base = (
        base_url
        or settings.nebius_base_url
        or "https://api.studio.nebius.ai"
    ).rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{nebius_base}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("nebius model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("data", []):
        model_id: str = m.get("id", "")
        if not model_id:
            continue
        if "embed" in model_id.lower():
            continue
        models.append(LLMModelInfo(id=model_id, name=model_id))

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


async def _list_ollama(base_url: Optional[str]) -> List[LLMModelInfo]:
    """List locally running Ollama models (reuses ollama.py logic)."""
    from app.api.ollama import EXCLUDED_MODELS  # noqa: PLC0415

    ollama_base = (base_url or settings.ollama_url or "http://localhost:11434").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{ollama_base}/api/tags")
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("ollama model listing failed: %s", exc)
        return []

    models: List[LLMModelInfo] = []
    for m in data.get("models", []):
        name: str = m.get("name", "")
        if not name:
            continue
        if name in EXCLUDED_MODELS:
            continue
        if "embed" in name.lower():
            continue
        models.append(LLMModelInfo(id=name, name=name))

    return sorted(models, key=lambda m: m.id)[:_MAX_MODELS]


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/models", response_model=List[LLMModelInfo])
async def list_llm_models(
    provider: str = Query(..., description="LLM provider name"),
    api_key: Optional[str] = Query(default=None, description="Plaintext API key for this one-time fetch (never stored)"),
    current_user: User = Depends(get_current_user),
) -> List[LLMModelInfo]:
    """
    Return available chat/vision models for the given provider.

    Always returns HTTP 200 — returns [] on any error.
    Providers that include pricing data: openrouter, together.
    """
    provider_lower = provider.strip().lower()

    if provider_lower == "openrouter":
        # Public API — no key needed
        return await _list_openrouter()

    effective_key = _get_effective_api_key(api_key, current_user, provider_lower)

    if provider_lower == "openai":
        if not effective_key:
            return []
        return await _list_openai(effective_key)

    if provider_lower == "anthropic":
        if not effective_key:
            return []
        return await _list_anthropic(effective_key)

    if provider_lower == "groq":
        if not effective_key:
            return []
        return await _list_groq(effective_key)

    if provider_lower == "together":
        if not effective_key:
            return []
        return await _list_together(effective_key)

    if provider_lower == "mistral":
        if not effective_key:
            return []
        return await _list_mistral(effective_key)

    if provider_lower == "nebius":
        if not effective_key:
            return []
        return await _list_nebius(effective_key, current_user.llm_base_url)

    if provider_lower == "ollama":
        return await _list_ollama(current_user.llm_base_url)

    logger.warning("list_llm_models: unknown provider %r", provider)
    return []
