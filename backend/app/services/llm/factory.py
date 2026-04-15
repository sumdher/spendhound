"""
LLM provider factory.
Returns the correct provider based on settings or per-request config.
"""

from fastapi import HTTPException

from app.config import settings
from app.models.user import User
from app.services.llm.base import BaseLLMProvider, LLMConfig
from app.services.llm.encryption import decrypt_api_key

# OpenAI-compatible providers with their default base URLs
OPENAI_COMPATIBLE_PROVIDERS: dict[str, str] = {
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "together": "https://api.together.xyz/v1",
    "mistral": "https://api.mistral.ai/v1",
}


def get_llm_provider(config: LLMConfig | None = None) -> BaseLLMProvider:
    """
    Return the appropriate LLM provider.
    config.provider overrides the global LLM_PROVIDER setting.
    """
    provider = (config.provider if config else None) or settings.llm_provider

    if provider == "openai":
        from app.services.llm.openai import OpenAIProvider

        return OpenAIProvider()
    elif provider == "anthropic":
        from app.services.llm.anthropic import AnthropicProvider

        return AnthropicProvider()
    elif provider == "nebius":
        from app.services.llm.nebius import NebiusProvider

        return NebiusProvider()
    elif provider in OPENAI_COMPATIBLE_PROVIDERS:
        from app.services.llm.openai import OpenAIProvider

        # These are all OpenAI-API-compatible; use OpenAIProvider with the right base_url
        if config is None:
            config = LLMConfig(base_url=OPENAI_COMPATIBLE_PROVIDERS[provider])
        elif not config.base_url:
            # Build a new LLMConfig with default base_url for this provider
            config = LLMConfig(
                provider=config.provider,
                model=config.model,
                api_key=config.api_key,
                base_url=OPENAI_COMPATIBLE_PROVIDERS[provider],
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                extra=config.extra,
            )
        return OpenAIProvider()  # OpenAI adapter handles custom base_url via config
    else:  # default: ollama
        from app.services.llm.ollama import OllamaProvider

        return OllamaProvider()


def resolve_user_llm_config(
    user: User,
    request_config: LLMConfig | None = None,
) -> LLMConfig:
    """
    Resolve the LLM configuration for a specific user.

    Priority order:
    1. Per-request api_key (if explicitly provided — backwards compatibility)
    2. User's stored encrypted key from the database
    3. Admin only: fallback to settings (env) — returns LLMConfig with no api_key so
       each provider falls back to its settings.{provider}_api_key
    4. Non-admin with no key: raises HTTP 400 with a clear message

    Ollama never needs an API key — always allowed for any user.
    """
    # Determine effective provider
    effective_provider = (
        (request_config.provider if request_config else None)
        or user.llm_provider
        or settings.llm_provider
    )

    # Ollama never needs an API key
    if effective_provider == "ollama":
        return LLMConfig(
            provider=effective_provider,
            model=(request_config.model if request_config else None) or user.llm_model or settings.ollama_model,
            base_url=(request_config.base_url if request_config else None) or user.llm_base_url or settings.ollama_url,
            temperature=request_config.temperature if request_config else 0.1,
            max_tokens=request_config.max_tokens if request_config else 4096,
        )

    # If the request carries an explicit api_key, use it (backwards compat / admin override)
    if request_config and request_config.api_key:
        return request_config

    # Try user's stored key from the database
    if user.llm_api_key:
        try:
            decrypted_key = decrypt_api_key(user.llm_api_key)
        except ValueError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

        return LLMConfig(
            provider=(request_config.provider if request_config else None) or user.llm_provider,
            model=(request_config.model if request_config else None) or user.llm_model,
            api_key=decrypted_key,
            base_url=(request_config.base_url if request_config else None) or user.llm_base_url,
            temperature=request_config.temperature if request_config else 0.1,
            max_tokens=request_config.max_tokens if request_config else 4096,
        )

    # Admin fallback: use .env keys (return config with no api_key so each provider
    # falls back to settings.{provider}_api_key).
    # Compare case-insensitively: user emails are stored lowercase but ADMIN_EMAIL
    # in the .env file may contain uppercase characters.
    _admin_email_lower = (settings.admin_email or "").strip().lower()
    if _admin_email_lower and user.email.lower() == _admin_email_lower:
        return LLMConfig(
            provider=(request_config.provider if request_config else None) or user.llm_provider,
            model=(request_config.model if request_config else None) or user.llm_model,
            base_url=(request_config.base_url if request_config else None) or user.llm_base_url,
            temperature=request_config.temperature if request_config else 0.1,
            max_tokens=request_config.max_tokens if request_config else 4096,
            # api_key intentionally omitted → provider falls back to settings.{provider}_api_key
        )

    # Non-admin with no stored key and no request key → error
    raise HTTPException(
        status_code=400,
        detail=(
            f"No API key configured for provider '{effective_provider}'. "
            "Please add your API key in Settings → AI Provider."
        ),
    )
