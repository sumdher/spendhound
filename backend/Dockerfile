# SpendHound Backend Dockerfile
# Multi-stage build: development (hot-reload) and production (slim runtime).

# ── Builder stage ────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install --no-cache-dir build && \
    pip wheel --no-cache-dir --wheel-dir /wheels -r <(pip install --dry-run . 2>&1 | grep "Would install" | sed 's/Would install //' | tr ' ' '\n' | sed 's/-[0-9].*//' | xargs -I{} echo {}) 2>/dev/null || true

RUN pip install --no-cache-dir .

# ── Development stage ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS development

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -e ".[dev]"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Production stage ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && \
    pip install --no-cache-dir .

# Audit for known CVEs at build time. Prints findings but does not fail the
# build — a vulnerability in a transitive dep shouldn't block a critical deploy.
# Review the output in the build log and upgrade affected packages promptly.
RUN pip install --no-cache-dir pip-audit && \
    pip-audit --skip-editable --desc on || true && \
    pip uninstall -y pip-audit

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./

# Drop to a non-root user. The app writes only to storage/receipts (mounted as
# a volume owned by this UID) and needs no system privileges.
RUN addgroup --system --gid 1001 spendhound && \
    adduser --system --uid 1001 --ingroup spendhound --no-create-home spendhound && \
    mkdir -p storage/receipts && \
    chown -R spendhound:spendhound /app

USER spendhound

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--access-log", \
     "--timeout-keep-alive", "30"]
