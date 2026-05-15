#!/usr/bin/env bash
# Master deployment script — applies all phases in order.
#
# This script is idempotent: running it a second time is safe (kubectl apply
# and helm upgrade --install are both no-ops when state already matches).
#
# IMPORTANT: Before running this script:
#   1. Complete the prerequisites in each phase's README / comments:
#      - Phase 0.4: create infisical-credentials secret imperatively
#      - Phase 0.5: install NVIDIA driver + container runtime on zoro
#      - Phase 0.6: run push-images.sh to push app images to the registry
#      - Phase 1.1: run the data migration (see migration-guide.md)
#      - Infisical: populate all secrets at paths /, /backend, /frontend
#      - Cloudflare: set CLOUDFLARE_TUNNEL_TOKEN_SPENDHOUND in Infisical
#
# Usage:
#   ./apply-all.sh              # all phases
#   ./apply-all.sh phase0       # only phase 0
#   ./apply-all.sh phase1       # only phase 1
#   ./apply-all.sh phase2       # only phase 2
#   ./apply-all.sh phase3       # smoke tests
#   ./apply-all.sh phase5       # operational hardening

set -euo pipefail

K8S_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER="${1:-all}"

wait_for_crds() {
  local crd="$1"
  echo "    waiting for CRD ${crd}..."
  until kubectl get crd "${crd}" &>/dev/null; do sleep 2; done
}

# ---------------------------------------------------------------------------
phase0() {
  echo ""
  echo "========================================="
  echo "  Phase 0 — Cluster foundation"
  echo "========================================="

  echo "--> 0.1 Node labels"
  bash "${K8S_DIR}/phase0/0.1-node-labels.sh"

  echo "--> 0.2 MetalLB"
  bash "${K8S_DIR}/phase0/0.2-metallb/install.sh"

  echo "--> 0.3 Traefik HelmChartConfig"
  kubectl apply -f "${K8S_DIR}/phase0/0.3-traefik/traefik-helmchartconfig.yaml"
  echo "    Waiting for Traefik rollout..."
  kubectl rollout status deployment/traefik -n kube-system --timeout=120s

  echo "--> 0.4 External Secrets Operator"
  bash "${K8S_DIR}/phase0/0.4-eso/install.sh"
  wait_for_crds "externalsecrets.external-secrets.io"
  wait_for_crds "clustersecretstores.external-secrets.io"
  kubectl apply -f "${K8S_DIR}/phase0/0.4-eso/clustersecretstore.yaml"

  echo "--> 0.5 NVIDIA device plugin"
  kubectl apply -f "${K8S_DIR}/phase0/0.5-nvidia/nvidia-device-plugin.yaml"

  echo "--> 0.6 Local registry"
  kubectl apply -f "${K8S_DIR}/phase0/0.7-namespaces.yaml"   # need shared ns first
  kubectl apply -f "${K8S_DIR}/phase0/0.6-registry/registry.yaml"
  kubectl rollout status deployment/registry -n shared --timeout=120s

  echo "--> 0.7 Namespaces"
  kubectl apply -f "${K8S_DIR}/phase0/0.7-namespaces.yaml"

  echo "Phase 0 complete."
}

# ---------------------------------------------------------------------------
phase1() {
  echo ""
  echo "========================================="
  echo "  Phase 1 — Shared infrastructure"
  echo "========================================="

  echo "--> 1.1 PostgreSQL"
  kubectl apply -f "${K8S_DIR}/phase1/1.1-postgres/postgres-init-configmap.yaml"
  kubectl apply -f "${K8S_DIR}/phase1/1.1-postgres/postgres-statefulset.yaml"
  kubectl apply -f "${K8S_DIR}/phase1/1.1-postgres/postgres-service.yaml"
  kubectl rollout status statefulset/postgres -n shared --timeout=180s

  echo "--> 1.2 Ollama"
  kubectl apply -f "${K8S_DIR}/phase1/1.2-ollama/ollama-pvc.yaml"
  kubectl apply -f "${K8S_DIR}/phase1/1.2-ollama/ollama-deployment.yaml"
  kubectl apply -f "${K8S_DIR}/phase1/1.2-ollama/ollama-service.yaml"

  echo "--> 1.3 ExternalSecrets"
  kubectl apply -f "${K8S_DIR}/phase1/1.3-external-secrets/"

  echo "    Waiting for shared-infra-secrets to be synced..."
  kubectl wait externalsecret/shared-infra -n shared \
    --for=condition=Ready --timeout=60s

  echo "    Waiting for spendhound secrets to be synced..."
  kubectl wait externalsecret/spendhound-backend -n spendhound \
    --for=condition=Ready --timeout=60s
  kubectl wait externalsecret/spendhound-frontend -n spendhound \
    --for=condition=Ready --timeout=60s

  echo "Phase 1 complete."
}

# ---------------------------------------------------------------------------
phase2() {
  echo ""
  echo "========================================="
  echo "  Phase 2 — SpendHound application"
  echo "========================================="

  echo "--> 2.1 Backend"
  kubectl apply -f "${K8S_DIR}/phase2/2.1-backend/"
  kubectl rollout status deployment/spendhound-backend -n spendhound --timeout=180s

  echo "--> 2.2 Frontend"
  kubectl apply -f "${K8S_DIR}/phase2/2.2-frontend/"
  kubectl rollout status deployment/spendhound-frontend -n spendhound --timeout=120s

  echo "--> 2.3 Services"
  kubectl apply -f "${K8S_DIR}/phase2/2.3-services.yaml"

  echo "--> 2.4 Ingress"
  kubectl apply -f "${K8S_DIR}/phase2/2.4-ingress.yaml"

  echo "--> 2.5 Cloudflared"
  kubectl apply -f "${K8S_DIR}/phase2/2.5-cloudflared/"
  kubectl rollout status deployment/spendhound-cloudflared -n spendhound --timeout=60s

  echo "Phase 2 complete."
}

# ---------------------------------------------------------------------------
phase3() {
  echo ""
  echo "========================================="
  echo "  Phase 3 — Smoke tests"
  echo "========================================="
  bash "${K8S_DIR}/phase3/smoke-tests.sh" all
}

# ---------------------------------------------------------------------------
phase5() {
  echo ""
  echo "========================================="
  echo "  Phase 5 — Operational hardening"
  echo "========================================="

  echo "--> 5.1 Resource quotas"
  kubectl apply -f "${K8S_DIR}/phase5/5.1-resource-quotas.yaml"

  echo "--> 5.2 Backup CronJob"
  kubectl apply -f "${K8S_DIR}/phase5/5.2-backup-cronjob.yaml"

  echo "--> 5.3 Monitoring (kube-prometheus-stack via Helm)"
  bash "${K8S_DIR}/phase5/5.3-monitoring/install.sh"

  echo "Phase 5 complete."
}

# ---------------------------------------------------------------------------
case "${FILTER}" in
  phase0) phase0 ;;
  phase1) phase1 ;;
  phase2) phase2 ;;
  phase3) phase3 ;;
  phase5) phase5 ;;
  all)    phase0; phase1; phase2; phase3; phase5 ;;
  *)
    echo "Usage: $0 [all|phase0|phase1|phase2|phase3|phase5]"
    exit 1
    ;;
esac

echo ""
echo "Done. Run './phase3/smoke-tests.sh all' at any time to verify cluster health."
