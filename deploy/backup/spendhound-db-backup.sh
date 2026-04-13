#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${SPENDHOUND_BACKUP_COMPOSE_FILE:-${REPO_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_DIR="${SPENDHOUND_BACKUP_PROJECT_DIR:-${REPO_ROOT}}"
BACKUP_DIR="${SPENDHOUND_BACKUP_DIR:-/var/backups/spendhound}"
RETENTION_DAYS="${SPENDHOUND_BACKUP_RETENTION_DAYS:-14}"
SERVICE_NAME="${SPENDHOUND_BACKUP_SERVICE_NAME:-db}"
LOCK_FILE="${SPENDHOUND_BACKUP_LOCK_FILE:-/var/lock/spendhound-db-backup.lock}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || hostname)"

log() {
  printf '%s %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

mkdir_with_mode() {
  local dir="$1"
  install -d -m 0700 "$dir"
}

cleanup_tmp() {
  if [[ -n "${TMP_BACKUP_FILE:-}" && -f "${TMP_BACKUP_FILE}" ]]; then
    rm -f -- "${TMP_BACKUP_FILE}"
  fi
  if [[ -n "${TMP_SHA_FILE:-}" && -f "${TMP_SHA_FILE}" ]]; then
    rm -f -- "${TMP_SHA_FILE}"
  fi
}

trap cleanup_tmp EXIT

umask 077

require_command docker
require_command flock
require_command gzip
require_command sed
require_command head
require_command sha256sum
require_command stat
require_command find
require_command install
require_command mv
require_command rm

[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found at ${COMPOSE_FILE}"
[[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] || fail "SPENDHOUND_BACKUP_RETENTION_DAYS must be a non-negative integer"

mkdir_with_mode "${BACKUP_DIR}"
mkdir_with_mode "$(dirname -- "${LOCK_FILE}")"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  fail "Another backup job is already running"
fi

DOCKER_COMPOSE=(docker compose --project-directory "${COMPOSE_PROJECT_DIR}" -f "${COMPOSE_FILE}")

DB_CONTAINER_ID="$(${DOCKER_COMPOSE[@]} ps -q "${SERVICE_NAME}" 2>/dev/null || true)"
[[ -n "${DB_CONTAINER_ID}" ]] || fail "Database service '${SERVICE_NAME}' is not running"

DB_RUNNING="$(docker inspect -f '{{.State.Running}}' "${DB_CONTAINER_ID}" 2>/dev/null || true)"
[[ "${DB_RUNNING}" == "true" ]] || fail "Database container '${DB_CONTAINER_ID}' is not running"

DB_HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${DB_CONTAINER_ID}" 2>/dev/null || true)"
if [[ "${DB_HEALTH}" != "healthy" && "${DB_HEALTH}" != "none" ]]; then
  fail "Database container health is '${DB_HEALTH}', refusing backup"
fi

DB_INFO_RAW="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${DB_CONTAINER_ID}" 2>/dev/null || true)"
POSTGRES_USER="$(printf '%s\n' "${DB_INFO_RAW}" | sed -n 's/^POSTGRES_USER=//p' | head -n1)"
POSTGRES_DB="$(printf '%s\n' "${DB_INFO_RAW}" | sed -n 's/^POSTGRES_DB=//p' | head -n1)"

POSTGRES_USER="${POSTGRES_USER:-spendhound}"
POSTGRES_DB="${POSTGRES_DB:-spendhound}"

FILE_BASENAME="spendhound-db-${HOSTNAME_SHORT}-${POSTGRES_DB}-${TIMESTAMP}.dump"
FINAL_BACKUP_FILE="${BACKUP_DIR}/${FILE_BASENAME}.gz"
FINAL_SHA_FILE="${FINAL_BACKUP_FILE}.sha256"
TMP_BACKUP_FILE="${FINAL_BACKUP_FILE}.tmp"
TMP_SHA_FILE="${FINAL_SHA_FILE}.tmp"

log "Starting PostgreSQL backup for database '${POSTGRES_DB}' from service '${SERVICE_NAME}'"

if ! docker exec "${DB_CONTAINER_ID}" sh -ceu 'export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set}"; exec pg_dump --host 127.0.0.1 --username "${POSTGRES_USER:?POSTGRES_USER is not set}" --dbname "${POSTGRES_DB:?POSTGRES_DB is not set}" --format=custom --no-owner --no-privileges --compress=0' | gzip -9 >"${TMP_BACKUP_FILE}"; then
  fail "pg_dump failed"
fi

[[ -s "${TMP_BACKUP_FILE}" ]] || fail "Backup file was created but is empty"

if ! gzip -dc -- "${TMP_BACKUP_FILE}" | docker exec -i "${DB_CONTAINER_ID}" pg_restore --list >/dev/null; then
  fail "Backup archive validation failed"
fi

sha256sum "${TMP_BACKUP_FILE}" >"${TMP_SHA_FILE}"

mv -f -- "${TMP_BACKUP_FILE}" "${FINAL_BACKUP_FILE}"
mv -f -- "${TMP_SHA_FILE}" "${FINAL_SHA_FILE}"

BACKUP_SIZE_BYTES="$(stat -c '%s' "${FINAL_BACKUP_FILE}")"
log "Backup completed successfully: ${FINAL_BACKUP_FILE} (${BACKUP_SIZE_BYTES} bytes)"

if (( RETENTION_DAYS > 0 )); then
  log "Pruning backups older than ${RETENTION_DAYS} days from ${BACKUP_DIR}"
  find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name 'spendhound-db-*.dump.gz' -o -name 'spendhound-db-*.dump.gz.sha256' \) -mtime +"${RETENTION_DAYS}" -print -delete
else
  log "Retention pruning disabled because SPENDHOUND_BACKUP_RETENTION_DAYS=${RETENTION_DAYS}"
fi

log "Backup job finished"
