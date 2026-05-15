#!/usr/bin/env bash
# Phase 5.3 — Install kube-prometheus-stack (Prometheus + Grafana + node-exporter
# + kube-state-metrics) via Helm in the `monitoring` namespace.
#
# This is a single Helm chart that bundles everything you need:
#   - Prometheus (with pre-configured K8s scrape jobs)
#   - Grafana (with pre-loaded K8s dashboards)
#   - node-exporter DaemonSet (per-node CPU / memory / disk metrics)
#   - kube-state-metrics Deployment (pod / deployment / PVC state)
#   - AlertManager (optional — disable below if you don't need alerts yet)
#
# Decision on existing IoT Grafana/InfluxDB on zoro:
#   Keep them separate for now. The kube-prometheus-stack runs in the `monitoring`
#   namespace inside K8s; the IoT Grafana on zoro's host continues to run.
#   If you want to consolidate later, add an InfluxDB data source in Grafana
#   inside K8s — no migration needed.
#
# After install, access Grafana:
#   kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80
#   # Open: http://localhost:3000 — admin / prom-operator (change this!)
#   # Or add an IngressRoute for monitoring.homelab.internal if you have internal DNS.

set -euo pipefail

STACK_VERSION="65.2.0"   # kube-prometheus-stack chart version

GRAFANA_PASSWORD="${1:-}"
if [[ -z "${GRAFANA_PASSWORD}" ]]; then
  echo "Usage: $0 <grafana-admin-password>"
  echo "  The password is set once and stored in a K8s secret by Helm."
  exit 1
fi

echo "==> Adding prometheus-community Helm repo"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

echo "==> Installing kube-prometheus-stack ${STACK_VERSION}"
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --version "${STACK_VERSION}" \
  --values "$(dirname "$0")/values.yaml" \
  --set "grafana.adminPassword=${GRAFANA_PASSWORD}" \
  --wait \
  --timeout 5m

echo ""
echo "==> Stack components:"
kubectl get pods -n monitoring

echo ""
echo "==> Access Grafana:"
echo "    kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 3000:80"
echo "    URL: http://localhost:3000  |  User: admin  |  Password: prom-operator"
echo ""
echo "==> Change the Grafana password immediately:"
echo "    kubectl exec -n monitoring deployment/kube-prometheus-stack-grafana -- \\"
echo "      grafana-cli admin reset-admin-password <new-password>"
