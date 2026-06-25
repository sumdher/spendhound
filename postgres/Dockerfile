# Custom Postgres image for SpendHound production.
# Extends pgvector:pg16 with WAL-G (continuous backup to Cloudflare R2)
# and supercronic (daily base backup cron job in the backup sidecar).
#
# amd64 only - WAL-G binaries are architecture-specific.
# Update the WALG_VERSION build arg to upgrade WAL-G.

FROM pgvector/pgvector:pg16

ARG WALG_VERSION=v3.0.3
ARG SUPERCRONIC_VERSION=v0.2.33

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    \
    # WAL-G PostgreSQL variant - download the raw binary directly (no tar needed)
    curl -fsSL \
      "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-20.04-amd64" \
      -o /usr/local/bin/wal-g; \
    \
    # supercronic: cron runner for the backup sidecar container
    curl -fsSL \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
      -o /usr/local/bin/supercronic; \
    \
    chmod +x /usr/local/bin/wal-g /usr/local/bin/supercronic; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*
