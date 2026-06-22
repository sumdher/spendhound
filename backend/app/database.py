"""Async database engine and session factory for SpendHound."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.config import settings

engine_kwargs: dict[str, object] = {
    "echo": settings.debug,
    "pool_pre_ping": True,
}

if not settings.database_url.startswith("sqlite"):
    engine_kwargs["pool_size"] = settings.db_pool_size
    engine_kwargs["max_overflow"] = settings.db_max_overflow
    engine_kwargs["pool_timeout"] = 30  # fail fast if pool exhausted instead of blocking
    engine_kwargs["pool_recycle"] = 1800  # recycle stale connections every 30 min

# FastAPI engine - connection pool shared across the process lifetime.
engine = create_async_engine(settings.database_url, **engine_kwargs)

# Session factory for FastAPI request handlers.
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Celery tasks call asyncio.run() for each task, creating a new event loop every
# time. The pooled engine above keeps asyncpg connections alive across calls;
# those connections hold asyncio Futures bound to the previous (now closed) loop,
# causing "Future attached to a different loop" on the second task run.
# NullPool disables connection reuse entirely: each checkout opens a fresh
# connection and each checkin closes it, so there is no cross-loop state.
_celery_engine = create_async_engine(
    settings.database_url,
    poolclass=NullPool,
    echo=settings.debug,
)

CelerySessionLocal = async_sessionmaker(
    _celery_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""

    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
