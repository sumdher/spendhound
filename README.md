# SpendHound

SpendHound is a production-ready, full-stack AI expense tracker with multimodal receipt extraction, RAG-powered financial chat, multi-currency shared ledgers, recurring expense automation, budget analytics, and automated monthly PDF reports. Optimized for Italian receipts; works with any language.

## Features

- Google OAuth with admin approval flow
- Multimodal receipt upload — extracts merchant, amount, date, and line items via LLM; falls back through a 3-tier OCR stack (pdfplumber → pdfminer → pytesseract) for large files
- Bank statement PDF import with per-transaction confidence scores
- Manual expense entry with full edit support
- RAG semantic item classification using pgvector + Ollama embeddings with a user-correction learning loop
- Editable categories, merchant rules, and item keyword rules (global admin-wide + per-user)
- SSE-streaming financial chat grounded on 90 days of live expense data
- Multi-currency shared ledgers with role-based membership and full audit trail
- Recurring expenses (6 cadence types: monthly, quarterly, annual, custom-interval, prepaid, one-time) with auto-generation
- Monthly dashboard analytics and budget-versus-actual tracking
- Review queue for low-confidence or uncategorized items
- CSV and JSON exports
- Automated monthly PDF report delivery via Puppeteer + Resend
- Admin approval panel with JWT-signed email-link tokens
- Pluggable LLM providers: Ollama (default, local, no API key required), Anthropic Claude, OpenAI, Nebius, and OpenAI-compatible endpoints

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI 0.115 · Python 3.12 · SQLAlchemy 2.0 async · asyncpg |
| Database | PostgreSQL 16 + pgvector extension |
| Migrations | Alembic |
| Frontend | Next.js 14.2 App Router · NextAuth.js 4.24 · TailwindCSS · Recharts |
| Auth | Google OAuth 2.0 · HS256 JWT (python-jose) |
| LLM | Anthropic Claude · OpenAI · Ollama · Nebius (pluggable factory) |
| PDF generation | Puppeteer (headless Chromium, via Next.js internal route) |
| Email | Resend API |
| Containerization | Docker + Docker Compose |

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Docker + Compose v2 plugin | Docker 24+ |
| Python | 3.12+ (local dev only) |
| Node.js | 18+ (local dev only) |
| Ollama | any recent release (optional, for local LLM) |

---

## Google OAuth setup

SpendHound requires a Google OAuth 2.0 client for sign-in.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (type: Web application)
3. Add these to **Authorised redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (local frontend dev)
   - `http://localhost:3001/api/auth/callback/google` (Docker Compose)
   - `https://yourdomain.com/api/auth/callback/google` (production)
4. Copy **Client ID** and **Client Secret** — you will need both below

---

## Local development with Docker Compose

### 1. Clone and enter the repository

```bash
git clone https://github.com/your-username/spendhound.git
cd spendhound
```

### 2. Generate secrets

```bash
# JWT signing key (backend)
python3 -c "import secrets; print(secrets.token_hex(32))"

# NextAuth secret (frontend)
python3 -c "import secrets; print(secrets.token_hex(32))"

# Fernet key for encrypting user LLM API keys at rest (backend, optional but recommended)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. Configure environment files

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**`backend/.env` — required values:**

```env
GOOGLE_CLIENT_ID=<your Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
JWT_SECRET=<strong random value from step 2 — app refuses to start without this>
ADMIN_EMAIL=<your email — auto-approved on first sign-in, receives user approval requests>
```

**`backend/.env` — optional values:**

```env
# Approval emails (requires a Resend account)
RESEND_API_KEY=<your Resend API key>
RESEND_FROM_EMAIL=<a sender address verified on your Resend account>
APP_URL=http://localhost:3001   # or your production URL — used in approval email links

# LLM providers (Ollama is used by default and requires no key)
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=gemma4:4b
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-20250514
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# Encrypt user-supplied LLM API keys stored in the database
LLM_KEY_ENCRYPTION_SECRET=<Fernet key from step 2>

