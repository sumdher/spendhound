#!/usr/bin/env bash
# Phase 3 — Smoke tests
#
# Runs all internal connectivity checks and reports pass/fail.
# Creates a temporary debug pod (netshoot) inside the cluster, runs checks
# from inside, and cleans up.
#
# Usage:
#   ./smoke-tests.sh              # run all checks
#   ./smoke-tests.sh internal     # only internal connectivity
#   ./smoke-tests.sh external     # remind about external checks (manual)

set -euo pipefail

FILTER="${1:-all}"
PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
red()   { printf '\033[31m✗ %s\033[0m\n' "$1"; }

check() {
  local desc="$1"
  shift
  if "$@" &>/dev/null; then
    green "${desc}"
    ((PASS++)) || true
  else
    red "${desc}"
    ((FAIL++)) || true
    ERRORS+=("${desc}")
  fi
}

# ---------------------------------------------------------------------------
# 3.1 — Internal connectivity (from inside the cluster)
# ---------------------------------------------------------------------------
run_internal_checks() {
  echo ""
  echo "=== 3.1 Internal connectivity checks ==="
  echo "    (spinning up netshoot debug pod — takes ~10s)"

  # Clean up any leftover debug pod
  kubectl delete pod smoke-test-debug -n spendhound --ignore-not-found --wait=false 2>/dev/null || true

  # Launch a debug pod and wait for it to be running
  kubectl run smoke-test-debug \
    --image=nicolaka/netshoot:latest \
    --restart=Never \
    --namespace=spendhound \
    --command \
    -- sleep 120

  kubectl wait pod/smoke-test-debug \
    -n spendhound \
    --for=condition=Ready \
    --timeout=60s

  exec_check() {
    kubectl exec -n spendhound smoke-test-debug -- "$@"
  }

  # PostgreSQL
  check "postgres.shared.svc.cluster.local:5432 reachable" \
    exec_check nc -z postgres.shared.svc.cluster.local 5432

  # Ollama
  check "ollama.shared.svc.cluster.local:11434 returns /api/tags" \
    exec_check curl -sf http://ollama.shared.svc.cluster.local:11434/api/tags

  # SpendHound backend
  check "spendhound-backend.spendhound.svc.cluster.local:8000/health returns 200" \
    exec_check curl -sf http://spendhound-backend.spendhound.svc.cluster.local:8000/health

  # SpendHound frontend
  check "spendhound-frontend.spendhound.svc.cluster.local:3000 returns 200" \
    exec_check curl -sf http://spendhound-frontend.spendhound.svc.cluster.local:3000

  # Traefik (MetalLB IP — check from inside cluster too)
  check "traefik.kube-system.svc.cluster.local:80 reachable" \
    exec_check nc -z traefik.kube-system.svc.cluster.local 80

  kubectl delete pod smoke-test-debug -n spendhound --ignore-not-found &
  echo ""
}

# ---------------------------------------------------------------------------
# 3.2 — Resilience checks
# ---------------------------------------------------------------------------
run_resilience_checks() {
  echo "=== 3.3 Resilience checks ==="

  # Kill backend pod and verify it restarts
  BACKEND_POD=$(kubectl get pod -n spendhound -l app=spendhound-backend \
    -o jsonpath='{.items[0].metadata.name}')
  echo "    Killing backend pod ${BACKEND_POD}..."
  kubectl delete pod "${BACKEND_POD}" -n spendhound --wait=false

  sleep 5

  check "Backend pod restarted and is Running after kill" \
    kubectl wait pod \
      -n spendhound \
      -l app=spendhound-backend \
      --for=condition=Ready \
      --timeout=60s

  # Count frontend pods — should be 2 even if we kill one
  FRONTEND_POD=$(kubectl get pod -n spendhound -l app=spendhound-frontend \
    -o jsonpath='{.items[0].metadata.name}')
  echo "    Killing one frontend pod ${FRONTEND_POD}..."
  kubectl delete pod "${FRONTEND_POD}" -n spendhound --wait=false

  sleep 3

  check "Remaining frontend pod still Ready after sibling kill" \
    kubectl get pod -n spendhound -l app=spendhound-frontend \
      -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' \
      | grep -q "True"

  echo ""
}

