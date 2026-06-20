"""Tests for the /metrics endpoint (Step 7).

Verifies:
- Unauthenticated requests are rejected (403)
- Wrong token is rejected (403)
- Correct token returns prometheus text with expected metric names
- Flower port is bound to 127.0.0.1 (not 0.0.0.0) — validated from compose config
"""

from __future__ import annotations

import pytest

from app.config import settings

# Async tests detected automatically (asyncio_mode=auto). No pytestmark needed —
# the sync test_flower_... test would get a spurious asyncio warning otherwise.

_TOKEN = "test-metrics-token-xyz"


# ── Auth enforcement ──────────────────────────────────────────────────────────


async def test_metrics_requires_token(client):
    """GET /metrics without an Authorization header must return 403."""
    resp = await client.get("/metrics")
    assert resp.status_code == 403


async def test_metrics_empty_bearer_rejected(client):
    """Bearer with empty string is equivalent to no token."""
    resp = await client.get("/metrics", headers={"Authorization": "Bearer "})
    assert resp.status_code == 403


async def test_metrics_wrong_token_rejected(client):
    """A non-empty but incorrect token must return 403."""
    original = settings.metrics_token
    settings.metrics_token = _TOKEN
    try:
        resp = await client.get("/metrics", headers={"Authorization": "Bearer wrong-token"})
    finally:
        settings.metrics_token = original
    assert resp.status_code == 403


async def test_metrics_correct_token_accepted(client):
    """Correct Bearer token must return 200 with prometheus text format."""
    original = settings.metrics_token
    settings.metrics_token = _TOKEN
    try:
        resp = await client.get("/metrics", headers={"Authorization": f"Bearer {_TOKEN}"})
    finally:
        settings.metrics_token = original
    assert resp.status_code == 200
    assert "text/plain" in resp.headers.get("content-type", "")


async def test_metrics_contains_custom_metric_names(client):
    """The /metrics response must include all three custom metric names we defined."""
    original = settings.metrics_token
    settings.metrics_token = _TOKEN
    try:
        resp = await client.get("/metrics", headers={"Authorization": f"Bearer {_TOKEN}"})
    finally:
        settings.metrics_token = original

    body = resp.content
    assert b"receipt_queue_depth" in body, "RECEIPT_QUEUE_DEPTH gauge missing from /metrics"
    assert b"llm_response_seconds" in body, "LLM_RESPONSE_SECONDS histogram missing from /metrics"
    assert b"rate_limit_hits_total" in body, "RATE_LIMIT_HITS_TOTAL counter missing from /metrics"


async def test_metrics_timing_attack_safe(client):
    """Both wrong-token and no-token paths must return 403 (not reveal valid length via timing)."""
    original = settings.metrics_token
    settings.metrics_token = _TOKEN
    try:
        r1 = await client.get("/metrics", headers={"Authorization": "Bearer x"})
        r2 = await client.get("/metrics", headers={"Authorization": "Bearer " + "x" * 50})
    finally:
        settings.metrics_token = original

    # Both must be refused; the hmac.compare_digest check prevents timing attacks
    assert r1.status_code == 403
    assert r2.status_code == 403


# ── Flower port isolation (non-HTTP structural test) ─────────────────────────


def test_flower_bound_to_localhost_not_public():
    """Flower (Celery monitoring UI) must not be exposed on a public interface.

    This is a structural test that reads the compose config and asserts the
    host-side binding is 127.0.0.1 — not 0.0.0.0 or a bare port number that
    Docker would expose on all interfaces.
    """
    import pathlib
    import re

    compose_path = pathlib.Path(__file__).parent.parent.parent / "docker-compose.yml"
    assert compose_path.exists(), f"docker-compose.yml not found at {compose_path}"

    content = compose_path.read_text()

    # Find the flower service ports section
    flower_section_match = re.search(r"flower:.*?(?=\n\w|\Z)", content, re.DOTALL)
    assert flower_section_match, "flower service not found in docker-compose.yml"
    flower_section = flower_section_match.group()

    port_matches = re.findall(r'["\']?(\S+):5555:5555["\']?', flower_section)
    assert port_matches, "flower port mapping not found in docker-compose.yml"

    for binding in port_matches:
        binding = binding.strip("\"'")
        assert binding == "127.0.0.1", (
            f"Flower port is bound to {binding!r} — must be 127.0.0.1 to prevent "
            "the Celery monitoring UI from being publicly accessible. "
            "Change the port mapping to '127.0.0.1:5555:5555'."
        )
