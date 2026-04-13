"""
LLM provider factory.
Returns the correct provider based on settings or per-request config.
"""

from app.config import settings
from app.services.llm.base import BaseLLMProvider, LLMConfig


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
    else:  # default: ollama
        from app.services.llm.ollama import OllamaProvider

        return OllamaProvider()
