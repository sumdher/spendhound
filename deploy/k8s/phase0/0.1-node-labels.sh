#!/usr/bin/env bash
# Phase 0.1 — Label all cluster nodes for scheduling
# Run once after all nodes have joined the cluster (kubectl get nodes shows Ready).
# Re-running is safe; labels are idempotent.

set -euo pipefail

echo "==> Labelling zoro (control plane + GPU + primary storage)"
kubectl label node zoro \
  node-role=control \
  hardware=gpu \
  storage=primary \
  --overwrite

echo "==> Labelling zunesha (reserve/light worker)"
kubectl label node zunesha \
  node-role=worker \
  --overwrite

echo "==> Labelling kuma (primary worker, i5-6200U / 8 GB)"
kubectl label node kuma \
  node-role=worker \
  --overwrite

echo "==> Labelling sanji (reserve/light worker)"
kubectl label node sanji \
  node-role=worker \
  --overwrite

echo ""
echo "==> Verifying labels"
kubectl get nodes -o custom-columns=\
'NAME:.metadata.name,NODE-ROLE:.metadata.labels.node-role,HARDWARE:.metadata.labels.hardware,STORAGE:.metadata.labels.storage'
