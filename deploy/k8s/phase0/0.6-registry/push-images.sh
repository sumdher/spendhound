#!/usr/bin/env bash
# Phase 0.6 — Build and push SpendHound + JobHound images to local registry
#
# Run from zoro (the node with docker and the source repos).
# The registry must already be running (phase 0.6 registry.yaml applied).
#
# Usage:
#   ./push-images.sh                    # build and push all images
#   ./push-images.sh spendhound         # only spendhound images
#   ./push-images.sh jobhound           # only jobhound images
#
# After first push, subsequent pushes reuse layer cache so they are fast.

set -euo pipefail

REGISTRY="192.168.1.37:5000"
FILTER="${1:-all}"

SPENDHOUND_DIR="${HOME}/repos/spendhound-k8s"
JOBHOUND_DIR="${HOME}/repos/jobhound"

push_spendhound() {
  echo "==> Building spendhound-backend"
  docker build \
    --target production \
    -t "${REGISTRY}/spendhound-backend:latest" \
    -f "${SPENDHOUND_DIR}/backend/Dockerfile" \
    "${SPENDHOUND_DIR}/backend"

  echo "==> Pushing spendhound-backend"
  docker push "${REGISTRY}/spendhound-backend:latest"

  echo "==> Building spendhound-frontend"
  docker build \
    --target production \
    -t "${REGISTRY}/spendhound-frontend:latest" \
    -f "${SPENDHOUND_DIR}/frontend/Dockerfile" \
    "${SPENDHOUND_DIR}/frontend"

  echo "==> Pushing spendhound-frontend"
  docker push "${REGISTRY}/spendhound-frontend:latest"

  echo "   spendhound images pushed OK"
}

push_jobhound() {
  echo "==> Building jobhound-backend"
  docker build \
    --target production \
    -t "${REGISTRY}/jobhound-backend:latest" \
    -f "${JOBHOUND_DIR}/backend/Dockerfile" \
    "${JOBHOUND_DIR}/backend"

  echo "==> Pushing jobhound-backend"
  docker push "${REGISTRY}/jobhound-backend:latest"

  echo "==> Building jobhound-frontend"
  docker build \
    --target production \
    -t "${REGISTRY}/jobhound-frontend:latest" \
    -f "${JOBHOUND_DIR}/frontend/Dockerfile" \
    "${JOBHOUND_DIR}/frontend"

  echo "==> Pushing jobhound-frontend"
  docker push "${REGISTRY}/jobhound-frontend:latest"

  echo "   jobhound images pushed OK"
}

case "${FILTER}" in
  spendhound) push_spendhound ;;
  jobhound)   push_jobhound ;;
  all)
    push_spendhound
    push_jobhound
    ;;
  *)
    echo "Unknown filter: ${FILTER}. Use: spendhound | jobhound | all"
    exit 1
    ;;
esac

echo ""
echo "==> Registry catalog:"
curl -s "http://${REGISTRY}/v2/_catalog" | python3 -m json.tool
