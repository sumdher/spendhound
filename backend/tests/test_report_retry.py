"""Tests for the monthly report Celery task retry/backoff behaviour (Step 6).

Strategy:
  - `_task.push_request(retries=N)` sets the request context so self.request.retries == N.
  - `patch.object(Task, 'retry', ...)` patches the base-class method so we can
    capture the countdown kwarg without needing a broker.
  - The success / exhaustion tests don't need the retry path, so no Task.retry patch.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from celery.app.task import Task
from celery.exceptions import Retry

_report_tasks = pytest.importorskip(
    "app.tasks.report_tasks",
    reason="app.tasks is gitignored; skip on runners without the tasks directory",
)
deliver_monthly_report = _report_tasks.deliver_monthly_report
_task = deliver_monthly_report


# ── Backoff formula ───────────────────────────────────────────────────────────


def test_backoff_formula_in_source():
    """The backoff expression '2 ** (attempt + 1)' must be present in the task source."""
    import inspect

    import app.tasks.report_tasks as m

    source = inspect.getsource(m)
    assert "2 ** (attempt + 1)" in source, (
        "Expected exponential backoff formula '2 ** (attempt + 1)' in report_tasks.py; "
        "this produces the documented 2s→4s→8s schedule"
    )


def test_backoff_arithmetic():
    """The formula 2^(attempt+1) produces the documented countdown values."""
    assert 2 ** (0 + 1) == 2, "First retry must be after 2 s"
    assert 2 ** (1 + 1) == 4, "Second retry must be after 4 s"
    assert 2 ** (2 + 1) == 8, "Third retry must be after 8 s"


# ── Live countdown capture ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "attempt, expected_countdown",
    [
        (0, 2),   # 2 ** (0 + 1) = 2 s
        (1, 4),   # 2 ** (1 + 1) = 4 s
        (2, 8),   # 2 ** (2 + 1) = 8 s
    ],
    ids=["attempt-1", "attempt-2", "attempt-3"],
)
def test_retry_countdown_captured(attempt: int, expected_countdown: int):
    """deliver_monthly_report invokes self.retry(countdown=<expected>) on failure.

    We patch Task.retry at the base-class level so that self.retry() inside
    the task body is intercepted without needing a Celery broker.
    """
    captured: list[int | None] = []
    exc = ConnectionError("Resend API down")

    def spy_retry(task_self, exc=None, countdown=None, **kwargs):
        captured.append(countdown)
        raise Retry()

    def raise_exc(coro):
        # Close the coroutine so Python doesn't warn "never awaited"
        coro.close()
        raise exc

    _task.push_request(retries=attempt)
    try:
        with patch.object(Task, "retry", spy_retry):
            with patch("app.tasks.report_tasks.asyncio.run", side_effect=raise_exc):
                with pytest.raises(Retry):
                    _task.run(str(uuid.uuid4()), "2026-05")
    finally:
        _task.pop_request()

    assert captured == [expected_countdown], (
        f"attempt {attempt}: expected countdown {expected_countdown}s, got {captured}"
    )


# ── Exhaustion path ───────────────────────────────────────────────────────────


def test_no_retry_on_final_attempt():
    """When request.retries == max_retries, self.retry must NOT be called."""
    spy_retry_called = [False]

    def spy_retry(task_self, **kwargs):
        spy_retry_called[0] = True
        raise Retry()

    exc = ConnectionError("Resend permanently down")
    run_count = [0]

    def fake_run(coro):
        run_count[0] += 1
        coro.close()
        if run_count[0] == 1:
            raise exc

    _task.push_request(retries=_task.max_retries)
    try:
        with patch.object(Task, "retry", spy_retry):
            with patch("app.tasks.report_tasks.asyncio.run", side_effect=fake_run):
                with pytest.raises(ConnectionError, match="permanently down"):
                    _task.run(str(uuid.uuid4()), "2026-05")
    finally:
        _task.pop_request()

    assert not spy_retry_called[0], "retry() must not be called when max_retries is reached"


def test_mark_failed_called_after_all_retries():
    """asyncio.run is called twice on exhaustion: deliver attempt + mark_failed."""
    run_count = [0]
    exc = ConnectionError("Resend permanently down")

    def fake_run(coro):
        run_count[0] += 1
        coro.close()
        if run_count[0] == 1:
            raise exc

    _task.push_request(retries=_task.max_retries)
    try:
        with patch("app.tasks.report_tasks.asyncio.run", side_effect=fake_run):
            with pytest.raises(ConnectionError):
                _task.run(str(uuid.uuid4()), "2026-05")
    finally:
        _task.pop_request()

    assert run_count[0] == 2, (
        "asyncio.run must be called exactly twice on final failure: "
        "once for _async_deliver_report, once for _async_mark_failed"
    )


# ── Success path ──────────────────────────────────────────────────────────────


def test_success_path_calls_asyncio_run_once():
    """When asyncio.run completes without exception, no retry is triggered."""
    run_count = [0]

    def fake_run(coro):
        run_count[0] += 1
        coro.close()

    _task.push_request(retries=0)
    try:
        with patch("app.tasks.report_tasks.asyncio.run", side_effect=fake_run):
            _task.run(str(uuid.uuid4()), "2026-05")
    finally:
        _task.pop_request()

    assert run_count[0] == 1