# Monthly PDF reports (requires Puppeteer-compatible Chromium in the frontend container)
MONTHLY_REPORTS_ENABLED=false
MONTHLY_REPORTS_FRONTEND_TOKEN=<strong random shared secret>

# Recurring expense auto-generation
RECURRING_GENERATION_ENABLED=false

# Rate limits (defaults shown)
RATE_LIMIT_AUTH_PER_MINUTE=10
RATE_LIMIT_UPLOAD_PER_MINUTE=3
RATE_LIMIT_CHAT_PER_MINUTE=20

# Debug mode — enables /docs, /redoc, /openapi.json; skips startup secret check
DEBUG=false
```

**`frontend/.env` — required values:**

```env
GOOGLE_CLIENT_ID=<same Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<same Google OAuth client secret>
NEXTAUTH_SECRET=<strong random value from step 2>
NEXTAUTH_URL=http://localhost:3001   # or your production URL
```

**`frontend/.env` — optional values:**

```env
# Required only if monthly reports are enabled
MONTHLY_REPORTS_FRONTEND_TOKEN=<same value as backend>
MONTHLY_REPORTS_FRONTEND_TOKEN_HEADER=X-SpendHound-Internal-Token
MONTHLY_REPORTS_BACKEND_JWT_SECRET=<same value as JWT_SECRET in backend>
```

### 4. Start the app

```bash
docker compose up --build
```

Services:

| Service | URL |
|---|---|
| Frontend | http://localhost:3001 |
| Backend API | http://localhost:8000 |
| API docs (debug only) | http://localhost:8000/docs — only when `DEBUG=true` |
| PostgreSQL | localhost:5432 |

The backend container runs `alembic upgrade head` automatically before starting.

### 5. Sign in

Open http://localhost:3001, click **Sign in with Google**, and sign in with the email you set as `ADMIN_EMAIL`. That account is auto-approved. All other accounts start as `pending` and require admin approval via the email link sent to `ADMIN_EMAIL`.

---

## Local development without Docker

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
cp .env.example .env   # then fill in the values above
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # then fill in the values above
npm run dev            # http://localhost:3000
```

