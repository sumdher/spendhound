#!/usr/bin/env bash
# Phase 0.6 — Build and push SpendHound images to the local registry
#
# Run from zoro (the node with docker and the source repo).
# The registry must already be running (phase 0.6 registry.yaml applied).
#
# After first push, subsequent pushes reuse layer cache so they are fast.

set -euo pipefail

REGISTRY="192.168.1.37:5000"
SPENDHOUND_DIR="${HOME}/repos/spendhound-k8s"

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

echo ""
echo "==> Registry catalog:"
curl -s "http://${REGISTRY}/v2/_catalog" | python3 -m json.tool
