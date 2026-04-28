# SpendHound Makefile
#
# Secrets are managed by Infisical. Install the CLI: https://infisical.com/docs/cli/overview
# Login once with: infisical login
#
# Usage:
#   make dev          # build + start dev stack (foreground)
#   make dev-detach   # build + start dev stack (background)
#   make prod         # build + start prod stack (background)
#   make prod-logs    # follow prod logs
#   make down         # stop dev stack
#   make prod-down    # stop prod stack
#   make restart      # down + dev
#   make restart-prod # prod-down + prod

.PHONY: dev dev-detach prod prod-recreate prod-logs down prod-down restart restart-prod

# Infisical wrappers — injects secrets into the shell before docker compose reads ${VAR} substitutions
INFISICAL_DEV  = infisical run --env dev  --path / --recursive --
INFISICAL_PROD = infisical run --env prod --path / --recursive --

# ── Development ───────────────────────────────────────────────────────────────

dev:
	$(INFISICAL_DEV) docker compose up --build

dev-detach:
	$(INFISICAL_DEV) docker compose up --build -d

# ── Production ────────────────────────────────────────────────────────────────

prod:
	$(INFISICAL_PROD) docker compose -f docker-compose.prod.yml up --build -d

prod-recreate:
	$(INFISICAL_PROD) docker compose -f docker-compose.prod.yml up --build --force-recreate -d

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f

# ── Stop ──────────────────────────────────────────────────────────────────────

down:
	docker compose down

prod-down:
	docker compose -f docker-compose.prod.yml down

# ── Restart ───────────────────────────────────────────────────────────────────

restart: down dev

restart-prod: prod-down prod
