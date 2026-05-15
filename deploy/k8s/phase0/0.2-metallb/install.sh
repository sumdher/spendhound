#!/usr/bin/env bash
# Phase 0.2 — Install MetalLB and apply L2 configuration
# MetalLB version pinned. To upgrade: bump the version variable below.

set -euo pipefail

METALLB_VERSION="v0.14.9"

echo "==> Installing MetalLB ${METALLB_VERSION} (native mode)"
kubectl apply -f "https://raw.githubusercontent.com/metallb/metallb/${METALLB_VERSION}/config/manifests/metallb-native.yaml"

echo "==> Waiting for MetalLB controller to be ready (up to 120s)"
kubectl rollout status deployment/controller -n metallb-system --timeout=120s

echo "==> Waiting for MetalLB webhook service to be ready"
kubectl wait --namespace metallb-system \
  --for=condition=ready pod \
  --selector=component=controller \
  --timeout=120s

echo "==> Applying IP address pool and L2 advertisement"
kubectl apply -f "$(dirname "$0")/ipaddresspool.yaml"
kubectl apply -f "$(dirname "$0")/l2advertisement.yaml"

echo ""
echo "==> Verify: create a test LoadBalancer service and check it gets an IP from the pool"
echo "    kubectl create service loadbalancer test-lb --tcp=80:80"
echo "    kubectl get svc test-lb   # EXTERNAL-IP should be 192.168.1.200–210"
echo "    kubectl delete svc test-lb"
