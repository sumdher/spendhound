#!/usr/bin/env bash
# Phase 0.6 — Distribute K3s registry mirror config to all nodes
#
# Prerequisites:
#   - SSH access to all nodes (passwordless, or run with an ssh-agent loaded)
#   - The registry Deployment (registry.yaml) is already running on zoro
#
# What this does:
#   1. Copies registries.yaml to /etc/rancher/k3s/ on every node
#   2. Restarts k3s / k3s-agent so containerd picks up the new mirror

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRIES_YAML="${SCRIPT_DIR}/registries.yaml"

CONTROL_PLANE="zoro"
WORKERS=("zunesha" "kuma" "sanji")

distribute_config() {
  local host="$1"
  local is_agent="${2:-true}"

  echo "==> Configuring ${host}"
  ssh "${host}" "sudo mkdir -p /etc/rancher/k3s"
  scp "${REGISTRIES_YAML}" "${host}:/tmp/registries.yaml"
  ssh "${host}" "sudo mv /tmp/registries.yaml /etc/rancher/k3s/registries.yaml && sudo chmod 644 /etc/rancher/k3s/registries.yaml"

  if [[ "${is_agent}" == "false" ]]; then
    ssh "${host}" "sudo systemctl restart k3s"
    echo "   Restarted k3s on ${host} (control plane)"
  else
    ssh "${host}" "sudo systemctl restart k3s-agent"
    echo "   Restarted k3s-agent on ${host} (worker)"
  fi
}

distribute_config "${CONTROL_PLANE}" "false"
for worker in "${WORKERS[@]}"; do
  distribute_config "${worker}" "true"
done

echo ""
echo "==> Waiting 10s for nodes to reconnect..."
sleep 10

echo "==> Node status after restart:"
kubectl get nodes

echo ""
echo "==> Verify: try pulling a test image from the registry"
echo "    kubectl run test-pull --image=192.168.1.37:5000/spendhound-backend:latest --restart=Never --command -- sleep 1 || true"
echo "    kubectl delete pod test-pull --ignore-not-found"
