#!/usr/bin/env bash

set -Eeuo pipefail

umask 022

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd -P)"

RUNNER_SOURCE="${SCRIPT_DIR}/spendhound-monthly-reports.sh"
SERVICE_SOURCE="${SCRIPT_DIR}/spendhound-monthly-reports.service"
TIMER_SOURCE="${SCRIPT_DIR}/spendhound-monthly-reports.timer"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.prod.yml"

SYSTEMD_DIR="/etc/systemd/system"
SERVICE_NAME="spendhound-monthly-reports.service"
TIMER_NAME="spendhound-monthly-reports.timer"
OVERRIDE_DIR="${SYSTEMD_DIR}/${SERVICE_NAME}.d"
OVERRIDE_FILE="${OVERRIDE_DIR}/override.conf"
SERVICE_DEST="${SYSTEMD_DIR}/${SERVICE_NAME}"
TIMER_DEST="${SYSTEMD_DIR}/${TIMER_NAME}"

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Run this installer as root (for example: sudo bash ./deploy/reports/install-spendhound-monthly-reports.sh)"
}

write_override() {
  local tmp_file
  tmp_file="$(mktemp)"
  trap 'rm -f -- "${tmp_file}"' RETURN

  cat >"${tmp_file}" <<EOF
[Service]
WorkingDirectory=
WorkingDirectory=${REPO_ROOT}
ExecStart=
ExecStart=/usr/bin/env bash ${RUNNER_SOURCE}
Environment=SPENDHOUND_REPORTS_COMPOSE_FILE=${COMPOSE_FILE}
Environment=SPENDHOUND_REPORTS_PROJECT_DIR=${REPO_ROOT}
Environment=SPENDHOUND_REPORTS_SERVICE_NAME=backend
EOF

  install -d -m 0755 "${OVERRIDE_DIR}"
  install -m 0644 "${tmp_file}" "${OVERRIDE_FILE}"
}

require_root

require_command install
require_command chmod
require_command systemctl
require_command mktemp

if ! systemctl --version >/dev/null 2>&1; then
  fail "systemd does not appear to be available on this host"
fi

[[ -f "${RUNNER_SOURCE}" ]] || fail "Runner script not found at ${RUNNER_SOURCE}"
[[ -f "${SERVICE_SOURCE}" ]] || fail "Service unit not found at ${SERVICE_SOURCE}"
[[ -f "${TIMER_SOURCE}" ]] || fail "Timer unit not found at ${TIMER_SOURCE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found at ${COMPOSE_FILE}"

log "Installing SpendHound monthly reports systemd units"

install -d -m 0755 "${SYSTEMD_DIR}"
chmod 0755 "${RUNNER_SOURCE}"

install -m 0644 "${SERVICE_SOURCE}" "${SERVICE_DEST}"
install -m 0644 "${TIMER_SOURCE}" "${TIMER_DEST}"
write_override

systemctl daemon-reload
systemctl enable "${TIMER_NAME}" >/dev/null

if systemctl is-active --quiet "${TIMER_NAME}"; then
  systemctl restart "${TIMER_NAME}"
else
  systemctl start "${TIMER_NAME}"
fi

log "Monthly reports installer completed successfully"
printf '\n'
printf 'Installed unit files:\n'
printf '  - %s\n' "${SERVICE_DEST}"
printf '  - %s\n' "${TIMER_DEST}"
printf 'Installed override:\n'
printf '  - %s\n' "${OVERRIDE_FILE}"
printf '\n'
printf 'Verification commands:\n'
printf '  - systemctl status %s --no-pager\n' "${TIMER_NAME}"
printf '  - systemctl cat %s\n' "${SERVICE_NAME}"
printf '  - systemctl list-timers %s\n' "${TIMER_NAME}"
printf '  - journalctl -u %s -n 50 --no-pager\n' "${SERVICE_NAME}"
printf '  - systemctl start %s\n' "${SERVICE_NAME}"
