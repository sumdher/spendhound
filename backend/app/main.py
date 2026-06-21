"""SpendHound FastAPI application entry point."""

import hmac
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import prometheus_fastapi_instrumentator.routing as _pfi_routing
import structlog
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import app.models
from app.config import settings
from app.middleware.rate_limit import limiter
from app.services.cache import close_redis, get_celery_queue_depth, init_redis
from app.services.metrics import RATE_LIMIT_HITS_TOTAL, RECEIPT_QUEUE_DEPTH, classify_limit_type

logger = structlog.get_logger(__name__)


_DEFAULT_JWT_SECRET = "change-me-in-production"


def _check_startup_secrets() -> None:
    if settings.jwt_secret == _DEFAULT_JWT_SECRET:
        raise RuntimeError(
            "JWT_SECRET is set to the insecure default value. "
            "Generate a strong secret and set JWT_SECRET in your .env before starting."
        )
    if settings.monthly_reports_enabled and not settings.monthly_reports_frontend_token:
        logger.warning(
            "monthly_reports_enabled=true but MONTHLY_REPORTS_FRONTEND_TOKEN is empty — "
            "the internal PDF endpoint is unauthenticated"
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    if not settings.debug:
        _check_startup_secrets()

    Path(settings.receipt_storage_dir).mkdir(parents=True, exist_ok=True)

    # Redis client — used for rate limiting storage, analytics cache, and LLM
    # model list cache. Startup ping failure is non-fatal; the app degrades.
    await init_redis()

    logger.info(
        "SpendHound backend starting up",
        llm_provider=settings.llm_provider,
        ollama_max_concurrent=settings.ollama_max_concurrent,
    )
    yield

    await close_redis()
    logger.info("SpendHound backend shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="SpendHound API",
        description="Expense tracking API with receipt extraction, budgets, analytics, and export.",
        version="0.1.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
        lifespan=lifespan,
    )

    # Rate limiting — keyed by user ID (authenticated) or IP (anonymous).
    # Works correctly only with --workers 1 (single process = single shared limiter).
    app.state.limiter = limiter

    async def _rate_limit_handler(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, RateLimitExceeded)
        path = request.url.path
        RATE_LIMIT_HITS_TOTAL.labels(endpoint=path, limit_type=classify_limit_type(path)).inc()
        return _rate_limit_exceeded_handler(request, exc)

    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Starlette 0.40+ adds _IncludedRouter objects to app.routes when include_router()
    # is used. prometheus-fastapi-instrumentator unconditionally accesses route.path on
    # every route, but _IncludedRouter has no .path → AttributeError on every request.
    # Patch the private function to skip such routes until the upstream fixes this.
    _original_get_route_name = _pfi_routing._get_route_name

    def _safe_get_route_name(scope, routes, route_name=None):  # type: ignore[no-untyped-def]
        return _original_get_route_name(
            scope,
            [r for r in routes if hasattr(r, "path")],
            route_name,
        )

    _pfi_routing._get_route_name = _safe_get_route_name

    # Instrument all routes: records http_request_duration_seconds + http_requests_total
    # automatically. We do NOT call .expose() — our own /metrics endpoint below handles
    # exposition with bearer-token protection.
    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
    ).instrument(app)

    from app.api import (
        admin,
        analytics,
        auth,
        budgets,
        categories,
        chat,
        expenses,
        ledgers,
        llm_models,
        monthly_reports,
        ollama,
        partners,
        receipts,
    )

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
    app.include_router(partners.router, prefix="/api/partners", tags=["partners"])
    app.include_router(ledgers.router, prefix="/api/ledgers", tags=["ledgers"])
    app.include_router(categories.router, prefix="/api/categories", tags=["categories"])
    app.include_router(budgets.router, prefix="/api/budgets", tags=["budgets"])
    app.include_router(expenses.router, prefix="/api/expenses", tags=["expenses"])
    app.include_router(receipts.router, prefix="/api/receipts", tags=["receipts"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
    app.include_router(monthly_reports.router, prefix="/api/monthly-reports", tags=["monthly-reports"])
    app.include_router(ollama.router)
    app.include_router(llm_models.router)

    @app.get("/health", tags=["health"])
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "service": "spendhound-backend"}

    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint(authorization: str = Header(default="")) -> Response:
        """Prometheus scrape endpoint — bearer token required."""
        token = settings.metrics_token
        if not token or not hmac.compare_digest(
            authorization.encode(), f"Bearer {token}".encode()
        ):
            raise HTTPException(status_code=403, detail="Forbidden")
        depth = await get_celery_queue_depth()
        RECEIPT_QUEUE_DEPTH.set(depth)
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()  # type: ignore[assignment]
