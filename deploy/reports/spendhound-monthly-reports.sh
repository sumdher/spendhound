#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${SPENDHOUND_REPORTS_COMPOSE_FILE:-${REPO_ROOT}/docker-compose.prod.yml}"
COMPOSE_PROJECT_DIR="${SPENDHOUND_REPORTS_PROJECT_DIR:-${REPO_ROOT}}"
SERVICE_NAME="${SPENDHOUND_REPORTS_SERVICE_NAME:-backend}"
LOCK_FILE="${SPENDHOUND_REPORTS_LOCK_FILE:-/var/lock/spendhound-monthly-reports.lock}"

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

require_command docker
require_command flock
require_command install

[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found at ${COMPOSE_FILE}"

install -d -m 0700 "$(dirname -- "${LOCK_FILE}")"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  fail "Another monthly report job is already running"
fi

DOCKER_COMPOSE=(docker compose --project-directory "${COMPOSE_PROJECT_DIR}" -f "${COMPOSE_FILE}")

BACKEND_CONTAINER_ID="$(${DOCKER_COMPOSE[@]} ps -q "${SERVICE_NAME}" 2>/dev/null || true)"
[[ -n "${BACKEND_CONTAINER_ID}" ]] || fail "Backend service '${SERVICE_NAME}' is not running"

BACKEND_RUNNING="$(docker inspect -f '{{.State.Running}}' "${BACKEND_CONTAINER_ID}" 2>/dev/null || true)"
[[ "${BACKEND_RUNNING}" == "true" ]] || fail "Backend container '${BACKEND_CONTAINER_ID}' is not running"

BACKEND_HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${BACKEND_CONTAINER_ID}" 2>/dev/null || true)"
if [[ "${BACKEND_HEALTH}" != "healthy" && "${BACKEND_HEALTH}" != "none" ]]; then
  fail "Backend container health is '${BACKEND_HEALTH}', refusing job execution"
fi

log "Starting SpendHound monthly reports job via backend service '${SERVICE_NAME}'"
"${DOCKER_COMPOSE[@]}" exec -T "${SERVICE_NAME}" python -m app.jobs.monthly_reports
log "Monthly reports job finished"