Set these additional values in `frontend/.env` for non-Docker runs:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
INTERNAL_API_URL=http://localhost:8000
NEXTAUTH_URL=http://localhost:3000
```

---

## Running tests

```bash
cd backend
pip install -e .[dev]
pytest tests/test_expenses_crud.py tests/test_parser.py
```

---

## Production deployment

### Docker Compose (recommended)

A production-ready Compose file is provided at [`docker-compose.prod.yml`](docker-compose.prod.yml). It pins service versions, disables the dev volume mounts, and expects a `.env` at the repository root for shared credentials.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

For HTTPS without a reverse proxy, an optional Cloudflare Tunnel service is included — add your `CLOUDFLARE_TUNNEL_TOKEN` to the root `.env`.

### PostgreSQL backups (systemd)

A host-side systemd backup setup lives under [`deploy/backup/`](deploy/backup/). Run this once on the production host from the repository root:

```bash
sudo bash ./deploy/backup/install-spendhound-db-backup.sh
```

This installs and enables a systemd timer that:

- runs daily at 03:15 UTC (with up to 15 min randomised delay; `Persistent=true` catches missed runs)
- dumps the running `db` container with `pg_dump`
- writes a compressed archive to a temp file, validates it with `pg_restore --list`, writes a SHA-256 checksum, then atomically renames both into place
- prunes old backups after the configured retention period
- runs with `set -Eeuo pipefail`, `umask 077`, and `flock` to prevent overlapping runs

Backups are stored in `/var/backups/spendhound`. Useful commands:

```bash
sudo systemctl status spendhound-db-backup.timer --no-pager
sudo systemctl list-timers spendhound-db-backup.timer
sudo journalctl -u spendhound-db-backup.service -n 50 --no-pager
```

### LLM concurrency (single-machine / single-GPU)

SpendHound is designed for a single-worker deployment (`--workers 1`). The in-process `asyncio.Semaphore` that serialises Ollama calls and the in-memory `slowapi` rate counters both require a single process. If you scale to multiple workers, replace the in-memory rate limiter with a Redis backend and the semaphore with a distributed lock.

Key concurrency settings in `backend/.env`:

```env
OLLAMA_MAX_CONCURRENT=1        # GPU semaphore width; increase only for CPU or multi-GPU
LLM_SEMAPHORE_WAIT_TIMEOUT=5.0 # Seconds to wait before returning HTTP 503
LLM_TIMEOUT_SECONDS=120        # Total timeout per LLM call
RECEIPT_QUEUE_MAXSIZE=10       # Max queued receipt extraction jobs
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=40
```

---

## Security

SpendHound applies defence-in-depth across the full stack.

### Secrets

- `JWT_SECRET` must be a strong random value. The backend **raises `RuntimeError` and refuses to start** in production (`DEBUG=false`) if the default placeholder is detected.
- User LLM API keys are Fernet-encrypted at rest; never returned in API responses (only a boolean `has_llm_api_key` is surfaced).
- `LLM_KEY_ENCRYPTION_SECRET` should be set to a Fernet key (see step 2 above). Without it, user-supplied API keys are stored unencrypted.

### API surface

- `/docs`, `/redoc`, and `/openapi.json` are only mounted when `DEBUG=true`. In production the full API schema is hidden.
- User search (`/api/auth/users/search`) requires a minimum query length of 3 characters to prevent single-character enumeration of user accounts.

### File uploads

Uploads pass three validation layers before anything reaches disk:

1. **Extension allowlist** — only `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.webp`, `.pdf` accepted; unknown extensions stored as `.bin`.
2. **Magic-byte verification** — actual file header bytes are checked against known signatures; a `.jpg` file with non-JPEG content is rejected with HTTP 400.
3. **Size cap** — 50 MB hard limit enforced before any I/O; returns HTTP 413.

### Bot / automation blocking

A `block_bots` dependency is applied to `POST /api/auth/google` and `POST /api/receipts/upload`. It rejects empty `User-Agent` headers and known non-browser client signatures, returning HTTP 403 before rate-limit counters are consumed.

### HTTP security headers

All frontend routes include:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'` |

### Prompt injection hardening

- **Chat:** All user-controlled data (merchant names, expense descriptions, receipt filenames, session titles, chat history) is wrapped in `<user_data>…</user_data>` XML delimiters in the LLM context. The system prompt explicitly instructs the model to treat inner content as untrusted read-only data, never as instructions.
- **Receipt extraction:** Per-user prompt overrides are sandboxed — an immutable role anchor is prepended before any user-supplied text, wrapped in `<extraction_instructions>` tags. A malicious override cannot change the model's role or produce non-JSON output.

---

## Receipt extraction flow

1. Open **Add expense** and switch to the **Upload receipt** tab
2. SpendHound validates the file (extension, magic bytes, size), stores it under `storage/receipts/{user_id}/`
3. The upload returns immediately; extraction is queued into a bounded `asyncio.Queue` and processed by a background worker
4. For images ≤ 7.5 MB the raw image is sent to the configured multimodal LLM; larger files fall back to OCR text
5. The extracted JSON is validated against the `ReceiptPreviewModel` schema; confidence < 0.75 flags the receipt for review
6. The user reviews and edits the draft
7. Only the confirmed payload creates an expense record

---

## Key app routes

| Route | Description |
|---|---|
| `/dashboard` | Monthly analytics overview |
| `/expenses` | Full expense list with filters |
| `/expenses/new` | Manual entry or receipt upload |
| `/budgets` | Budget management |
| `/categories` | Category, rule, and knowledge-base management |
| `/chat` | AI financial chat |
| `/settings` | LLM provider settings and account |
| `/admin` | User approval panel (admin only) |

