"""Prometheus custom metric definitions for SpendHound.

Three custom metrics complement the standard ones from prometheus-fastapi-instrumentator:

  receipt_queue_depth    Gauge     Current pending tasks in the Celery/Redis queue.
                                   Updated live on every /metrics scrape.

  llm_response_seconds   Histogram complete() call latency, labelled by provider.
                                   Drives p50/p95 panels in Grafana.

  rate_limit_hits_total  Counter   Requests rejected by the rate limiter, labelled by
                                   endpoint path and limit_type (upload/chat/auth/other).
"""

from __future__ import annotations

import time
from collections.abc import AsyncGenerator

from opentelemetry import trace as _otel_trace
from prometheus_client import Counter, Gauge, Histogram

from app.services.llm.base import BaseLLMProvider, LLMConfig, Message

RECEIPT_QUEUE_DEPTH: Gauge = Gauge(
    "receipt_queue_depth",
    "Current number of receipt extraction tasks pending in the Celery/Redis queue",
)

LLM_RESPONSE_SECONDS: Histogram = Histogram(
    "llm_response_seconds",
    "LLM complete() call latency in seconds, labelled by provider",
    ["provider"],
    buckets=(0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 30.0, 60.0, float("inf")),
)

RATE_LIMIT_HITS_TOTAL: Counter = Counter(
    "rate_limit_hits_total",
    "Total requests rejected by the rate limiter",
    ["endpoint", "limit_type"],
)


def classify_limit_type(path: str) -> str:
    if "/receipts" in path:
        return "upload"
    if "/chat" in path:
        return "chat"
    if "/auth" in path:
        return "auth"
    return "other"


class MeteredLLMProvider(BaseLLMProvider):
    """Wraps any BaseLLMProvider and records llm_response_seconds on complete()."""

    def __init__(self, inner: BaseLLMProvider, provider_name: str) -> None:
        self._inner = inner
        self._provider_name = provider_name

    async def complete(self, messages: list[Message], config: LLMConfig | None = None) -> str:
        tracer = _otel_trace.get_tracer(__name__)
        with tracer.start_as_current_span(
            "llm.complete",
            attributes={"gen_ai.system": self._provider_name},
        ) as span:
            start = time.monotonic()
            try:
                return await self._inner.complete(messages, config)
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(_otel_trace.Status(_otel_trace.StatusCode.ERROR))
                raise
            finally:
                LLM_RESPONSE_SECONDS.labels(provider=self._provider_name).observe(
                    time.monotonic() - start
                )

    async def stream(
        self, messages: list[Message], config: LLMConfig | None = None
    ) -> AsyncGenerator[str, None]:
        async for chunk in self._inner.stream(messages, config):
            yield chunk
