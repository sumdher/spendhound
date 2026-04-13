"""Pytest configuration and shared fixtures for SpendHound backend tests."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base, get_db
from app.main import create_app
from app.middleware.auth import create_access_token
from app.models.user import User

# In-memory SQLite for tests (no pgvector, but covers all scalar columns)
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture()
async def engine():
    """Create a fresh async engine for each test."""
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture()
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a fresh session for each test, rolling back after."""
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture()
def app(db_session: AsyncSession) -> FastAPI:
    """Create the FastAPI app with DB dependency overridden to use test session."""
    application = create_app()

    async def override_get_db():
        yield db_session

    application.dependency_overrides[get_db] = override_get_db
    return application


@pytest_asyncio.fixture()
async def client(app: FastAPI) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client pointed at the test app."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture()
async def test_user(db_session: AsyncSession) -> User:
    """Create and persist a test user."""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        name="Test User",
        status="approved",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture()
def auth_headers(test_user: User) -> dict[str, str]:
    """Return Authorization headers for the test user."""
    token = create_access_token(test_user.id, test_user.email)
    return {"Authorization": f"Bearer {token}"}