---

## Environment variables reference

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | (Docker default) | Async PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | yes | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | — | Google OAuth client secret |
| `JWT_SECRET` | yes | — | HS256 JWT signing key; must not be the default placeholder |
| `ADMIN_EMAIL` | yes | — | Auto-approved on sign-in; receives approval request emails |
| `APP_URL` | yes | `http://localhost:3000` | Public frontend URL (used in email links) |
| `LLM_PROVIDER` | no | `ollama` | `ollama` / `openai` / `anthropic` / `nebius` |
| `OLLAMA_URL` | no | `http://host.docker.internal:11434` | Ollama base URL |
| `OLLAMA_MODEL` | no | `gemma4:4b` | Ollama model name |
| `ANTHROPIC_API_KEY` | no | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | no | — | Required when `LLM_PROVIDER=openai` |
| `LLM_KEY_ENCRYPTION_SECRET` | no | — | Fernet key for encrypting user API keys at rest |
| `RESEND_API_KEY` | no | — | Enables approval and report emails |
| `RESEND_FROM_EMAIL` | no | — | Sender address for Resend |
| `MONTHLY_REPORTS_ENABLED` | no | `false` | Enable scheduled monthly PDF delivery |
| `MONTHLY_REPORTS_FRONTEND_TOKEN` | no | — | Shared secret for the internal Puppeteer PDF endpoint; required when reports are enabled |
| `RECURRING_GENERATION_ENABLED` | no | `false` | Enable auto-generation of recurring expenses |
| `RECEIPT_REVIEW_CONFIDENCE_THRESHOLD` | no | `0.75` | Extractions below this are flagged for review |
| `RECEIPT_MULTIMODAL_MAX_BYTES` | no | `7500000` | Images above this size use OCR instead of direct multimodal |
| `OLLAMA_MAX_CONCURRENT` | no | `1` | GPU semaphore width |
| `LLM_SEMAPHORE_WAIT_TIMEOUT` | no | `5.0` | Seconds before returning HTTP 503 on a busy LLM |
| `LLM_TIMEOUT_SECONDS` | no | `120` | Total timeout per LLM call |
| `RECEIPT_QUEUE_MAXSIZE` | no | `10` | Max queued extraction jobs |
| `RATE_LIMIT_AUTH_PER_MINUTE` | no | `10` | Auth requests per IP per minute |
| `RATE_LIMIT_UPLOAD_PER_MINUTE` | no | `3` | Receipt uploads per user per minute |
| `RATE_LIMIT_CHAT_PER_MINUTE` | no | `20` | Chat requests per user per minute |
| `DB_POOL_SIZE` | no | `20` | SQLAlchemy async pool base size |
| `DB_MAX_OVERFLOW` | no | `40` | Extra connections above pool size |
| `DEBUG` | no | `false` | Enables `/docs`, `/redoc`, `/openapi.json`; skips startup secret check |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | Same Google OAuth client ID as backend |
| `GOOGLE_CLIENT_SECRET` | yes | Same Google OAuth client secret as backend |
| `NEXTAUTH_SECRET` | yes | Random secret for NextAuth session signing |
| `NEXTAUTH_URL` | yes | Public frontend URL (e.g. `http://localhost:3001`) |
| `NEXT_PUBLIC_API_URL` | no (non-Docker) | Backend API base URL for browser requests |
| `INTERNAL_API_URL` | no (non-Docker) | Backend API base URL for server-side requests |
| `MONTHLY_REPORTS_FRONTEND_TOKEN` | no | Must match backend value when reports are enabled |
| `MONTHLY_REPORTS_BACKEND_JWT_SECRET` | no | Must match `JWT_SECRET` in backend when reports are enabled |
