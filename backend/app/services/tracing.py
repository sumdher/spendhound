"""OpenTelemetry tracing setup for SpendHound.

Call setup_tracing() once at process startup. No-op when otel_endpoint is empty.
Idempotent - safe to call multiple times; only the first call takes effect.

Instrumented libraries (auto):
  FastAPI/Starlette  - HTTP request spans with route, method, status
  SQLAlchemy         - every DB query as a child span
  HTTPX              - outbound HTTP calls (LLM provider APIs, Puppeteer)
  Redis              - cache get/set/delete spans
  Celery             - task publish (in API process) + task execute (in worker)

Manual spans are added in MeteredLLMProvider.complete() with provider attributes.
"""

from __future__ import annotations

import structlog

logger = structlog.get_logger(__name__)

_initialized = False


def setup_tracing(service_name: str, endpoint: str) -> None:
    """Configure the global TracerProvider and auto-instrument common libraries.

    service_name: label in Grafana Tempo service map (e.g. spendhound-api)
    endpoint:     OTLP HTTP base URL for Grafana Tempo (e.g. http://tempo:4318)
    """
    global _initialized
    if _initialized or not endpoint:
        return
    _initialized = True

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.celery import CeleryInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.sdk.resources import SERVICE_NAME, Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource(attributes={SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(provider)

    SQLAlchemyInstrumentor().instrument()
    HTTPXClientInstrumentor().instrument()
    RedisInstrumentor().instrument()
    CeleryInstrumentor().instrument()  # type: ignore[no-untyped-call]

    logger.info("tracing.initialized", service=service_name, endpoint=endpoint)


def instrument_fastapi(app: object) -> None:
    """Add OTel HTTP tracing middleware to an already-created FastAPI app.

    Must be called after setup_tracing() and after the FastAPI app instance
    exists. Calling FastAPIInstrumentor().instrument() without an app patches
    FastAPI.__init__ globally and conflicts with the Prometheus Instrumentator
    middleware added later in create_app(), producing an unpredictable
    middleware stack that causes intermittent request failures.
    """
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)  # type: ignore[arg-type]
    logger.info("tracing.fastapi_instrumented")
