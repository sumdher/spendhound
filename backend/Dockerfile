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

COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./

EXPOSE 8000

CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--access-log", \
     "--timeout-keep-alive", "30"]
