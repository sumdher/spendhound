"""Integration tests: Redis cache invalidation on expense writes and LLM settings updates.

These tests use fakeredis to pre-seed cache keys and verify they are actually
deleted — not just that the invalidation code path "looks right".
"""

from __future__ import annotations

import pytest
import pytest_asyncio

import app.services.cache as cache_module

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture()
async def fake_redis(client):  # noqa: ARG001 — client triggers lifespan so _redis_client is set
    """Replace the module-level Redis client with an in-process fake for the test."""
    fakeredis = pytest.importorskip("fakeredis", reason="fakeredis not installed")
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    original = cache_module._redis_client
    cache_module._redis_client = r
    yield r
    cache_module._redis_client = original
    await r.aclose()


# ── Analytics cache ───────────────────────────────────────────────────────────


async def test_analytics_cache_invalidated_on_expense_create(
    client, auth_headers, test_user, fake_redis
):
    """POST /api/expenses must delete all analytics cache keys for that user."""
    key = f"analytics:dashboard:{test_user.id}:2026-05"
    await fake_redis.set(key, '{"total": 99}')
    assert await fake_redis.exists(key) == 1

    resp = await client.post(
        "/api/expenses",
        json={"merchant": "Supermercato", "amount": 25.50, "expense_date": "2026-05-20"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    assert await fake_redis.exists(key) == 0, (
        "Analytics cache key must be deleted after expense write; "
        "stale cache would serve wrong totals until TTL expires"
    )


async def test_analytics_cache_all_months_invalidated(
    client, auth_headers, test_user, fake_redis
):
    """invalidate_analytics_cache uses scan+delete with a wildcard — all month variants go."""
    keys = [
        f"analytics:dashboard:{test_user.id}:2026-04",
        f"analytics:dashboard:{test_user.id}:2026-05",
        f"analytics:dashboard:{test_user.id}:",  # all-time variant
    ]
    for k in keys:
        await fake_redis.set(k, '{"total": 1}')

    resp = await client.post(
        "/api/expenses",
        json={"merchant": "Farmacia", "amount": 12.00, "expense_date": "2026-05-15"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    for k in keys:
        assert await fake_redis.exists(k) == 0, f"Key {k!r} should have been deleted"


async def test_analytics_cache_does_not_delete_other_user_keys(
    client, auth_headers, test_user, fake_redis
):
    """invalidate_analytics_cache is scoped to the writing user's ID only."""
    own_key = f"analytics:dashboard:{test_user.id}:2026-05"
    other_key = "analytics:dashboard:00000000-0000-0000-0000-000000000001:2026-05"
    await fake_redis.set(own_key, '{"total": 5}')
    await fake_redis.set(other_key, '{"total": 5}')

    resp = await client.post(
        "/api/expenses",
        json={"merchant": "Bar", "amount": 3.00, "expense_date": "2026-05-10"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    assert await fake_redis.exists(own_key) == 0, "Own analytics key must be evicted"
    assert await fake_redis.exists(other_key) == 1, "Other user's analytics key must be untouched"


# ── LLM models cache ──────────────────────────────────────────────────────────


async def test_llm_models_cache_invalidated_on_settings_update(
    client, auth_headers, test_user, fake_redis
):
    """PATCH /api/auth/me/llm-settings must delete all LLM model-list cache keys for the user."""
    key = f"llm:models:ollama:{test_user.id}"
    await fake_redis.set(key, '["llama3", "gemma3"]')
    assert await fake_redis.exists(key) == 1

    resp = await client.patch(
        "/api/auth/me/llm-settings",
        json={"llm_provider": "openai"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    assert await fake_redis.exists(key) == 0, (
        "LLM model list cache must be evicted when LLM settings change; "
        "stale cache would show models from the old provider"
    )


async def test_llm_models_cache_all_providers_invalidated(
    client, auth_headers, test_user, fake_redis
):
    """invalidate_llm_models_cache uses scan+delete — ALL providers for the user are cleared."""
    keys = [
        f"llm:models:ollama:{test_user.id}",
        f"llm:models:openai:{test_user.id}",
        f"llm:models:anthropic:{test_user.id}",
    ]
    for k in keys:
        await fake_redis.set(k, '["model-a"]')

    resp = await client.patch(
        "/api/auth/me/llm-settings",
        json={"llm_model": "gpt-4o"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    for k in keys:
        assert await fake_redis.exists(k) == 0, f"Key {k!r} should have been deleted"