# ---------------------------------------------------------------------------
# K8s state checks (don't need a debug pod)
# ---------------------------------------------------------------------------
run_state_checks() {
  echo "=== Kubernetes object state ==="

  check "shared-infra-secrets populated" \
    kubectl get secret shared-infra-secrets -n shared

  check "spendhound-backend-secrets populated" \
    kubectl get secret spendhound-backend-secrets -n spendhound

  check "spendhound-frontend-secrets populated" \
    kubectl get secret spendhound-frontend-secrets -n spendhound

  check "postgres StatefulSet ready (1/1)" \
    kubectl rollout status statefulset/postgres -n shared --timeout=10s

  check "ollama Deployment ready" \
    kubectl rollout status deployment/ollama -n shared --timeout=10s

  check "spendhound-backend Deployment ready" \
    kubectl rollout status deployment/spendhound-backend -n spendhound --timeout=10s

  check "spendhound-frontend Deployment ready (2/2)" \
    kubectl rollout status deployment/spendhound-frontend -n spendhound --timeout=10s

  check "spendhound-cloudflared Deployment ready (2/2)" \
    kubectl rollout status deployment/spendhound-cloudflared -n spendhound --timeout=10s

  check "MetalLB controller running" \
    kubectl rollout status deployment/controller -n metallb-system --timeout=10s

  check "Traefik running" \
    kubectl rollout status deployment/traefik -n kube-system --timeout=10s

  # Traefik should have the MetalLB IP
  TRAEFIK_IP=$(kubectl get svc traefik -n kube-system \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
  if [[ "${TRAEFIK_IP}" == "192.168.1.200" ]]; then
    green "Traefik external IP is 192.168.1.200"
    ((PASS++)) || true
  else
    red "Traefik external IP is '${TRAEFIK_IP}' (expected 192.168.1.200)"
    ((FAIL++)) || true
    ERRORS+=("Traefik MetalLB IP")
  fi

  echo ""
}

# ---------------------------------------------------------------------------
# 3.2 — External / manual checks (printed as checklist)
# ---------------------------------------------------------------------------
print_external_checklist() {
  echo "=== 3.2 External checks (manual) ==="
  echo "    These must be verified in a browser / by hand:"
  echo ""
  echo "  [ ] spendhound.dodecahedrons.com loads in browser"
  echo "  [ ] Google OAuth login works end-to-end"
  echo "  [ ] Upload a receipt → parsed and saved (confirms PVC writable)"
  echo "  [ ] Send a chat message → LLM responds (confirms Ollama connectivity)"
  echo "  [ ] Monthly report endpoint works (Settings → Generate Report)"
  echo ""
  echo "    Log checks:"
  echo "  kubectl logs -n spendhound deployment/spendhound-backend  --tail=50"
  echo "  kubectl logs -n spendhound deployment/spendhound-frontend --tail=50"
  echo "  kubectl logs -n spendhound deployment/spendhound-cloudflared --tail=50"
  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${FILTER}" in
  internal)
    run_state_checks
    run_internal_checks
    ;;
  external)
    print_external_checklist
    ;;
  resilience)
    run_resilience_checks
    ;;
  all)
    run_state_checks
    run_internal_checks
    run_resilience_checks
    print_external_checklist
    ;;
  *)
    echo "Usage: $0 [all|internal|external|resilience]"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "================================"
echo "  Results: ${PASS} passed, ${FAIL} failed"
if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo "  Failed checks:"
  for e in "${ERRORS[@]}"; do
    echo "    - ${e}"
  done
  echo ""
  exit 1
else
  echo "  All automated checks passed."
fi
