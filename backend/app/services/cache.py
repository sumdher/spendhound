"""Async Redis singleton and cache helpers for SpendHound.

All public functions are safe to call even when Redis is unavailable — they
catch every exception, log a warning, and return None / no-op so a Redis
outage never propagates to the caller.
"""

from __future__ import annotations

import json
import uuid

import structlog

from app.config import settings

logger = structlog.get_logger(__name__)

# Module-level singleton — set in lifespan startup, cleared on shutdown.
# Type annotation kept as Any to avoid importing redis at module level
# (the package may not be installed in test environments without Redis).
_redis_client = None

_ANALYTICS_KEY_PREFIX = "analytics:dashboard"


# ── Lifecycle ─────────────────────────────────────────────────────────────────


async def init_redis() -> None:
    """Initialise the singleton Redis client. Call once from lifespan startup.

    If Redis is unreachable the client is still created — redis-py reconnects
    automatically once Redis comes back. A warning is logged but the app starts.
    """
    global _redis_client
    try:
        import redis.asyncio as aioredis

        _redis_client = aioredis.Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
        await _redis_client.ping()
        logger.info("cache.redis.connected", url=settings.redis_url)
    except Exception as exc:
        logger.warning(
            "cache.redis.startup_ping_failed",
            error=str(exc),
            note="Cache disabled until Redis recovers; app continues normally",
        )
        # Keep the client — it will reconnect when Redis comes up.


async def close_redis() -> None:
    """Close the Redis connection pool. Call from lifespan shutdown."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
        logger.info("cache.redis.closed")


# ── Analytics dashboard cache ─────────────────────────────────────────────────


def _analytics_key(user_id: uuid.UUID, month: str | None) -> str:
    """Cache key for a user's dashboard analytics, scoped by optional month."""
    return f"{_ANALYTICS_KEY_PREFIX}:{user_id}:{month or ''}"


async def get_cached_analytics(user_id: uuid.UUID, month: str | None) -> dict | None:
    """Return cached dashboard analytics or None on miss / Redis error."""
    if _redis_client is None:
        return None
    try:
        raw = await _redis_client.get(_analytics_key(user_id, month))
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]
    except Exception as exc:
        logger.warning("cache.analytics.read_failed", error=str(exc))
        return None


async def set_cached_analytics(
    user_id: uuid.UUID, month: str | None, data: dict
) -> None:
    """Write dashboard analytics to cache. Silently ignores Redis errors."""
    if _redis_client is None:
        return
    try:
        await _redis_client.set(
            _analytics_key(user_id, month),
            json.dumps(data, default=str),
            ex=settings.analytics_cache_ttl_seconds,
        )
    except Exception as exc:
        logger.warning("cache.analytics.write_failed", error=str(exc))


async def invalidate_analytics_cache(user_id: uuid.UUID) -> None:
    """Delete all cached dashboard keys for a user (all month variants).

    Uses SCAN with a cursor so it never blocks Redis, even if many keys exist.
    Called eagerly on every expense write for that user.
    """
    if _redis_client is None:
        return
    try:
        pattern = f"{_ANALYTICS_KEY_PREFIX}:{user_id}:*"
        keys: list[str] = []
        async for key in _redis_client.scan_iter(pattern, count=100):
            keys.append(key)
        if keys:
            await _redis_client.delete(*keys)
            logger.debug(
                "cache.analytics.invalidated",
                user_id=str(user_id),
                key_count=len(keys),
            )
    except Exception as exc:
        logger.warning(
            "cache.analytics.invalidation_failed",
            user_id=str(user_id),
            error=str(exc),
        )


# ── LLM model list cache ──────────────────────────────────────────────────────

_LLM_MODELS_KEY_PREFIX = "llm:models"


def _llm_models_key(provider: str, user_id: uuid.UUID) -> str:
    """Cache key scoped to provider + user (user keys/base-URL can differ between accounts)."""
    return f"{_LLM_MODELS_KEY_PREFIX}:{provider}:{user_id}"


async def get_cached_llm_models(provider: str, user_id: uuid.UUID) -> list | None:
    """Return cached model list or None on miss / Redis error."""
    if _redis_client is None:
        return None
    try:
        raw = await _redis_client.get(_llm_models_key(provider, user_id))
        if raw is None:
            return None
        return json.loads(raw)  # type: ignore[no-any-return]
    except Exception as exc:
        logger.warning("cache.llm_models.read_failed", provider=provider, error=str(exc))
        return None


async def set_cached_llm_models(
    provider: str, user_id: uuid.UUID, data: list
) -> None:
    """Write model list to cache. Silently ignores Redis errors."""
    if _redis_client is None:
        return
    try:
        await _redis_client.set(
            _llm_models_key(provider, user_id),
            json.dumps(data, default=str),
            ex=settings.llm_models_cache_ttl_seconds,
        )
    except Exception as exc:
        logger.warning("cache.llm_models.write_failed", provider=provider, error=str(exc))


async def invalidate_llm_models_cache(user_id: uuid.UUID) -> None:
    """Delete all cached model-list keys for a user (all providers).

    Called when a user saves new LLM settings so the next fetch gets a fresh list.
    """
    if _redis_client is None:
        return
    try:
        pattern = f"{_LLM_MODELS_KEY_PREFIX}:*:{user_id}"
        keys: list[str] = []
        async for key in _redis_client.scan_iter(pattern, count=100):
            keys.append(key)
        if keys:
            await _redis_client.delete(*keys)
            logger.debug(
                "cache.llm_models.invalidated",
                user_id=str(user_id),
                key_count=len(keys),
            )
    except Exception as exc:
        logger.warning(
            "cache.llm_models.invalidation_failed",
            user_id=str(user_id),
            error=str(exc),
        )


# ── Celery queue depth ────────────────────────────────────────────────────────


async def get_celery_queue_depth() -> int:
    """Return the number of tasks waiting in the Celery broker queue.

    Celery's Redis broker stores pending tasks in a Redis list whose key
    matches the queue name (default: ``"celery"``). LLEN is O(1) and runs
    in <1 ms — safe to call on every upload request.

    Returns 0 if Redis is unavailable so the upload is never blocked by a
    Redis outage.
    """
    if _redis_client is None:
        return 0
    try:
        depth = await _redis_client.llen("celery")
        return int(depth)
    except Exception as exc:
        logger.warning("cache.celery_queue_depth.failed", error=str(exc))
        return 0
