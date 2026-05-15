# PostgreSQL data migration guide

Migrate data from the Docker Compose volume on zoro to the new K8s PVC.
Do this **before** starting the PostgreSQL StatefulSet with live data.

---

## Overview

```
Docker volume  →  pg_dump  →  dump file on zoro  →  pg_restore  →  K8s PVC
(old postgres)                 (/data/pg-backup/)                   (/data/postgres)
```

---

## Step 1 — Dump existing data (Docker Compose must still be stopped)

SpendHound and JobHound must be stopped before dumping.
The old PostgreSQL container can be started temporarily just for the dump.

```bash
# Find the old volume mount path
docker inspect spendhound_db_prod | grep -A5 Mounts
# Or just start the old container temporarily:

cd ~/repos/spendhound-k8s
docker compose -f docker-compose.prod.yml up -d db

# Dump spendhound database
mkdir -p /data/pg-backup
docker exec spendhound_db_prod \
  pg_dump -U "${POSTGRES_USER}" -d spendhound --format=custom \
  > /data/pg-backup/spendhound-$(date +%Y%m%d).dump

# If JobHound has its own Postgres container, dump it too:
# docker exec jobhound_db_prod \
#   pg_dump -U "${POSTGRES_USER}" -d jobhound --format=custom \
#   > /data/pg-backup/jobhound-$(date +%Y%m%d).dump

# Stop the container again
docker compose -f docker-compose.prod.yml stop db
```

---

## Step 2 — Apply Phase 0.7 namespaces and Phase 1.3 ExternalSecrets

The PostgreSQL pod needs the `shared-infra-secrets` K8s secret to exist
before it can start (it reads POSTGRES_USER / POSTGRES_PASSWORD from it).

```bash
kubectl apply -f deploy/k8s/phase0/0.7-namespaces.yaml
kubectl apply -f deploy/k8s/phase1/1.3-external-secrets/shared-infra-es.yaml

# Wait for secrets to be populated
kubectl get externalsecret shared-infra -n shared --watch
# STATUS should become "SecretSynced"
```

---

## Step 3 — Create the host directory and apply the StatefulSet

```bash
# Create the data directory on zoro with postgres ownership (UID 999 inside container)
sudo mkdir -p /data/postgres
sudo chown 999:999 /data/postgres

# Apply init ConfigMap + StatefulSet + Service
kubectl apply -f deploy/k8s/phase1/1.1-postgres/postgres-init-configmap.yaml
kubectl apply -f deploy/k8s/phase1/1.1-postgres/postgres-statefulset.yaml
kubectl apply -f deploy/k8s/phase1/1.1-postgres/postgres-service.yaml

# Wait for postgres to be ready
kubectl rollout status statefulset/postgres -n shared --timeout=120s
```

At this point the `spendhound` and `jobhound` databases exist (created by the
init script), but they are empty.

---

## Step 4 — Restore data into the K8s PostgreSQL

```bash
# Copy the dump files into the postgres pod
POSTGRES_POD=$(kubectl get pod -n shared -l app=postgres -o jsonpath='{.items[0].metadata.name}')

kubectl cp /data/pg-backup/spendhound-*.dump shared/${POSTGRES_POD}:/tmp/spendhound.dump

# Restore — pg_restore connects to the already-created spendhound database
kubectl exec -n shared "${POSTGRES_POD}" -- \
  bash -c 'pg_restore -U "${POSTGRES_USER}" -d spendhound --no-owner --role="${POSTGRES_USER}" /tmp/spendhound.dump'

# Repeat for jobhound if you have a dump:
# kubectl cp /data/pg-backup/jobhound-*.dump shared/${POSTGRES_POD}:/tmp/jobhound.dump
# kubectl exec -n shared "${POSTGRES_POD}" -- \
#   bash -c 'pg_restore -U "${POSTGRES_USER}" -d jobhound --no-owner --role="${POSTGRES_USER}" /tmp/jobhound.dump'

# Clean up the dump from the pod
kubectl exec -n shared "${POSTGRES_POD}" -- rm /tmp/spendhound.dump
```

---

## Step 5 — Verify row counts

```bash
POSTGRES_POD=$(kubectl get pod -n shared -l app=postgres -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n shared "${POSTGRES_POD}" -- \
  psql -U "${POSTGRES_USER}" -d spendhound -c "\dt" -c "SELECT count(*) FROM expenses;"
```

Expected: tables exist and row count matches the source database.

---

## Notes

- The StatefulSet PVC is bound to zoro's `/data/postgres` hostPath. Never move
  the StatefulSet to another node without also moving (or copying) the data directory.
- `--no-owner` in pg_restore avoids ownership mismatches if the old and new
  POSTGRES_USER values differ.
- The `--format=custom` dump (pg_dump -Fc) is smaller and supports parallel
  restore (`-j N`) if needed for large databases.
