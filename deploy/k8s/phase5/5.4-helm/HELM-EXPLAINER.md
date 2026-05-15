# What is Helm and how to use it

## The 30-second version

Helm is the package manager for Kubernetes — think of it like `apt` or `pip`, but for clusters.

Without Helm, to deploy SpendHound you run:
```bash
kubectl apply -f phase2/2.1-backend/backend-pvc.yaml
kubectl apply -f phase2/2.1-backend/backend-deployment.yaml
kubectl apply -f phase2/2.2-frontend/frontend-deployment.yaml
# ... 8 more files
```

With Helm, all of those files become one chart and one command:
```bash
helm install spendhound ./spendhound --namespace spendhound
```

To upgrade (new image tag):
```bash
helm upgrade spendhound ./spendhound --set backend.tag=v1.2 --namespace spendhound
```

To roll back to the previous version:
```bash
helm rollback spendhound 1 --namespace spendhound
```

To see what's deployed:
```bash
helm list --all-namespaces
helm history spendhound --namespace spendhound
```

To remove everything cleanly:
```bash
helm uninstall spendhound --namespace spendhound
```

## Key concepts

**Chart** — a directory with a `Chart.yaml` (metadata), `values.yaml` (defaults), and
`templates/` (YAML files with `{{ .Values.something }}` placeholders).

**Release** — one installed instance of a chart. You can install the same chart twice
with different names (e.g., `spendhound-staging` and `spendhound-prod`), each with
different values.

**Values** — the knobs you turn. Anything in `values.yaml` can be overridden at install
time with `--set key=value` or `--values myoverrides.yaml`.

**Template** — a YAML file where `{{ .Values.backend.replicas }}` is replaced at
deploy time with whatever value `backend.replicas` holds (from values.yaml or your override).

## The spendhound chart (this directory)

Files:
```
spendhound/
  Chart.yaml              — name, version, description
  values.yaml             — all tunable defaults (image tags, resource limits, hostname)
  templates/
    backend-deployment.yaml
    frontend-deployment.yaml
    services.yaml
    ingress.yaml
    receipts-pvc.yaml
```

Install it:
```bash
# First, make sure namespaces and ExternalSecrets are applied (those are not in the chart)
kubectl apply -f ../../phase0/0.7-namespaces.yaml
kubectl apply -f ../../phase1/1.3-external-secrets/

# Then install the chart
helm install spendhound ./spendhound \
  --namespace spendhound \
  --set backend.tag=latest \
  --set frontend.tag=latest
```

Update image and redeploy:
```bash
# After pushing a new image to the registry
helm upgrade spendhound ./spendhound --namespace spendhound --set backend.tag=v2
```

## Deploying a new app (e.g., Immich) in one command

Copy the chart, change values.yaml (image, hostname, PVC size), and install:
```bash
cp -r spendhound immich
# edit immich/values.yaml and immich/templates/ as needed
helm install immich ./immich --namespace immich --create-namespace
```

That is the point of Helm: new apps become a template exercise, not a new pile of YAML.

## Helm vs plain kubectl apply

| | Plain kubectl apply | Helm |
|---|---|---|
| Install | Many separate apply commands | `helm install` |
| Upgrade | Edit YAML + apply again | `helm upgrade --set tag=v2` |
| Rollback | Manually revert YAML | `helm rollback` |
| Uninstall | Delete every resource manually | `helm uninstall` |
| Track releases | No record | `helm history` |
| Parameterise | Copy/paste + sed | `values.yaml` + `--set` |

For a home lab with 2 apps, plain kubectl apply is fine. Helm starts earning its keep
at 3+ apps, or when you want to deploy the same app in staging and production with
different config.
