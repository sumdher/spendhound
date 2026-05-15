#!/usr/bin/env bash
# Phase 0.4 — Install External Secrets Operator (ESO) via Helm
# ESO version pinned. To upgrade: bump ESO_VERSION below.

set -euo pipefail

ESO_VERSION="0.10.7"

echo "==> Adding External Secrets Helm repo"
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

echo "==> Installing ESO ${ESO_VERSION} into external-secrets namespace"
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --version "${ESO_VERSION}" \
  --set installCRDs=true \
  --wait

echo "==> Waiting for ESO webhook to be ready"
kubectl rollout status deployment/external-secrets-webhook -n external-secrets --timeout=120s

echo ""
echo "==> Next: create the infisical-credentials secret, then apply clustersecretstore.yaml"
echo "    See: 0.4-eso/infisical-auth-secret.example.yaml"
