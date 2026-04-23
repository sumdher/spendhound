"""
In-process rate limiter using slowapi (a FastAPI port of Flask-Limiter).

Key design decisions:
- Per-user-ID key for authenticated endpoints (JWT sub claim), per-IP for auth endpoints.
- In-memory storage — correct for single uvicorn worker (--workers 1).
  If you ever move to multiple workers, replace with a Redis backend.
- Limits are configurable via settings so you can tune without code changes.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


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


limiter = Limiter(key_func=_rate_limit_key)
