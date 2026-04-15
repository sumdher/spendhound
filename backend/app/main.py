"""SpendHound FastAPI application entry point."""

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401
from app.config import settings

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    Path(settings.receipt_storage_dir).mkdir(parents=True, exist_ok=True)
    logger.info("SpendHound backend starting up", llm_provider=settings.llm_provider)
    yield
    logger.info("SpendHound backend shutting down")


def create_app() -> FastAPI:
    app = FastAPI(
        title="SpendHound API",
        description="Expense tracking API with receipt extraction, budgets, analytics, and export.",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api import admin, analytics, auth, budgets, categories, chat, expenses, llm_models, monthly_reports, ollama, receipts

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
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

    return app


app = create_app()
