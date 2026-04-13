"""
JWT authentication middleware and FastAPI dependency.
Verifies HS256 JWTs issued by the backend auth endpoint.

get_current_user — requires approved status (use for protected routes).
get_any_user     — no status check (use for /api/auth/status polling).
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

bearer_scheme = HTTPBearer()


def create_access_token(user_id: uuid.UUID, email: str) -> str:
    """Create a signed JWT for the given user."""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expiry_days)
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT. Raises HTTPException on failure."""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e


async def _fetch_user(
    credentials: HTTPAuthorizationCredentials,
    db: AsyncSession,
) -> User:
    """Decode JWT and fetch the corresponding User from DB."""
    payload = decode_token(credentials.credentials)
    user_id_str: str | None = payload.get("sub")

    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
        )

    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token",
        ) from e

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency: verifies JWT and fetches user.
    Raises 403 if the user is not approved (pending / rejected).
    Use on all normal protected routes.
    """
    user = await _fetch_user(credentials, db)

    if user.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Account not approved. Current status: {user.status}.",
        )

    return user


async def get_any_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency: verifies JWT and fetches user WITHOUT checking approval status.
    Use only on endpoints that pending/rejected users must be able to reach
    (e.g. GET /api/auth/status for the polling pending page).
    """
    return await _fetch_user(credentials, db)
