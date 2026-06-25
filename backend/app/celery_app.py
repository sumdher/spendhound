"""Celery application instance for SpendHound.

Broker:         Redis — tasks are pushed onto the ``celery`` list key.
Result backend: None — task return values are discarded. Extraction status
                is tracked exclusively via ``Receipt.extraction_status`` in
                Postgres, so we don't need a separate result store.

Worker is started as a separate Docker Compose service:
    celery -A app.celery_app worker --loglevel=info --concurrency=1

``--concurrency 1`` keeps a single worker process, which preserves the
module-level ``asyncio.Semaphore`` in ollama.py as the GPU serialisation
mechanism and matches the old asyncio.Queue single-worker behaviour.
"""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_init

from app.config import settings

if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=0.0,
        send_default_pii=False,
        integrations=[CeleryIntegration()],
    )


@worker_init.connect
def _on_worker_init(**kwargs: object) -> None:
    if settings.otel_endpoint:
        from app.services.tracing import setup_tracing

        setup_tracing(settings.otel_service_name, settings.otel_endpoint)


celery_app = Celery(
    "spendhound",
    broker=settings.redis_url,
    backend=None,  # results discarded — status lives in Postgres
    include=[
        "app.tasks.receipt_tasks",
        "app.tasks.statement_tasks",
        "app.tasks.report_tasks",
        "app.tasks.demo_tasks",
    ],
)

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # Clock
    timezone="UTC",
    enable_utc=True,
    # Reliability: acknowledge only after the task function returns, so a
    # worker crash before completion requeues the task automatically.
    task_acks_late=True,
    # Prefetch 1 task at a time so the Redis LLEN queue-depth check in the
    # upload endpoint stays accurate (tasks not yet started stay on the list).
    worker_prefetch_multiplier=1,
    # Results are not stored anywhere.
    task_ignore_result=True,
)

# Beat schedule — runs when `celery beat` is started (see docker-compose celery_beat service).
celery_app.conf.beat_schedule = {
    # Wall-clock crontab (UTC :00 and :30) so the reset time is predictable and the
    # frontend can derive an accurate countdown without any server-side state.
    "reset-demo-user-on-the-half-hour": {
        "task": "app.tasks.demo_tasks.reset_demo_user",
        "schedule": crontab(minute="0,30"),
    },
    # 1st of each month at 00:20 UTC - matches the former systemd timer schedule.
    # Fans out one deliver_monthly_report task per eligible user.
    "dispatch-monthly-reports": {
        "task": "app.tasks.report_tasks.dispatch_monthly_reports",
        "schedule": crontab(hour=0, minute=20, day_of_month=1),
    },
}
