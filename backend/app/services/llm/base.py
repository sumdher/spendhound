"""
Base class for all LLM provider adapters.
All adapters implement complete() and stream() with the same interface.
Switching provider requires only env var changes, no code changes.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field


@dataclass
class Message:
    """A chat message with role and content."""

    role: str  # "system" | "user" | "assistant"
    content: str


@dataclass
class LLMConfig:
    """Per-request LLM configuration (can override server defaults)."""

    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    temperature: float = 0.1
    max_tokens: int = 4096
    extra: dict = field(default_factory=dict)


class BaseLLMProvider(ABC):
    """Abstract base class for all LLM providers."""

    @abstractmethod
    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        """Send messages and return the full completion as a string."""
        ...

    @abstractmethod
    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream completion tokens. Yields string chunks."""
        ...
