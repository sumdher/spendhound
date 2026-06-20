"""Tests for Celery task infrastructure (Step 5).

Covers:
1. Ollama semaphore reset — _reset_ollama_semaphore() must null the module-level
   semaphore so a fresh one is lazily created inside each asyncio.run() event loop.
2. Statement upload async contract — POST /api/receipts/upload-statement must
   return extraction_status="pending" immediately (Celery dispatched, not blocked).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Async tests are auto-detected by pytest-asyncio (asyncio_mode=auto in pyproject.toml).
# No module-level pytestmark needed — sync tests here would get a spurious asyncio warning.


# ── Semaphore reset (why this matters) ───────────────────────────────────────


def test_reset_ollama_semaphore_nullifies_module_global():
    """_reset_ollama_semaphore() must set _llm_semaphore = None.

    asyncio.run() creates a fresh event loop per call. A Semaphore created in a
    previous event loop is bound to that (now-closed) loop. Re-using it raises
    RuntimeError on acquire(). Setting it to None forces lazy re-creation inside
    the new loop — this is the fix.
    """
    from app.services.llm import ollama as _ollama
    from app.tasks.receipt_tasks import _reset_ollama_semaphore

    # Simulate: a semaphore was created in a previous asyncio.run() invocation.
    _ollama._llm_semaphore = asyncio.Semaphore(1)
    assert _ollama._llm_semaphore is not None

    _reset_ollama_semaphore()

    assert _ollama._llm_semaphore is None, (
        "_llm_semaphore must be None after reset so the next _get_llm_semaphore() "
        "call creates it inside the new event loop (safe with asyncio.run)"
    )


def test_reset_called_before_each_task():
    """_reset_ollama_semaphore is called in the task body before asyncio.run()."""
    import inspect

    from app.tasks import receipt_tasks

    # Compare line numbers so docstring mentions of 'asyncio.run()' don't confuse us.
    lines = inspect.getsource(receipt_tasks).splitlines()
    reset_line = next(
        (i for i, line in enumerate(lines) if "_reset_ollama_semaphore()" in line and not line.strip().startswith("#")),
        None,
    )
    run_line = next(
        (i for i, line in enumerate(lines) if "asyncio.run(" in line and not line.strip().startswith(("\"\"\"", "#", "``"))),
        None,
    )
    assert reset_line is not None, "_reset_ollama_semaphore() call not found in receipt_tasks"
    assert run_line is not None, "asyncio.run() call not found in receipt_tasks"
    assert reset_line < run_line, (
        f"_reset_ollama_semaphore() (line {reset_line}) must appear BEFORE asyncio.run() "
        f"(line {run_line}) so the semaphore is re-created inside the new event loop"
    )


def test_semaphore_lazily_recreated_after_reset():
    """After reset, _get_llm_semaphore() recreates the semaphore on first call."""
    from app.services.llm import ollama as _ollama
    from app.tasks.receipt_tasks import _reset_ollama_semaphore

    _reset_ollama_semaphore()
    assert _ollama._llm_semaphore is None

    async def _check():
        from app.services.llm.ollama import _get_semaphore
        sema = _get_semaphore()
        assert sema is not None
        assert isinstance(sema, asyncio.Semaphore)
        assert _ollama._llm_semaphore is sema  # cached for re-use within the loop

    asyncio.run(_check())


def test_sequential_tasks_each_get_fresh_semaphore():
    """Two sequential asyncio.run() calls must each get a distinct semaphore object.

    This is the actual failure mode the reset guards against: Task 1 creates a
    Semaphore inside event loop L1. L1 closes. Task 2 starts a new event loop L2.
    Without the reset, _get_semaphore() returns the same Semaphore object from L1,
    which may be attached to a closed loop (undefined behaviour; RuntimeError in
    older Python, silent misuse in 3.12+). With the reset, L2 creates a fresh
    Semaphore bound to itself.
    """
    from app.services.llm.ollama import _get_semaphore
    from app.tasks.receipt_tasks import _reset_ollama_semaphore

    seen: list[asyncio.Semaphore] = []

    async def task_body():
        sema = _get_semaphore()
        seen.append(sema)
        await sema.acquire()
        sema.release()

    # Task 1 — creates the semaphore in L1
    _reset_ollama_semaphore()
    asyncio.run(task_body())

    # Task 2 — reset first (as Celery worker does), then new asyncio.run()
    _reset_ollama_semaphore()
    asyncio.run(task_body())

    assert len(seen) == 2
    assert seen[0] is not seen[1], (
        "Each asyncio.run() invocation must get a fresh Semaphore; "
        "re-using the one from the previous (closed) event loop is undefined behaviour"
    )


def test_without_reset_semaphore_is_shared_across_loops():
    """Documents the bug: without reset, the same Semaphore leaks into the next loop.

    This is a negative-case companion to test_sequential_tasks_each_get_fresh_semaphore.
    It intentionally skips _reset_ollama_semaphore() to show what goes wrong.
    """
    from app.services.llm import ollama as _ollama
    from app.services.llm.ollama import _get_semaphore

    seen: list[asyncio.Semaphore] = []

    async def task_body():
        seen.append(_get_semaphore())

    # Task 1 — clean start, creates semaphore in L1
    _ollama._llm_semaphore = None
    asyncio.run(task_body())

    # Task 2 — deliberately NO reset (this is the bug)
    asyncio.run(task_body())

    # Same object reused — it came from L1's (now-closed) event loop
    assert seen[0] is seen[1], (
        "Without reset, both tasks share the same Semaphore object. "
        "This assertion documents the bug; if it fails the leakage no longer exists."
    )


# ── Statement upload returns immediately (async / Celery) ─────────────────────


async def test_statement_upload_returns_pending_immediately(client, auth_headers):
    """POST /api/receipts/upload-statement must return extraction_status='pending' at once.

    Before Step 5, the endpoint ran extraction synchronously and returned the full
    preview. After Step 5, it creates the Receipt row and dispatches a Celery task —
    so the response is instant and preview is None. If the frontend reads
    receipt.preview.entries immediately after upload it gets an empty list.
    (See test_task_internals.py for the frontend fix tracking.)
    """
    stored = SimpleNamespace(
        stored_filename="stmt_abc.pdf",
        file_size=2048,
        storage_path="receipts/test-user/stmt_abc.pdf",
    )

    with (
        patch("app.api.receipts.store_upload", new=AsyncMock(return_value=stored)),
        patch("app.api.receipts.extract_statement") as mock_task,
    ):
        mock_task.delay = MagicMock()

        resp = await client.post(
            "/api/receipts/upload-statement",
            files={"file": ("bank.pdf", b"%PDF-1.4 fake-content", "application/pdf")},
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()

    assert data["extraction_status"] == "pending", (
        "Statement upload endpoint must return immediately with extraction_status='pending'; "
        "the actual extraction happens asynchronously in the Celery worker"
    )
    assert data["preview"] is None, (
        "preview must be None on the immediate response — "
        "the frontend must poll GET /api/receipts/{id} until status != 'pending'"
    )
    mock_task.delay.assert_called_once()


async def test_statement_upload_rejects_non_pdf(client, auth_headers):
    """upload-statement must reject non-PDF files before dispatching any task."""
    with patch("app.api.receipts.extract_statement") as mock_task:
        mock_task.delay = MagicMock()

        resp = await client.post(
            "/api/receipts/upload-statement",
            files={"file": ("data.csv", b"date,amount\n2026-01-01,10", "text/csv")},
            headers=auth_headers,
        )

    assert resp.status_code == 400
    mock_task.delay.assert_not_called()
