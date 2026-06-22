"""
Rate limiter using slowapi (a FastAPI port of Flask-Limiter) backed by Redis.

Key design decisions:
- Per-user-ID key for authenticated endpoints (JWT sub claim), per-IP for auth endpoints.
- Redis storage: counters survive backend restarts and are consistent across deploys.
  The storage_uri is driven by settings.redis_url so the backend and any future
  workers all share the same counter store.
- Limits are configurable via settings so you can tune without code changes.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings


def _rate_limit_key(request: Request) -> str:
    """
    Use JWT sub (user ID) for authenticated requests, IP address for anonymous ones.
    Keying by user ID prevents a single user from abusing expensive endpoints
    even if they rotate IPs (e.g. VPN, mobile data).
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            from app.middleware.auth import decode_token

            payload = decode_token(auth[7:])
            return f"user:{payload.get('sub', 'unknown')}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_rate_limit_key, storage_uri=settings.redis_url, strategy="moving-window"
)
